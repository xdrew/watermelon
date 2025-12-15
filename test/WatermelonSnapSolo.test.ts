import { expect } from "chai";
import { ethers } from "hardhat";
import { WatermelonSnapSolo } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WatermelonSnapSolo", function () {
  let contract: WatermelonSnapSolo;
  let mockEntropy: any;
  let owner: SignerWithAddress;
  let player: SignerWithAddress;
  let recipient: SignerWithAddress;

  const ENTROPY_PROVIDER = "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344";
  const MIN_BET = ethers.parseEther("0.001");
  const MAX_BET = ethers.parseEther("0.01");
  const BASIS_POINTS = 10000n;

  beforeEach(async function () {
    [owner, player, recipient] = await ethers.getSigners();

    // Deploy mock entropy contract
    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    mockEntropy = await MockEntropy.deploy();
    await mockEntropy.waitForDeployment();

    // Deploy WatermelonSnapSolo
    const WatermelonSnapSolo = await ethers.getContractFactory("WatermelonSnapSolo");
    contract = await WatermelonSnapSolo.deploy(
      await mockEntropy.getAddress(),
      ENTROPY_PROVIDER
    );
    await contract.waitForDeployment();

    // Fund pool balance
    await contract.deposit({ value: ethers.parseEther("100") });
  });

  describe("Deployment", function () {
    it("Should set correct initial values", async function () {
      expect(await contract.owner()).to.equal(owner.address);
      expect(await contract.balance()).to.equal(ethers.parseEther("100"));
    });

    it("Should reject zero addresses", async function () {
      const WatermelonSnapSolo = await ethers.getContractFactory("WatermelonSnapSolo");
      await expect(
        WatermelonSnapSolo.deploy(ethers.ZeroAddress, ENTROPY_PROVIDER)
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  describe("Multiplier Calculation (2.5% Exponential)", function () {
    it("Should return 1.0x for 0 bands", async function () {
      expect(await contract.getMultiplierForBands(0)).to.equal(10000n);
    });

    it("Should calculate correct multiplier for 10 bands", async function () {
      // 1.025^10 ≈ 1.2801 -> 12801 BP
      const mult = await contract.getMultiplierForBands(10);
      expect(mult).to.be.closeTo(12801n, 10n);
    });

    it("Should calculate correct multiplier for 20 bands", async function () {
      // 1.025^20 ≈ 1.6386 -> ~16374 BP (integer division)
      const mult = await contract.getMultiplierForBands(20);
      expect(mult).to.be.closeTo(16386n, 20n);
    });

    it("Should calculate correct multiplier for 30 bands", async function () {
      // 1.025^30 ≈ 2.0976 -> ~20955 BP (integer division)
      const mult = await contract.getMultiplierForBands(30);
      expect(mult).to.be.closeTo(20976n, 30n);
    });

    it("Should calculate correct multiplier for 49 bands", async function () {
      // 1.025^49 ≈ 3.3533 -> 33533 BP
      const mult = await contract.getMultiplierForBands(49);
      expect(mult).to.be.closeTo(33533n, 50n);
    });
  });

  describe("Solo Game Flow", function () {
    it("Should start a game with valid bet", async function () {
      const betAmount = ethers.parseEther("0.005");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await expect(contract.connect(player).startSoloGame({ value: betAmount + vrfFee }))
        .to.emit(contract, "SoloGameStarted");

      const gameId = await contract.soloGameCounter();
      const gameState = await contract.getSoloGameState(gameId);
      expect(gameState.player).to.equal(player.address);
      expect(gameState.state).to.equal(0n); // REQUESTING_VRF
    });

    it("Should reject bet below minimum", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);
      // Send VRF fee + tiny bet that's below MIN_BET
      await expect(
        contract.connect(player).startSoloGame({ value: vrfFee + ethers.parseEther("0.0001") })
      ).to.be.revertedWithCustomError(contract, "BetTooSmall");
    });

    it("Should reject bet above maximum", async function () {
      await expect(
        contract.connect(player).startSoloGame({ value: ethers.parseEther("0.02") })
      ).to.be.revertedWithCustomError(contract, "BetTooLarge");
    });

    it("Should handle VRF callback and activate game", async function () {
      const betAmount = ethers.parseEther("0.005");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Simulate VRF callback with threshold of 25 (within 1-50 range)
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 25);

      const gameState = await contract.getSoloGameState(gameId);
      expect(gameState.state).to.equal(1n); // ACTIVE
    });

    it("Should add bands and update multiplier", async function () {
      const betAmount = ethers.parseEther("0.005");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Activate game with high threshold (won't explode)
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 50);

      // Add 5 bands
      for (let i = 0; i < 5; i++) {
        await contract.connect(player).soloAddBand(gameId);
      }

      const gameState = await contract.getSoloGameState(gameId);
      expect(gameState.currentBands).to.equal(5n);
      // 1.025^5 ≈ 1.1314 -> 11314 BP
      expect(gameState.currentMultiplier).to.be.closeTo(11314n, 10n);
    });

    it("Should explode when reaching threshold", async function () {
      const betAmount = ethers.parseEther("0.005");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Set threshold to 5 (within 1-50 range)
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 5);

      // Add bands until explosion (threshold is 5, so need to reach 5)
      for (let i = 0; i < 4; i++) {
        await contract.connect(player).soloAddBand(gameId);
      }

      // This should trigger explosion
      await expect(contract.connect(player).soloAddBand(gameId))
        .to.emit(contract, "SoloExploded")
        .withArgs(gameId, player.address, 5n, 5n);

      const gameState = await contract.getSoloGameState(gameId);
      expect(gameState.state).to.equal(3n); // EXPLODED
    });

    it("Should explode on first band if threshold is 1", async function () {
      const betAmount = ethers.parseEther("0.005");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Set threshold to 1 (minimum)
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 1);

      // First band should explode
      await expect(contract.connect(player).soloAddBand(gameId))
        .to.emit(contract, "SoloExploded")
        .withArgs(gameId, player.address, 1n, 1n);
    });

    it("Should cash out successfully", async function () {
      const betAmount = ethers.parseEther("0.005");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 50);

      // Add 10 bands
      for (let i = 0; i < 10; i++) {
        await contract.connect(player).soloAddBand(gameId);
      }

      const playerBalanceBefore = await ethers.provider.getBalance(player.address);

      const tx = await contract.connect(player).soloCashOut(gameId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const playerBalanceAfter = await ethers.provider.getBalance(player.address);
      const gameState = await contract.getSoloGameState(gameId);

      expect(gameState.state).to.equal(2n); // CASHED_OUT
      expect(playerBalanceAfter).to.be.gt(playerBalanceBefore - gasUsed);
    });

    it("Should emit ProtocolFee event on cash out", async function () {
      const betAmount = ethers.parseEther("0.005");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 50);

      // Add 10 bands
      for (let i = 0; i < 10; i++) {
        await contract.connect(player).soloAddBand(gameId);
      }

      await expect(contract.connect(player).soloCashOut(gameId))
        .to.emit(contract, "ProtocolFee");
    });

    it("Should only allow game owner to add bands", async function () {
      const betAmount = ethers.parseEther("0.005");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 50);

      await expect(
        contract.connect(owner).soloAddBand(gameId)
      ).to.be.revertedWithCustomError(contract, "NotYourGame");
    });
  });

  describe("Pool Management", function () {
    it("Should allow deposits to pool", async function () {
      const depositAmount = ethers.parseEther("10");
      const balanceBefore = await contract.balance();

      await expect(contract.deposit({ value: depositAmount }))
        .to.emit(contract, "Deposit")
        .withArgs(owner.address, depositAmount);

      expect(await contract.balance()).to.equal(balanceBefore + depositAmount);
    });

    it("Should allow owner to withdraw from pool", async function () {
      const withdrawAmount = ethers.parseEther("10");

      await expect(contract.withdraw(withdrawAmount, recipient.address))
        .to.emit(contract, "Withdraw")
        .withArgs(recipient.address, withdrawAmount);
    });

    it("Should reject withdrawal exceeding balance", async function () {
      await expect(
        contract.withdraw(ethers.parseEther("1000"), recipient.address)
      ).to.be.revertedWithCustomError(contract, "InsufficientBalance");
    });

    it("Should reject non-owner withdrawal", async function () {
      await expect(
        contract.connect(player).withdraw(ethers.parseEther("1"), recipient.address)
      ).to.be.revertedWithCustomError(contract, "OnlyOwner");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to transfer ownership", async function () {
      await expect(contract.transferOwnership(player.address))
        .to.emit(contract, "OwnershipTransferred")
        .withArgs(owner.address, player.address);

      expect(await contract.owner()).to.equal(player.address);
    });
  });
});

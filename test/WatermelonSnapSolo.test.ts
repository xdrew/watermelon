import { expect } from "chai";
import { ethers } from "hardhat";
import { WatermelonSnapSolo } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WatermelonSnapSolo", function () {
  let contract: WatermelonSnapSolo;
  let mockEntropy: any;
  let owner: SignerWithAddress;
  let player: SignerWithAddress;
  let treasury: SignerWithAddress;

  const ENTROPY_PROVIDER = "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344";
  const MIN_BET = ethers.parseEther("0.001");
  const MAX_BET = ethers.parseEther("10");
  const BASIS_POINTS = 10000n;

  beforeEach(async function () {
    [owner, player, treasury] = await ethers.getSigners();

    // Deploy mock entropy contract
    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    mockEntropy = await MockEntropy.deploy();
    await mockEntropy.waitForDeployment();

    // Deploy WatermelonSnapSolo
    const WatermelonSnapSolo = await ethers.getContractFactory("WatermelonSnapSolo");
    contract = await WatermelonSnapSolo.deploy(
      await mockEntropy.getAddress(),
      ENTROPY_PROVIDER,
      treasury.address
    );
    await contract.waitForDeployment();

    // Fund house balance
    await contract.depositToHouse({ value: ethers.parseEther("100") });
  });

  describe("Deployment", function () {
    it("Should set correct initial values", async function () {
      expect(await contract.owner()).to.equal(owner.address);
      expect(await contract.treasury()).to.equal(treasury.address);
      expect(await contract.houseBalance()).to.equal(ethers.parseEther("100"));
    });

    it("Should reject zero addresses", async function () {
      const WatermelonSnapSolo = await ethers.getContractFactory("WatermelonSnapSolo");
      await expect(
        WatermelonSnapSolo.deploy(ethers.ZeroAddress, ENTROPY_PROVIDER, treasury.address)
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  describe("Multiplier Calculation", function () {
    it("Should return 1.0x for 0 bands", async function () {
      expect(await contract.getMultiplierForBands(0)).to.equal(10000n);
    });

    it("Should calculate correct multiplier for 10 bands", async function () {
      // 10000 + (10 * 200) + (10 * 10 * 100) = 10000 + 2000 + 10000 = 22000 (2.2x)
      expect(await contract.getMultiplierForBands(10)).to.equal(22000n);
    });

    it("Should calculate correct multiplier for 30 bands", async function () {
      // 10000 + (30 * 200) + (30 * 30 * 100) = 10000 + 6000 + 90000 = 106000 (10.6x)
      expect(await contract.getMultiplierForBands(30)).to.equal(106000n);
    });

    it("Should cap at MAX_MULTIPLIER (100x)", async function () {
      // At some high band count, should cap at 1000000
      expect(await contract.getMultiplierForBands(100)).to.equal(1000000n);
    });
  });

  describe("Solo Game Flow", function () {
    it("Should start a game with valid bet", async function () {
      const betAmount = ethers.parseEther("0.1");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await expect(contract.connect(player).startSoloGame({ value: betAmount + vrfFee }))
        .to.emit(contract, "SoloGameStarted");

      const gameId = await contract.soloGameCounter();
      const gameState = await contract.getSoloGameState(gameId);
      expect(gameState.player).to.equal(player.address);
      expect(gameState.state).to.equal(0n); // REQUESTING_VRF
    });

    it("Should reject bet below minimum", async function () {
      await expect(
        contract.connect(player).startSoloGame({ value: ethers.parseEther("0.0001") })
      ).to.be.revertedWithCustomError(contract, "BetTooSmall");
    });

    it("Should reject bet above maximum", async function () {
      await expect(
        contract.connect(player).startSoloGame({ value: ethers.parseEther("11") })
      ).to.be.revertedWithCustomError(contract, "BetTooLarge");
    });

    it("Should handle VRF callback and activate game", async function () {
      const betAmount = ethers.parseEther("0.1");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Simulate VRF callback with threshold of 50
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 50);

      const gameState = await contract.getSoloGameState(gameId);
      expect(gameState.state).to.equal(1n); // ACTIVE
    });

    it("Should add bands and update multiplier", async function () {
      const betAmount = ethers.parseEther("0.1");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Activate game with high threshold (won't explode)
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 99);

      // Add 5 bands
      for (let i = 0; i < 5; i++) {
        await contract.connect(player).soloAddBand(gameId);
      }

      const gameState = await contract.getSoloGameState(gameId);
      expect(gameState.currentBands).to.equal(5n);
      // 10000 + (5 * 200) + (25 * 100) = 10000 + 1000 + 2500 = 13500
      expect(gameState.currentMultiplier).to.equal(13500n);
    });

    it("Should explode when reaching threshold", async function () {
      const betAmount = ethers.parseEther("0.1");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Set threshold to 3
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 33);

      // Add bands until explosion (threshold is 33, so need to reach 33)
      for (let i = 0; i < 32; i++) {
        await contract.connect(player).soloAddBand(gameId);
      }

      // This should trigger explosion
      await expect(contract.connect(player).soloAddBand(gameId))
        .to.emit(contract, "SoloExploded")
        .withArgs(gameId, player.address, 33n, 33n);

      const gameState = await contract.getSoloGameState(gameId);
      expect(gameState.state).to.equal(3n); // EXPLODED
    });

    it("Should cash out successfully", async function () {
      const betAmount = ethers.parseEther("0.1");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 99);

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

    it("Should only allow game owner to add bands", async function () {
      const betAmount = ethers.parseEther("0.1");
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startSoloGame({ value: betAmount + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 99);

      await expect(
        contract.connect(owner).soloAddBand(gameId)
      ).to.be.revertedWithCustomError(contract, "NotYourGame");
    });
  });

  describe("House Management", function () {
    it("Should allow deposits to house", async function () {
      const depositAmount = ethers.parseEther("10");
      const balanceBefore = await contract.houseBalance();

      await expect(contract.depositToHouse({ value: depositAmount }))
        .to.emit(contract, "HouseDeposit")
        .withArgs(owner.address, depositAmount);

      expect(await contract.houseBalance()).to.equal(balanceBefore + depositAmount);
    });

    it("Should allow owner to withdraw from house", async function () {
      const withdrawAmount = ethers.parseEther("10");

      await expect(contract.withdrawFromHouse(withdrawAmount))
        .to.emit(contract, "HouseWithdraw")
        .withArgs(treasury.address, withdrawAmount);
    });

    it("Should reject withdrawal exceeding balance", async function () {
      await expect(
        contract.withdrawFromHouse(ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(contract, "InsufficientHouseBalance");
    });

    it("Should reject non-owner withdrawal", async function () {
      await expect(
        contract.connect(player).withdrawFromHouse(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(contract, "OnlyOwner");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to update treasury", async function () {
      await expect(contract.setTreasury(player.address))
        .to.emit(contract, "TreasuryUpdated")
        .withArgs(player.address);

      expect(await contract.treasury()).to.equal(player.address);
    });

    it("Should allow owner to transfer ownership", async function () {
      await expect(contract.transferOwnership(player.address))
        .to.emit(contract, "OwnershipTransferred")
        .withArgs(owner.address, player.address);

      expect(await contract.owner()).to.equal(player.address);
    });
  });
});

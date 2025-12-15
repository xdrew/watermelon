import { expect } from "chai";
import { ethers } from "hardhat";
import { WatermelonSnapSolo } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WatermelonSnapSolo", function () {
  let contract: WatermelonSnapSolo;
  let mockEntropy: any;
  let owner: SignerWithAddress;
  let player: SignerWithAddress;
  let player2: SignerWithAddress;
  let recipient: SignerWithAddress;

  const ENTROPY_PROVIDER = "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344";
  const ENTRY_FEE = ethers.parseEther("0.01");
  const BASIS_POINTS = 10000n;

  beforeEach(async function () {
    [owner, player, player2, recipient] = await ethers.getSigners();

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

    // Sponsor prize pool
    await contract.sponsorPrizePool({ value: ethers.parseEther("10") });
  });

  describe("Deployment", function () {
    it("Should set correct initial values", async function () {
      expect(await contract.owner()).to.equal(owner.address);
      expect(await contract.currentSeason()).to.equal(1n);
      expect(await contract.prizePool()).to.equal(ethers.parseEther("10"));
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
      // 1.025^20 ≈ 1.6386 -> ~16386 BP
      const mult = await contract.getMultiplierForBands(20);
      expect(mult).to.be.closeTo(16386n, 20n);
    });

    it("Should calculate correct multiplier for 30 bands", async function () {
      // 1.025^30 ≈ 2.0976 -> ~20976 BP
      const mult = await contract.getMultiplierForBands(30);
      expect(mult).to.be.closeTo(20976n, 30n);
    });

    it("Should calculate correct multiplier for 49 bands", async function () {
      // 1.025^49 ≈ 3.3533 -> 33533 BP
      const mult = await contract.getMultiplierForBands(49);
      expect(mult).to.be.closeTo(33533n, 50n);
    });
  });

  describe("Score Calculation", function () {
    it("Should calculate score correctly", async function () {
      // Score = bands * multiplier / 100
      // 10 bands at 1.28x = 10 * 12801 / 100 = 1280
      expect(await contract.calculateScore(10, 12801n)).to.equal(1280n);
    });

    it("Should return 0 for 0 bands", async function () {
      expect(await contract.calculateScore(0, 10000n)).to.equal(0n);
    });
  });

  describe("Solo Game Flow", function () {
    it("Should start a game with entry fee", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await expect(contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee }))
        .to.emit(contract, "SoloGameStarted");

      const gameId = await contract.soloGameCounter();
      const gameState = await contract.getGameState(gameId);
      expect(gameState.player).to.equal(player.address);
      expect(gameState.state).to.equal(0n); // REQUESTING_VRF
    });

    it("Should reject insufficient fee", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);
      await expect(
        contract.connect(player).startGame({ value: vrfFee }) // Missing entry fee
      ).to.be.revertedWithCustomError(contract, "InsufficientFee");
    });

    it("Should refund excess payment", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);
      const excess = ethers.parseEther("0.5");
      const balanceBefore = await ethers.provider.getBalance(player.address);

      const tx = await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee + excess });
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(player.address);
      // Should have paid only ENTRY_FEE + vrfFee + gas
      const expectedBalance = balanceBefore - ENTRY_FEE - vrfFee - gasUsed;
      expect(balanceAfter).to.be.closeTo(expectedBalance, ethers.parseEther("0.001"));
    });

    it("Should split entry fee between prize pool and protocol", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);
      const prizePoolBefore = await contract.prizePool();
      const protocolBefore = await contract.protocolBalance();

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });

      const prizePoolAfter = await contract.prizePool();
      const protocolAfter = await contract.protocolBalance();

      // 90% to prize pool, 10% to protocol
      const expectedToPrizePool = (ENTRY_FEE * 9000n) / 10000n;
      const expectedToProtocol = ENTRY_FEE - expectedToPrizePool;

      expect(prizePoolAfter - prizePoolBefore).to.equal(expectedToPrizePool);
      expect(protocolAfter - protocolBefore).to.equal(expectedToProtocol);
    });

    it("Should handle VRF callback and activate game", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Simulate VRF callback with threshold of 25
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 25);

      const gameState = await contract.getGameState(gameId);
      expect(gameState.state).to.equal(1n); // ACTIVE
    });

    it("Should add bands and update multiplier", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Activate game with high threshold
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 50);

      // Add 5 bands
      for (let i = 0; i < 5; i++) {
        await contract.connect(player).addBand(gameId);
      }

      const gameState = await contract.getGameState(gameId);
      expect(gameState.currentBands).to.equal(5n);
      // 1.025^5 ≈ 1.1314 -> 11314 BP
      expect(gameState.currentMultiplier).to.be.closeTo(11314n, 10n);
    });

    it("Should explode when reaching threshold", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Set threshold to 5
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 5);

      // Add 4 bands (threshold is 5)
      for (let i = 0; i < 4; i++) {
        await contract.connect(player).addBand(gameId);
      }

      // This should trigger explosion
      await expect(contract.connect(player).addBand(gameId))
        .to.emit(contract, "SoloExploded");

      const gameState = await contract.getGameState(gameId);
      expect(gameState.state).to.equal(3n); // EXPLODED
      expect(gameState.score).to.equal(0n);
    });

    it("Should explode on first band if threshold is 1", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Set threshold to 1
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 1);

      // First band should explode
      await expect(contract.connect(player).addBand(gameId))
        .to.emit(contract, "SoloExploded");
    });

    it("Should cash out and record score", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 50);

      // Add 10 bands
      for (let i = 0; i < 10; i++) {
        await contract.connect(player).addBand(gameId);
      }

      await expect(contract.connect(player).cashOut(gameId))
        .to.emit(contract, "SoloScored");

      const gameState = await contract.getGameState(gameId);
      expect(gameState.state).to.equal(2n); // SCORED
      expect(gameState.score).to.be.gt(0n);
    });

    it("Should update best score on cashout", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 50);

      // Add 10 bands
      for (let i = 0; i < 10; i++) {
        await contract.connect(player).addBand(gameId);
      }

      await expect(contract.connect(player).cashOut(gameId))
        .to.emit(contract, "NewHighScore");

      const season = await contract.currentSeason();
      const [bestScore, bestGameId] = await contract.getPlayerSeasonBest(season, player.address);
      expect(bestScore).to.be.gt(0n);
      expect(bestGameId).to.equal(gameId);
    });

    it("Should only allow game owner to add bands", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 50);

      await expect(
        contract.connect(owner).addBand(gameId)
      ).to.be.revertedWithCustomError(contract, "NotYourGame");
    });

    it("Should only allow game owner to cash out", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 50);

      await expect(
        contract.connect(owner).cashOut(gameId)
      ).to.be.revertedWithCustomError(contract, "NotYourGame");
    });
  });

  describe("Season Tracking", function () {
    it("Should track season prize pool", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);
      const season = await contract.currentSeason();

      const seasonPoolBefore = await contract.seasonPrizePool(season);
      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const seasonPoolAfter = await contract.seasonPrizePool(season);

      const expectedIncrease = (ENTRY_FEE * 9000n) / 10000n;
      expect(seasonPoolAfter - seasonPoolBefore).to.equal(expectedIncrease);
    });

    it("Should get season info", async function () {
      const [season, pool, startTime, endTime, finalized] = await contract.getSeasonInfo();
      expect(season).to.equal(1n);
      expect(finalized).to.equal(false);
      expect(endTime).to.be.gt(startTime);
    });

    it("Should allow owner to start new season", async function () {
      await expect(contract.startNewSeason())
        .to.emit(contract, "SeasonStarted");

      expect(await contract.currentSeason()).to.equal(2n);
    });
  });

  describe("Pool Management", function () {
    it("Should allow sponsoring prize pool", async function () {
      const amount = ethers.parseEther("5");
      const poolBefore = await contract.prizePool();

      await expect(contract.sponsorPrizePool({ value: amount }))
        .to.emit(contract, "Deposit")
        .withArgs(owner.address, amount);

      expect(await contract.prizePool()).to.equal(poolBefore + amount);
    });

    it("Should allow owner to withdraw protocol fees", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      // Generate some protocol fees
      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });

      const protocolBalance = await contract.protocolBalance();
      expect(protocolBalance).to.be.gt(0n);

      await expect(contract.withdrawProtocolFees(protocolBalance, recipient.address))
        .to.emit(contract, "Withdraw")
        .withArgs(recipient.address, protocolBalance);

      expect(await contract.protocolBalance()).to.equal(0n);
    });

    it("Should reject withdrawal exceeding protocol balance", async function () {
      await expect(
        contract.withdrawProtocolFees(ethers.parseEther("1000"), recipient.address)
      ).to.be.revertedWithCustomError(contract, "InsufficientBalance");
    });

    it("Should reject non-owner withdrawal", async function () {
      await expect(
        contract.connect(player).withdrawProtocolFees(ethers.parseEther("1"), recipient.address)
      ).to.be.revertedWithCustomError(contract, "OnlyOwner");
    });

    it("Should accept ETH via receive function", async function () {
      const amount = ethers.parseEther("1");
      const poolBefore = await contract.prizePool();

      await owner.sendTransaction({
        to: await contract.getAddress(),
        value: amount
      });

      expect(await contract.prizePool()).to.equal(poolBefore + amount);
    });
  });

  describe("Prize Distribution", function () {
    it("Should distribute prizes to winners", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      // Play some games to build prize pool
      for (let i = 0; i < 5; i++) {
        await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      }

      // Fast forward past season duration (1 day)
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      const seasonPool = await contract.seasonPrizePool(1);
      const prize1 = seasonPool / 2n;
      const prize2 = seasonPool / 4n;

      const balanceBefore = await ethers.provider.getBalance(player.address);

      await expect(
        contract.distributePrizes(1, [player.address, player2.address], [prize1, prize2])
      )
        .to.emit(contract, "PrizeDistributed")
        .to.emit(contract, "SeasonFinalized");

      const balanceAfter = await ethers.provider.getBalance(player.address);
      expect(balanceAfter - balanceBefore).to.equal(prize1);
    });

    it("Should reject distribution before season ends", async function () {
      await expect(
        contract.distributePrizes(1, [player.address], [ethers.parseEther("1")])
      ).to.be.revertedWithCustomError(contract, "SeasonNotOver");
    });

    it("Should reject double distribution", async function () {
      // Fast forward past season (1 day)
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await contract.distributePrizes(1, [player.address], [0n]);

      await expect(
        contract.distributePrizes(1, [player.address], [0n])
      ).to.be.revertedWithCustomError(contract, "SeasonAlreadyFinalized");
    });

    it("Should reject non-owner distribution", async function () {
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        contract.connect(player).distributePrizes(1, [player.address], [0n])
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

    it("Should reject transfer to zero address", async function () {
      await expect(
        contract.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  describe("View Functions", function () {
    it("Should return game cost", async function () {
      const [entryFee, vrfFee, total] = await contract.getGameCost();
      expect(entryFee).to.equal(ENTRY_FEE);
      expect(total).to.equal(entryFee + vrfFee);
    });

    it("Should return player games", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });

      const games = await contract.getPlayerGames(player.address);
      expect(games.length).to.equal(2);
    });
  });
});

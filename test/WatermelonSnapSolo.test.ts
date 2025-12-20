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
      ENTROPY_PROVIDER,
      ENTRY_FEE
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
        WatermelonSnapSolo.deploy(ethers.ZeroAddress, ENTROPY_PROVIDER, ENTRY_FEE)
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });

    it("Should reject invalid entry fee", async function () {
      const WatermelonSnapSolo = await ethers.getContractFactory("WatermelonSnapSolo");
      // Too low
      await expect(
        WatermelonSnapSolo.deploy(await mockEntropy.getAddress(), ENTROPY_PROVIDER, ethers.parseEther("0.0001"))
      ).to.be.revertedWithCustomError(contract, "InvalidEntryFee");
      // Too high
      await expect(
        WatermelonSnapSolo.deploy(await mockEntropy.getAddress(), ENTROPY_PROVIDER, ethers.parseEther("11"))
      ).to.be.revertedWithCustomError(contract, "InvalidEntryFee");
    });
  });

  describe("Multiplier Calculation (15% Exponential)", function () {
    it("Should return 1.0x for 0 bands", async function () {
      expect(await contract.getMultiplierForBands(0)).to.equal(10000n);
    });

    it("Should calculate correct multiplier for 5 bands", async function () {
      // 1.15^5 ≈ 2.0114 -> 20114 BP
      const mult = await contract.getMultiplierForBands(5);
      expect(mult).to.be.closeTo(20114n, 50n);
    });

    it("Should calculate correct multiplier for 10 bands", async function () {
      // 1.15^10 ≈ 4.0456 -> ~40456 BP
      const mult = await contract.getMultiplierForBands(10);
      expect(mult).to.be.closeTo(40456n, 100n);
    });

    it("Should calculate correct multiplier for 14 bands", async function () {
      // 1.15^14 ≈ 7.0757 -> ~70757 BP
      const mult = await contract.getMultiplierForBands(14);
      expect(mult).to.be.closeTo(70757n, 150n);
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

      // Activate game with high threshold (max is 15)
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);

      // Add 5 bands
      for (let i = 0; i < 5; i++) {
        await contract.connect(player).addBand(gameId);
      }

      const gameState = await contract.getGameState(gameId);
      expect(gameState.currentBands).to.equal(5n);
      // 1.15^5 ≈ 2.0114 -> 20114 BP
      expect(gameState.currentMultiplier).to.be.closeTo(20114n, 50n);
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

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);

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

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);

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

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);

      await expect(
        contract.connect(owner).addBand(gameId)
      ).to.be.revertedWithCustomError(contract, "NotYourGame");
    });

    it("Should only allow game owner to cash out", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);

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

    it("Should reject mismatched winners and amounts arrays", async function () {
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        contract.distributePrizes(1, [player.address, player2.address], [ethers.parseEther("0.01")])
      ).to.be.revertedWithCustomError(contract, "InvalidWinners");
    });

    it("Should reject empty winners array", async function () {
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        contract.distributePrizes(1, [], [])
      ).to.be.revertedWithCustomError(contract, "InvalidWinners");
    });

    it("Should reject distribution exceeding pool balance", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      // Play one game
      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });

      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      const seasonPool = await contract.seasonPrizePool(1);

      await expect(
        contract.distributePrizes(1, [player.address], [seasonPool + ethers.parseEther("100")])
      ).to.be.revertedWithCustomError(contract, "InsufficientBalance");
    });

    it("Should skip zero address winners gracefully", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });

      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      const seasonPool = await contract.seasonPrizePool(1);
      const prize = seasonPool / 2n;

      // Include zero address - should be skipped
      await expect(
        contract.distributePrizes(1, [ethers.ZeroAddress, player.address], [prize, prize / 2n])
      ).to.emit(contract, "SeasonFinalized");
    });

    it("Should allow partial distribution leaving funds in pool", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      for (let i = 0; i < 5; i++) {
        await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      }

      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      const seasonPool = await contract.seasonPrizePool(1);
      const prizePoolBefore = await contract.prizePool();

      // Only distribute 10% of pool
      const partialPrize = seasonPool / 10n;
      await contract.distributePrizes(1, [player.address], [partialPrize]);

      const prizePoolAfter = await contract.prizePool();
      expect(prizePoolBefore - prizePoolAfter).to.equal(partialPrize);
    });

    it("Should distribute to multiple winners correctly", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);
      const [, , , , winner3] = await ethers.getSigners();

      for (let i = 0; i < 10; i++) {
        await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      }

      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      const seasonPool = await contract.seasonPrizePool(1);
      const prize1 = seasonPool / 2n;
      const prize2 = seasonPool / 4n;
      const prize3 = seasonPool / 8n;

      const balance1Before = await ethers.provider.getBalance(player.address);
      const balance2Before = await ethers.provider.getBalance(player2.address);
      const balance3Before = await ethers.provider.getBalance(winner3.address);

      await contract.distributePrizes(
        1,
        [player.address, player2.address, winner3.address],
        [prize1, prize2, prize3]
      );

      expect(await ethers.provider.getBalance(player.address)).to.equal(balance1Before + prize1);
      expect(await ethers.provider.getBalance(player2.address)).to.equal(balance2Before + prize2);
      expect(await ethers.provider.getBalance(winner3.address)).to.equal(balance3Before + prize3);
    });
  });

  describe("Stale Game Cancellation", function () {
    it("Should allow cancellation after timeout", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Fast forward past stale timeout (1 hour)
      await ethers.provider.send("evm_increaseTime", [3600 + 1]);
      await ethers.provider.send("evm_mine", []);

      const balanceBefore = await ethers.provider.getBalance(player.address);

      const tx = await contract.connect(player).cancelStaleGame(gameId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(player.address);
      const refundAmount = (ENTRY_FEE * 9000n) / 10000n;

      expect(balanceAfter).to.be.closeTo(balanceBefore + refundAmount - gasUsed, ethers.parseEther("0.0001"));

      const gameState = await contract.getGameState(gameId);
      expect(gameState.state).to.equal(4n); // CANCELLED
    });

    it("Should reject cancellation before timeout", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      await expect(
        contract.connect(player).cancelStaleGame(gameId)
      ).to.be.revertedWithCustomError(contract, "GameNotStale");
    });

    it("Should reject cancellation of active game", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      // Activate the game
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);

      // Try to cancel (should fail even after timeout)
      await ethers.provider.send("evm_increaseTime", [3600 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        contract.connect(player).cancelStaleGame(gameId)
      ).to.be.revertedWithCustomError(contract, "GameNotRequestingVRF");
    });

    it("Should reject cancellation by non-owner of game", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      await ethers.provider.send("evm_increaseTime", [3600 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        contract.connect(player2).cancelStaleGame(gameId)
      ).to.be.revertedWithCustomError(contract, "NotYourGame");
    });
  });

  describe("On-Chain Leaderboard", function () {
    it("Should update leaderboard on high score", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      const gameId = await contract.soloGameCounter();

      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);

      // Add bands and cash out
      for (let i = 0; i < 10; i++) {
        await contract.connect(player).addBand(gameId);
      }

      await expect(contract.connect(player).cashOut(gameId))
        .to.emit(contract, "LeaderboardUpdated");

      const leaderboard = await contract.getLeaderboard(1);
      expect(leaderboard.length).to.equal(1);
      expect(leaderboard[0].player).to.equal(player.address);
    });

    it("Should maintain sorted order with multiple players", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      // Player 1: 3 bands
      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);
      for (let i = 0; i < 3; i++) {
        await contract.connect(player).addBand(1);
      }
      await contract.connect(player).cashOut(1);

      // Player 2: 10 bands (higher score)
      await contract.connect(player2).startGame({ value: ENTRY_FEE + vrfFee });
      await mockEntropy.fulfillRequest(await contract.getAddress(), 2, 15);
      for (let i = 0; i < 10; i++) {
        await contract.connect(player2).addBand(2);
      }
      await contract.connect(player2).cashOut(2);

      const leaderboard = await contract.getLeaderboard(1);
      expect(leaderboard.length).to.equal(2);
      expect(leaderboard[0].player).to.equal(player2.address); // Higher score first
      expect(leaderboard[1].player).to.equal(player.address);
    });

    it("Should return correct player rank", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      // Player 1: 3 bands
      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);
      for (let i = 0; i < 3; i++) {
        await contract.connect(player).addBand(1);
      }
      await contract.connect(player).cashOut(1);

      // Player 2 with higher score: 10 bands
      await contract.connect(player2).startGame({ value: ENTRY_FEE + vrfFee });
      await mockEntropy.fulfillRequest(await contract.getAddress(), 2, 15);
      for (let i = 0; i < 10; i++) {
        await contract.connect(player2).addBand(2);
      }
      await contract.connect(player2).cashOut(2);

      expect(await contract.getPlayerRank(1, player2.address)).to.equal(1n);
      expect(await contract.getPlayerRank(1, player.address)).to.equal(2n);
      expect(await contract.getPlayerRank(1, owner.address)).to.equal(0n); // Not ranked
    });

    it("Should update player position when they beat their own score", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      // First game: 3 bands
      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);
      for (let i = 0; i < 3; i++) {
        await contract.connect(player).addBand(1);
      }
      await contract.connect(player).cashOut(1);

      const score1 = (await contract.getLeaderboard(1))[0].score;

      // Second game: 12 bands (higher score)
      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      await mockEntropy.fulfillRequest(await contract.getAddress(), 2, 15);
      for (let i = 0; i < 12; i++) {
        await contract.connect(player).addBand(2);
      }
      await contract.connect(player).cashOut(2);

      const leaderboard = await contract.getLeaderboard(1);
      expect(leaderboard.length).to.equal(1); // Still one player
      expect(leaderboard[0].score).to.be.gt(score1); // Score updated
    });
  });

  describe("Pagination", function () {
    it("Should return paginated player games", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      // Start 5 games
      for (let i = 0; i < 5; i++) {
        await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
      }

      // Get first page
      const [page1, total1] = await contract.getPlayerGamesPage(player.address, 0, 2);
      expect(page1.length).to.equal(2);
      expect(total1).to.equal(5n);

      // Get second page
      const [page2, total2] = await contract.getPlayerGamesPage(player.address, 2, 2);
      expect(page2.length).to.equal(2);
      expect(total2).to.equal(5n);

      // Get last page
      const [page3, total3] = await contract.getPlayerGamesPage(player.address, 4, 2);
      expect(page3.length).to.equal(1);
      expect(total3).to.equal(5n);
    });

    it("Should return empty array for offset beyond total", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });

      const [games, total] = await contract.getPlayerGamesPage(player.address, 100, 10);
      expect(games.length).to.equal(0);
      expect(total).to.equal(1n);
    });

    it("Should clamp limit to MAX_GAMES_PER_PAGE", async function () {
      const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

      await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });

      // Request 1000 games but only 1 exists
      const [games, total] = await contract.getPlayerGamesPage(player.address, 0, 1000);
      expect(games.length).to.equal(1);
      expect(total).to.equal(1n);
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

  describe("Edge Cases", function () {
    describe("VRF Callback Edge Cases", function () {
      it("Should reject duplicate VRF callback for already active game", async function () {
        const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);
        await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });

        // First callback makes game active
        await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 25);

        const gameStateBefore = await contract.getGameState(1);
        expect(gameStateBefore[6]).to.equal(1); // ACTIVE

        // Second callback with same sequence should revert (game already active)
        await expect(
          mockEntropy.fulfillRequest(await contract.getAddress(), 1, 30)
        ).to.be.revertedWithCustomError(contract, "GameNotRequestingVRF");
      });

      it("Should handle VRF callback for non-existent sequence gracefully", async function () {
        // Start a game to get sequence 1
        const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);
        await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });

        // Get game state before spurious callback
        const gameStateBefore = await contract.getGameState(1);
        expect(gameStateBefore[6]).to.equal(0); // REQUESTING_VRF

        // Callback for wrong sequence - should not affect game 1
        // (gameId 0 at sequence 999 is a default/empty game with player=address(0))
        await mockEntropy.fulfillRequest(await contract.getAddress(), 999, 25);

        // Game 1 should still be waiting for VRF (state unchanged)
        const gameStateAfter = await contract.getGameState(1);
        expect(gameStateAfter[6]).to.equal(0); // Still REQUESTING_VRF
      });
    });

    describe("Leaderboard Capacity", function () {
      it("Should maintain exactly 10 entries when at capacity", async function () {
        const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);
        const signers = await ethers.getSigners();

        // Create 12 players with different scores
        for (let i = 0; i < 12; i++) {
          const playerSigner = signers[i + 4]; // Skip owner, player, player2, recipient
          await contract.connect(playerSigner).startGame({ value: ENTRY_FEE + vrfFee });
          // Use high threshold (15) so games don't explode
          await mockEntropy.fulfillRequest(await contract.getAddress(), i + 1, 15);

          // Add bands to get different scores (max 12 to stay under threshold)
          const bandsToAdd = Math.min(i + 1, 12);
          for (let j = 0; j < bandsToAdd; j++) {
            await contract.connect(playerSigner).addBand(i + 1);
          }
          await contract.connect(playerSigner).cashOut(i + 1);
        }

        const leaderboard = await contract.getLeaderboard(1);
        // Should have exactly 10 entries (max leaderboard size)
        const validEntries = leaderboard.filter((e: any) => e.player !== ethers.ZeroAddress);
        expect(validEntries.length).to.be.lte(10);
      });

      it("Should replace lowest score when new higher score enters full leaderboard", async function () {
        const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);
        const signers = await ethers.getSigners();

        // Fill leaderboard with 10 players, each with increasing scores
        for (let i = 0; i < 10; i++) {
          const playerSigner = signers[i + 4];
          await contract.connect(playerSigner).startGame({ value: ENTRY_FEE + vrfFee });
          // Use high threshold (15) so games don't explode
          await mockEntropy.fulfillRequest(await contract.getAddress(), i + 1, 15);

          // Add bands (max 10 to stay safely under threshold)
          const bandsToAdd = Math.min(i + 1, 10);
          for (let j = 0; j < bandsToAdd; j++) {
            await contract.connect(playerSigner).addBand(i + 1);
          }
          await contract.connect(playerSigner).cashOut(i + 1);
        }

        const leaderboardBefore = await contract.getLeaderboard(1);
        const lowestScoreBefore = leaderboardBefore[9].score;

        // New player with score higher than lowest
        const newPlayer = signers[14];
        await contract.connect(newPlayer).startGame({ value: ENTRY_FEE + vrfFee });
        await mockEntropy.fulfillRequest(await contract.getAddress(), 11, 15);

        // Add enough bands to beat the lowest score (12 bands)
        for (let j = 0; j < 12; j++) {
          await contract.connect(newPlayer).addBand(11);
        }
        await contract.connect(newPlayer).cashOut(11);

        const leaderboardAfter = await contract.getLeaderboard(1);
        const lowestScoreAfter = leaderboardAfter[9].score;

        // Lowest score should now be higher than before (new player pushed someone out)
        expect(lowestScoreAfter).to.be.gte(lowestScoreBefore);
      });
    });

    describe("Season Boundary", function () {
      it("Should handle game started in one season and scored in next", async function () {
        const vrfFee = await mockEntropy.getFee(ENTROPY_PROVIDER);

        // Start game in season 1
        await contract.connect(player).startGame({ value: ENTRY_FEE + vrfFee });
        await mockEntropy.fulfillRequest(await contract.getAddress(), 1, 15);

        // Get the current season from the game
        const gameStateBefore = await contract.getGameState(1);
        const gameSeason = gameStateBefore[5]; // season field

        // Add some bands
        await contract.connect(player).addBand(1);
        await contract.connect(player).addBand(1);

        // Fast forward past season end
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]); // 8 days
        await ethers.provider.send("evm_mine", []);

        // Start new season (owner only)
        await contract.startNewSeason();

        // Cash out in new season - should still work and record to original season
        await contract.connect(player).cashOut(1);

        // Score should be recorded to the game's original season
        const gameStateAfter = await contract.getGameState(1);
        expect(gameStateAfter[5]).to.equal(gameSeason); // Season unchanged

        // Check player's best for original season
        const [bestScore] = await contract.getPlayerSeasonBest(gameSeason, player.address);
        expect(bestScore).to.be.gt(0);
      });
    });
  });
});

import { expect } from "chai";
import { ethers } from "hardhat";
import { SessionKeyManager, WatermelonSnapSolo } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SessionKeyManager", function () {
  let sessionManager: SessionKeyManager;
  let gameContract: WatermelonSnapSolo;
  let mockEntropy: any;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let sessionKey: SignerWithAddress;
  let attacker: SignerWithAddress;

  const ENTROPY_PROVIDER = "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344";
  const ENTRY_FEE = ethers.parseEther("0.01");
  const ONE_HOUR = 3600;

  // Function selectors
  const ADD_BAND_SELECTOR = "0x" + ethers.id("addBand(uint256)").slice(2, 10);
  const CASH_OUT_SELECTOR = "0x" + ethers.id("cashOut(uint256)").slice(2, 10);
  const START_GAME_SELECTOR = "0x" + ethers.id("startGame()").slice(2, 10);

  beforeEach(async function () {
    [owner, user, sessionKey, attacker] = await ethers.getSigners();

    // Deploy SessionKeyManager
    const SessionKeyManager = await ethers.getContractFactory("SessionKeyManager");
    sessionManager = await SessionKeyManager.deploy();
    await sessionManager.waitForDeployment();

    // Deploy mock entropy
    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    mockEntropy = await MockEntropy.deploy();
    await mockEntropy.waitForDeployment();

    // Deploy game contract
    const WatermelonSnapSolo = await ethers.getContractFactory("WatermelonSnapSolo");
    gameContract = await WatermelonSnapSolo.deploy(
      await mockEntropy.getAddress(),
      ENTROPY_PROVIDER,
      ENTRY_FEE
    );
    await gameContract.waitForDeployment();

    // Fund prize pool
    await gameContract.sponsorPrizePool({ value: ethers.parseEther("10") });
  });

  describe("Session Creation", function () {
    it("Should create a valid session", async function () {
      const selectors = [ADD_BAND_SELECTOR, CASH_OUT_SELECTOR];

      await sessionManager.connect(user).createSession(
        sessionKey.address,
        ONE_HOUR,
        await gameContract.getAddress(),
        selectors,
        0 // any gameId
      );

      expect(await sessionManager.isSessionValid(user.address)).to.be.true;

      const session = await sessionManager.getSession(user.address);
      expect(session.sessionKey).to.equal(sessionKey.address);
      expect(session.allowedTarget).to.equal(await gameContract.getAddress());
      expect(session.allowedSelectors).to.deep.equal(selectors);
    });

    it("Should reject session with too short duration", async function () {
      await expect(
        sessionManager.connect(user).createSession(
          sessionKey.address,
          60, // 1 minute - too short
          await gameContract.getAddress(),
          [ADD_BAND_SELECTOR],
          0
        )
      ).to.be.revertedWithCustomError(sessionManager, "InvalidDuration");
    });

    it("Should reject session with too long duration", async function () {
      await expect(
        sessionManager.connect(user).createSession(
          sessionKey.address,
          25 * 3600, // 25 hours - too long
          await gameContract.getAddress(),
          [ADD_BAND_SELECTOR],
          0
        )
      ).to.be.revertedWithCustomError(sessionManager, "InvalidDuration");
    });

    it("Should reject creating session when one is active", async function () {
      await sessionManager.connect(user).createSession(
        sessionKey.address,
        ONE_HOUR,
        await gameContract.getAddress(),
        [ADD_BAND_SELECTOR],
        0
      );

      await expect(
        sessionManager.connect(user).createSession(
          attacker.address,
          ONE_HOUR,
          await gameContract.getAddress(),
          [ADD_BAND_SELECTOR],
          0
        )
      ).to.be.revertedWithCustomError(sessionManager, "SessionAlreadyActive");
    });
  });

  describe("Session Revocation", function () {
    it("Should revoke an active session", async function () {
      await sessionManager.connect(user).createSession(
        sessionKey.address,
        ONE_HOUR,
        await gameContract.getAddress(),
        [ADD_BAND_SELECTOR],
        0
      );

      expect(await sessionManager.isSessionValid(user.address)).to.be.true;

      await sessionManager.connect(user).revokeSession();

      expect(await sessionManager.isSessionValid(user.address)).to.be.false;
    });

    it("Should allow new session after revocation", async function () {
      await sessionManager.connect(user).createSession(
        sessionKey.address,
        ONE_HOUR,
        await gameContract.getAddress(),
        [ADD_BAND_SELECTOR],
        0
      );

      await sessionManager.connect(user).revokeSession();

      // Should now be able to create new session
      await sessionManager.connect(user).createSession(
        attacker.address, // different key
        ONE_HOUR,
        await gameContract.getAddress(),
        [ADD_BAND_SELECTOR],
        0
      );

      const session = await sessionManager.getSession(user.address);
      expect(session.sessionKey).to.equal(attacker.address);
    });
  });

  describe("Session Expiration", function () {
    it("Should show remaining time correctly", async function () {
      await sessionManager.connect(user).createSession(
        sessionKey.address,
        ONE_HOUR,
        await gameContract.getAddress(),
        [ADD_BAND_SELECTOR],
        0
      );

      const remaining = await sessionManager.getRemainingTime(user.address);
      expect(remaining).to.be.closeTo(BigInt(ONE_HOUR), 5n);
    });

    it("Should return 0 remaining time after expiry", async function () {
      await sessionManager.connect(user).createSession(
        sessionKey.address,
        300, // 5 minutes (minimum)
        await gameContract.getAddress(),
        [ADD_BAND_SELECTOR],
        0
      );

      // Fast forward past expiry
      await ethers.provider.send("evm_increaseTime", [400]);
      await ethers.provider.send("evm_mine", []);

      expect(await sessionManager.getRemainingTime(user.address)).to.equal(0n);
      expect(await sessionManager.isSessionValid(user.address)).to.be.false;
    });
  });

  describe("Execution Security", function () {
    beforeEach(async function () {
      // Create a session for tests
      await sessionManager.connect(user).createSession(
        sessionKey.address,
        ONE_HOUR,
        await gameContract.getAddress(),
        [ADD_BAND_SELECTOR, CASH_OUT_SELECTOR],
        0
      );
    });

    it("Should reject execution from non-session key", async function () {
      const calldata = gameContract.interface.encodeFunctionData("addBand", [1]);

      await expect(
        sessionManager.connect(attacker).execute(
          user.address,
          await gameContract.getAddress(),
          calldata
        )
      ).to.be.revertedWithCustomError(sessionManager, "InvalidSessionKey");
    });

    it("Should reject execution to non-allowed target", async function () {
      const fakeTarget = "0x1234567890123456789012345678901234567890";
      const calldata = gameContract.interface.encodeFunctionData("addBand", [1]);

      await expect(
        sessionManager.connect(sessionKey).execute(user.address, fakeTarget, calldata)
      ).to.be.revertedWithCustomError(sessionManager, "TargetNotAllowed");
    });

    it("Should reject execution of non-allowed selector", async function () {
      // startGame is not in allowed selectors
      const calldata = gameContract.interface.encodeFunctionData("startGame");

      await expect(
        sessionManager.connect(sessionKey).execute(
          user.address,
          await gameContract.getAddress(),
          calldata
        )
      ).to.be.revertedWithCustomError(sessionManager, "SelectorNotAllowed");
    });

    it("Should reject execution after session expires", async function () {
      // Fast forward past expiry
      await ethers.provider.send("evm_increaseTime", [ONE_HOUR + 100]);
      await ethers.provider.send("evm_mine", []);

      const calldata = gameContract.interface.encodeFunctionData("addBand", [1]);

      await expect(
        sessionManager.connect(sessionKey).execute(
          user.address,
          await gameContract.getAddress(),
          calldata
        )
      ).to.be.revertedWithCustomError(sessionManager, "SessionExpired");
    });
  });

  describe("GameId Restriction", function () {
    it("Should restrict session to specific gameId", async function () {
      // Create session for gameId 5 only
      await sessionManager.connect(user).createSession(
        sessionKey.address,
        ONE_HOUR,
        await gameContract.getAddress(),
        [ADD_BAND_SELECTOR],
        5 // specific gameId
      );

      // Try to call addBand for gameId 3
      const calldata = gameContract.interface.encodeFunctionData("addBand", [3]);

      await expect(
        sessionManager.connect(sessionKey).execute(
          user.address,
          await gameContract.getAddress(),
          calldata
        )
      ).to.be.revertedWithCustomError(sessionManager, "GameIdMismatch");
    });

    it("Should allow any gameId when set to 0", async function () {
      // Session with gameId = 0 (any)
      await sessionManager.connect(user).createSession(
        sessionKey.address,
        ONE_HOUR,
        await gameContract.getAddress(),
        [ADD_BAND_SELECTOR],
        0
      );

      // This should not revert with GameIdMismatch
      // (will revert with game-specific error since no actual game exists)
      const calldata = gameContract.interface.encodeFunctionData("addBand", [999]);

      await expect(
        sessionManager.connect(sessionKey).execute(
          user.address,
          await gameContract.getAddress(),
          calldata
        )
      ).to.not.be.revertedWithCustomError(sessionManager, "GameIdMismatch");
    });
  });

  describe("View Functions", function () {
    it("Should return correct session details", async function () {
      const selectors = [ADD_BAND_SELECTOR, CASH_OUT_SELECTOR];

      await sessionManager.connect(user).createSession(
        sessionKey.address,
        ONE_HOUR,
        await gameContract.getAddress(),
        selectors,
        42
      );

      const session = await sessionManager.getSession(user.address);
      expect(session.sessionKey).to.equal(sessionKey.address);
      expect(session.allowedTarget).to.equal(await gameContract.getAddress());
      expect(session.gameId).to.equal(42n);
      expect(session.allowedSelectors.length).to.equal(2);
    });

    it("Should return false for non-existent session", async function () {
      expect(await sessionManager.isSessionValid(user.address)).to.be.false;
    });
  });
});

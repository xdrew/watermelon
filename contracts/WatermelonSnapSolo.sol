// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IEntropy.sol";

/// @title WatermelonSnapSolo - Press Your Luck Solo Mode
/// @notice Single-player mode where you add bands until you cash out or explode
/// @dev Uses Pyth Entropy for verifiable random threshold generation
contract WatermelonSnapSolo is IEntropyConsumer {
    // ============ STATE VARIABLES ============

    IEntropy public immutable entropy;
    address public immutable entropyProvider;
    address public owner;

    uint256 public soloGameCounter;
    uint256 public balance; // Single pool for liquidity + fees

    // ============ CONSTANTS ============

    uint256 public constant SOLO_MIN_THRESHOLD = 1;
    uint256 public constant SOLO_MAX_THRESHOLD = 50;
    uint256 public constant MIN_BET = 0.001 ether;
    uint256 public constant MAX_BET = 0.01 ether;
    uint256 public constant PROTOCOL_FEE_BPS = 500; // 5%
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MULTIPLIER_RATE_BPS = 250; // 2.5% exponential growth per band
    uint256 public constant GAS_PER_BAND = 50000; // Estimated gas per addBand call
    uint256 public constant GAS_PER_CASHOUT = 80000; // Estimated gas for cashOut call

    uint256 public gasReimbursementEnabled = 0; // 1 = enabled, 0 = disabled (default: off)

    // ============ STRUCTS ============

    enum SoloState {
        REQUESTING_VRF,  // Waiting for threshold
        ACTIVE,          // Player adding bands
        CASHED_OUT,      // Player took winnings
        EXPLODED         // Watermelon exploded
    }

    struct SoloGame {
        address player;
        uint256 betAmount;
        uint256 currentBands;
        uint256 snapThreshold;
        uint256 currentMultiplier; // In basis points (10000 = 1.0x)
        SoloState state;
        uint64 vrfSequence;
        uint256 createdAt;
        uint256 gasPrice; // Gas price at game start for reimbursement calculation
    }

    // ============ MAPPINGS ============

    mapping(uint256 => SoloGame) public soloGames;
    mapping(uint64 => uint256) public vrfRequestToGame;
    mapping(address => uint256[]) public playerGames;

    // ============ EVENTS ============

    event SoloGameStarted(
        uint256 indexed gameId,
        address indexed player,
        uint256 betAmount,
        uint64 vrfSequence
    );

    event SoloGameReady(
        uint256 indexed gameId,
        address indexed player
    );

    event SoloBandAdded(
        uint256 indexed gameId,
        uint256 totalBands,
        uint256 currentMultiplier,
        uint256 potentialPayout
    );

    event SoloCashOut(
        uint256 indexed gameId,
        address indexed player,
        uint256 payout,
        uint256 bandsPlaced,
        uint256 threshold
    );

    event SoloExploded(
        uint256 indexed gameId,
        address indexed player,
        uint256 bandsPlaced,
        uint256 threshold
    );

    event ProtocolFee(uint256 indexed gameId, uint256 amount);
    event GasReimbursement(uint256 indexed gameId, uint256 amount);
    event Deposit(address indexed depositor, uint256 amount);
    event Withdraw(address indexed recipient, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event GasReimbursementToggled(bool enabled);

    // ============ ERRORS ============

    error BetTooSmall();
    error BetTooLarge();
    error NotYourGame();
    error GameNotActive();
    error GameNotRequestingVRF();
    error OnlyEntropy();
    error InsufficientBalance();
    error TransferFailed();
    error OnlyOwner();
    error ZeroAddress();
    error InsufficientFee();

    // ============ MODIFIERS ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ============ CONSTRUCTOR ============

    /// @notice Initialize the solo game contract
    /// @param _entropy Address of Pyth Entropy contract
    /// @param _entropyProvider Address of the entropy provider
    constructor(
        address _entropy,
        address _entropyProvider
    ) {
        if (_entropy == address(0) || _entropyProvider == address(0)) {
            revert ZeroAddress();
        }
        entropy = IEntropy(_entropy);
        entropyProvider = _entropyProvider;
        owner = msg.sender;
    }

    // ============ EXTERNAL FUNCTIONS ============

    /// @notice Start a new solo game with a bet
    /// @return gameId The ID of the created game
    function startSoloGame() external payable returns (uint256 gameId) {
        // Get VRF fee first to calculate actual bet
        uint256 vrfFee = entropy.getFee(entropyProvider);
        if (msg.value <= vrfFee) revert InsufficientFee();

        uint256 betAmount = msg.value - vrfFee;
        if (betAmount < MIN_BET) revert BetTooSmall();
        if (betAmount > MAX_BET) revert BetTooLarge();

        // Calculate max potential payout (at 49 bands ~3.35x) and check balance can cover
        uint256 maxPayout = getMaxPayout(betAmount);
        if (balance < maxPayout) revert InsufficientBalance();

        gameId = ++soloGameCounter;

        bytes32 userRandomNumber = keccak256(
            abi.encodePacked(block.timestamp, block.prevrandao, gameId, msg.sender)
        );

        uint64 sequenceNumber = entropy.requestWithCallback{value: vrfFee}(
            entropyProvider,
            userRandomNumber
        );

        SoloGame storage game = soloGames[gameId];
        game.player = msg.sender;
        game.betAmount = betAmount;
        game.currentBands = 0;
        game.currentMultiplier = BASIS_POINTS; // 1.0x
        game.state = SoloState.REQUESTING_VRF;
        game.vrfSequence = sequenceNumber;
        game.createdAt = block.timestamp;
        game.gasPrice = tx.gasprice; // Record gas price for reimbursement

        vrfRequestToGame[sequenceNumber] = gameId;
        playerGames[msg.sender].push(gameId);

        emit SoloGameStarted(gameId, msg.sender, game.betAmount, sequenceNumber);
    }

    /// @notice Add a rubber band to the watermelon
    /// @param gameId The game ID
    function soloAddBand(uint256 gameId) external {
        SoloGame storage game = soloGames[gameId];
        if (game.player != msg.sender) revert NotYourGame();
        if (game.state != SoloState.ACTIVE) revert GameNotActive();

        game.currentBands++;
        game.currentMultiplier = getMultiplierForBands(game.currentBands);

        if (game.currentBands >= game.snapThreshold) {
            // BOOM! Watermelon explodes
            game.state = SoloState.EXPLODED;
            // Pool keeps the bet
            balance += game.betAmount;

            emit SoloExploded(gameId, msg.sender, game.currentBands, game.snapThreshold);
        } else {
            uint256 potentialPayout = (game.betAmount * game.currentMultiplier) / BASIS_POINTS;
            emit SoloBandAdded(gameId, game.currentBands, game.currentMultiplier, potentialPayout);
        }
    }

    /// @notice Cash out current winnings
    /// @param gameId The game ID
    function soloCashOut(uint256 gameId) external {
        SoloGame storage game = soloGames[gameId];
        if (game.player != msg.sender) revert NotYourGame();
        if (game.state != SoloState.ACTIVE) revert GameNotActive();

        game.state = SoloState.CASHED_OUT;

        uint256 grossPayout = (game.betAmount * game.currentMultiplier) / BASIS_POINTS;
        uint256 fee = (grossPayout * PROTOCOL_FEE_BPS) / BASIS_POINTS;
        uint256 netPayout = grossPayout - fee;

        // Calculate gas reimbursement if enabled
        uint256 gasReimbursement = 0;
        if (gasReimbursementEnabled == 1) {
            // Reimburse for: all addBand calls + this cashOut call
            uint256 totalGas = (game.currentBands * GAS_PER_BAND) + GAS_PER_CASHOUT;
            gasReimbursement = totalGas * game.gasPrice;

            // Cap reimbursement to available balance to prevent issues
            if (gasReimbursement > balance) {
                gasReimbursement = balance;
            }
        }

        // Update pool balance
        uint256 totalPayout = netPayout + gasReimbursement;
        if (totalPayout > game.betAmount) {
            balance -= (totalPayout - game.betAmount);
        } else {
            balance += (game.betAmount - totalPayout);
        }

        // Emit events for off-chain tracking
        emit ProtocolFee(gameId, fee);
        if (gasReimbursement > 0) {
            emit GasReimbursement(gameId, gasReimbursement);
        }

        // Send payout to player (includes gas reimbursement)
        (bool payoutSuccess, ) = msg.sender.call{value: totalPayout}("");
        if (!payoutSuccess) revert TransferFailed();

        emit SoloCashOut(gameId, msg.sender, totalPayout, game.currentBands, game.snapThreshold);
    }

    /// @notice Pyth Entropy callback when VRF is fulfilled
    /// @param sequenceNumber The request sequence number
    /// @param randomNumber The generated random number
    function entropyCallback(
        uint64 sequenceNumber,
        address,
        bytes32 randomNumber
    ) external override {
        if (msg.sender != address(entropy)) revert OnlyEntropy();

        uint256 gameId = vrfRequestToGame[sequenceNumber];
        SoloGame storage game = soloGames[gameId];

        if (game.state != SoloState.REQUESTING_VRF) revert GameNotRequestingVRF();

        // Calculate threshold in range [SOLO_MIN_THRESHOLD, SOLO_MAX_THRESHOLD]
        uint256 range = SOLO_MAX_THRESHOLD - SOLO_MIN_THRESHOLD + 1;
        uint256 threshold = SOLO_MIN_THRESHOLD + (uint256(randomNumber) % range);

        game.snapThreshold = threshold;
        game.state = SoloState.ACTIVE;

        emit SoloGameReady(gameId, game.player);
    }

    // ============ VIEW FUNCTIONS ============

    /// @notice Calculate multiplier for a given number of bands (2.5% exponential growth)
    /// @param bands Number of bands placed
    /// @return multiplier The multiplier in basis points (10000 = 1.0x)
    function getMultiplierForBands(uint256 bands) public pure returns (uint256 multiplier) {
        // Exponential growth: 1.025^bands
        // Examples:
        //   0 bands  -> 1.00x (10000)
        //   5 bands  -> 1.13x (11314)
        //   10 bands -> 1.28x (12801)
        //   15 bands -> 1.45x (14483)
        //   20 bands -> 1.64x (16386)
        //   25 bands -> 1.85x (18539)
        //   30 bands -> 2.10x (20976)
        //   49 bands -> 3.35x (33533)

        multiplier = BASIS_POINTS;
        for (uint256 i = 0; i < bands; i++) {
            multiplier = (multiplier * (BASIS_POINTS + MULTIPLIER_RATE_BPS)) / BASIS_POINTS;
        }
    }

    /// @notice Calculate max possible payout for a bet (at 49 bands)
    /// @param betAmount The bet amount
    /// @return maxPayout The maximum possible payout
    function getMaxPayout(uint256 betAmount) public pure returns (uint256 maxPayout) {
        uint256 maxMultiplier = getMultiplierForBands(SOLO_MAX_THRESHOLD - 1); // 49 bands
        maxPayout = (betAmount * maxMultiplier) / BASIS_POINTS;
    }

    /// @notice Get full game state for frontend
    /// @param gameId The game ID
    function getSoloGameState(uint256 gameId) external view returns (
        address player,
        uint256 betAmount,
        uint256 currentBands,
        uint256 currentMultiplier,
        SoloState state,
        uint256 potentialPayout,
        uint256 threshold, // Only meaningful after game ends
        uint256 createdAt
    ) {
        SoloGame storage game = soloGames[gameId];
        player = game.player;
        betAmount = game.betAmount;
        currentBands = game.currentBands;
        currentMultiplier = game.currentMultiplier;
        state = game.state;
        potentialPayout = (game.betAmount * game.currentMultiplier) / BASIS_POINTS;
        createdAt = game.createdAt;

        // Only reveal threshold after game is finished
        if (game.state == SoloState.CASHED_OUT || game.state == SoloState.EXPLODED) {
            threshold = game.snapThreshold;
        }
    }

    /// @notice Get player's game history
    /// @param player The player address
    function getPlayerGames(address player) external view returns (uint256[] memory) {
        return playerGames[player];
    }

    /// @notice Get current VRF fee
    function getVRFFee() external view returns (uint256) {
        return entropy.getFee(entropyProvider);
    }

    /// @notice Calculate potential payout for current game state
    /// @param gameId The game ID
    function getPotentialPayout(uint256 gameId) external view returns (uint256 gross, uint256 fee, uint256 net, uint256 gasReimbursement, uint256 total) {
        SoloGame storage game = soloGames[gameId];
        gross = (game.betAmount * game.currentMultiplier) / BASIS_POINTS;
        fee = (gross * PROTOCOL_FEE_BPS) / BASIS_POINTS;
        net = gross - fee;

        if (gasReimbursementEnabled == 1) {
            uint256 totalGas = (game.currentBands * GAS_PER_BAND) + GAS_PER_CASHOUT;
            gasReimbursement = totalGas * game.gasPrice;
        }
        total = net + gasReimbursement;
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Deposit funds to pool balance (for payouts)
    function deposit() external payable {
        balance += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice Withdraw from pool
    /// @param amount Amount to withdraw
    /// @param recipient Address to receive funds
    function withdraw(uint256 amount, address recipient) external onlyOwner {
        if (amount > balance) revert InsufficientBalance();
        if (recipient == address(0)) revert ZeroAddress();
        balance -= amount;

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Withdraw(recipient, amount);
    }

    /// @notice Transfer ownership
    /// @param newOwner New owner address
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Toggle gas reimbursement on/off
    /// @param enabled True to enable, false to disable
    function setGasReimbursement(bool enabled) external onlyOwner {
        gasReimbursementEnabled = enabled ? 1 : 0;
        emit GasReimbursementToggled(enabled);
    }

    /// @notice Receive ETH for pool balance
    receive() external payable {
        balance += msg.value;
        emit Deposit(msg.sender, msg.value);
    }
}

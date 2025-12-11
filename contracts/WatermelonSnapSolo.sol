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
    address public treasury;

    uint256 public soloGameCounter;
    uint256 public houseBalance;

    // ============ CONSTANTS ============

    uint256 public constant SOLO_MIN_THRESHOLD = 1;
    uint256 public constant SOLO_MAX_THRESHOLD = 50;
    uint256 public constant MIN_BET = 0.001 ether;
    uint256 public constant MAX_BET = 0.01 ether;
    uint256 public constant PROTOCOL_FEE_BPS = 500; // 5%
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MULTIPLIER_PER_BAND_BP = 200; // 2% per band
    uint256 public constant MULTIPLIER_CAP_BP = 15000; // 1.5x max

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

    event HouseDeposit(address indexed depositor, uint256 amount);
    event HouseWithdraw(address indexed recipient, uint256 amount);
    event TreasuryUpdated(address indexed newTreasury);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ============ ERRORS ============

    error BetTooSmall();
    error BetTooLarge();
    error NotYourGame();
    error GameNotActive();
    error GameNotRequestingVRF();
    error OnlyEntropy();
    error InsufficientHouseBalance();
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
    /// @param _treasury Address to receive protocol fees
    constructor(
        address _entropy,
        address _entropyProvider,
        address _treasury
    ) {
        if (_entropy == address(0) || _entropyProvider == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        entropy = IEntropy(_entropy);
        entropyProvider = _entropyProvider;
        treasury = _treasury;
        owner = msg.sender;
    }

    // ============ EXTERNAL FUNCTIONS ============

    /// @notice Start a new solo game with a bet
    /// @return gameId The ID of the created game
    function startSoloGame() external payable returns (uint256 gameId) {
        if (msg.value < MIN_BET) revert BetTooSmall();
        if (msg.value > MAX_BET) revert BetTooLarge();

        // Calculate max potential payout and check house can cover
        uint256 maxPayout = (msg.value * MULTIPLIER_CAP_BP) / BASIS_POINTS;
        if (houseBalance < maxPayout) revert InsufficientHouseBalance();

        gameId = ++soloGameCounter;

        // Request VRF for threshold
        uint256 vrfFee = entropy.getFee(entropyProvider);
        if (address(this).balance < vrfFee) revert InsufficientFee();

        bytes32 userRandomNumber = keccak256(
            abi.encodePacked(block.timestamp, block.prevrandao, gameId, msg.sender)
        );

        uint64 sequenceNumber = entropy.requestWithCallback{value: vrfFee}(
            entropyProvider,
            userRandomNumber
        );

        SoloGame storage game = soloGames[gameId];
        game.player = msg.sender;
        game.betAmount = msg.value - vrfFee; // Subtract VRF fee from bet
        game.currentBands = 0;
        game.currentMultiplier = BASIS_POINTS; // 1.0x
        game.state = SoloState.REQUESTING_VRF;
        game.vrfSequence = sequenceNumber;
        game.createdAt = block.timestamp;

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
            // House keeps the bet
            houseBalance += game.betAmount;

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

        // Calculate house profit/loss
        if (grossPayout > game.betAmount) {
            // House pays the difference
            uint256 housePays = grossPayout - game.betAmount;
            houseBalance -= housePays;
        } else {
            // House profits (player cashed out early)
            uint256 houseProfit = game.betAmount - grossPayout;
            houseBalance += houseProfit;
        }

        // Send fee to treasury
        (bool feeSuccess, ) = treasury.call{value: fee}("");
        if (!feeSuccess) revert TransferFailed();

        // Send payout to player
        (bool payoutSuccess, ) = msg.sender.call{value: netPayout}("");
        if (!payoutSuccess) revert TransferFailed();

        emit SoloCashOut(gameId, msg.sender, netPayout, game.currentBands, game.snapThreshold);
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

    /// @notice Calculate multiplier for a given number of bands
    /// @param bands Number of bands placed
    /// @return multiplier The multiplier in basis points (10000 = 1.0x)
    function getMultiplierForBands(uint256 bands) public pure returns (uint256 multiplier) {
        // Linear growth: 1.0x + 2% per band, capped at 1.5x
        // Examples:
        //   0 bands  -> 1.00x (10000)
        //   5 bands  -> 1.10x (11000)
        //   10 bands -> 1.20x (12000)
        //   15 bands -> 1.30x (13000)
        //   20 bands -> 1.40x (14000)
        //   25+ bands -> 1.50x (15000) CAP

        multiplier = BASIS_POINTS + (bands * MULTIPLIER_PER_BAND_BP);

        if (multiplier > MULTIPLIER_CAP_BP) {
            multiplier = MULTIPLIER_CAP_BP;
        }
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
    function getPotentialPayout(uint256 gameId) external view returns (uint256 gross, uint256 fee, uint256 net) {
        SoloGame storage game = soloGames[gameId];
        gross = (game.betAmount * game.currentMultiplier) / BASIS_POINTS;
        fee = (gross * PROTOCOL_FEE_BPS) / BASIS_POINTS;
        net = gross - fee;
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Deposit funds to house balance (for payouts)
    function depositToHouse() external payable {
        houseBalance += msg.value;
        emit HouseDeposit(msg.sender, msg.value);
    }

    /// @notice Withdraw house profits
    /// @param amount Amount to withdraw
    function withdrawFromHouse(uint256 amount) external onlyOwner {
        if (amount > houseBalance) revert InsufficientHouseBalance();
        houseBalance -= amount;

        (bool success, ) = treasury.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit HouseWithdraw(treasury, amount);
    }

    /// @notice Update treasury address
    /// @param newTreasury New treasury address
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    /// @notice Transfer ownership
    /// @param newOwner New owner address
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Receive ETH for house balance
    receive() external payable {
        houseBalance += msg.value;
        emit HouseDeposit(msg.sender, msg.value);
    }
}

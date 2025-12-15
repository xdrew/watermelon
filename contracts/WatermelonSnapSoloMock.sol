// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WatermelonSnapSoloMock - Solo Mode without VRF (for testing)
/// @notice Uses block hash for randomness - NOT for production
contract WatermelonSnapSoloMock {
    // ============ STATE VARIABLES ============

    address public owner;
    address public treasury;

    uint256 public soloGameCounter;
    uint256 public houseBalance;
    uint256 public protocolFees;

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
        ACTIVE,
        CASHED_OUT,
        EXPLODED
    }

    struct SoloGame {
        address player;
        uint256 betAmount;
        uint256 currentBands;
        uint256 snapThreshold;
        uint256 currentMultiplier;
        SoloState state;
        uint256 createdAt;
    }

    // ============ MAPPINGS ============

    mapping(uint256 => SoloGame) public soloGames;
    mapping(address => uint256[]) public playerGames;

    // ============ EVENTS ============

    event SoloGameStarted(
        uint256 indexed gameId,
        address indexed player,
        uint256 betAmount,
        uint256 threshold
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

    // ============ ERRORS ============

    error BetTooSmall();
    error BetTooLarge();
    error NotYourGame();
    error GameNotActive();
    error InsufficientHouseBalance();
    error TransferFailed();
    error OnlyOwner();
    error ZeroAddress();

    // ============ MODIFIERS ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(address _treasury) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        owner = msg.sender;
    }

    // ============ EXTERNAL FUNCTIONS ============

    /// @notice Start a new solo game with a bet
    function startSoloGame() external payable returns (uint256 gameId) {
        if (msg.value < MIN_BET) revert BetTooSmall();
        if (msg.value > MAX_BET) revert BetTooLarge();

        uint256 maxPayout = (msg.value * MULTIPLIER_CAP_BP) / BASIS_POINTS;
        if (houseBalance < maxPayout) revert InsufficientHouseBalance();

        gameId = ++soloGameCounter;

        // Generate threshold using block hash (NOT secure for production)
        uint256 range = SOLO_MAX_THRESHOLD - SOLO_MIN_THRESHOLD + 1;
        uint256 threshold = SOLO_MIN_THRESHOLD + (uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            gameId,
            msg.sender
        ))) % range);

        SoloGame storage game = soloGames[gameId];
        game.player = msg.sender;
        game.betAmount = msg.value;
        game.currentBands = 0;
        game.snapThreshold = threshold;
        game.currentMultiplier = BASIS_POINTS;
        game.state = SoloState.ACTIVE;
        game.createdAt = block.timestamp;

        playerGames[msg.sender].push(gameId);

        emit SoloGameStarted(gameId, msg.sender, msg.value, threshold);
    }

    /// @notice Add a rubber band to the watermelon
    function soloAddBand(uint256 gameId) external {
        SoloGame storage game = soloGames[gameId];
        if (game.player != msg.sender) revert NotYourGame();
        if (game.state != SoloState.ACTIVE) revert GameNotActive();

        game.currentBands++;
        game.currentMultiplier = getMultiplierForBands(game.currentBands);

        if (game.currentBands >= game.snapThreshold) {
            game.state = SoloState.EXPLODED;
            houseBalance += game.betAmount;
            emit SoloExploded(gameId, msg.sender, game.currentBands, game.snapThreshold);
        } else {
            uint256 potentialPayout = (game.betAmount * game.currentMultiplier) / BASIS_POINTS;
            emit SoloBandAdded(gameId, game.currentBands, game.currentMultiplier, potentialPayout);
        }
    }

    /// @notice Cash out current winnings
    function soloCashOut(uint256 gameId) external {
        SoloGame storage game = soloGames[gameId];
        if (game.player != msg.sender) revert NotYourGame();
        if (game.state != SoloState.ACTIVE) revert GameNotActive();

        game.state = SoloState.CASHED_OUT;

        uint256 grossPayout = (game.betAmount * game.currentMultiplier) / BASIS_POINTS;
        uint256 fee = (grossPayout * PROTOCOL_FEE_BPS) / BASIS_POINTS;
        uint256 netPayout = grossPayout - fee;

        if (grossPayout > game.betAmount) {
            uint256 housePays = grossPayout - game.betAmount;
            houseBalance -= housePays;
        } else {
            uint256 houseProfit = game.betAmount - grossPayout;
            houseBalance += houseProfit;
        }

        protocolFees += fee;

        (bool payoutSuccess, ) = msg.sender.call{value: netPayout}("");
        if (!payoutSuccess) revert TransferFailed();

        emit SoloCashOut(gameId, msg.sender, netPayout, game.currentBands, game.snapThreshold);
    }

    // ============ VIEW FUNCTIONS ============

    function getMultiplierForBands(uint256 bands) public pure returns (uint256 multiplier) {
        multiplier = BASIS_POINTS + (bands * MULTIPLIER_PER_BAND_BP);
        if (multiplier > MULTIPLIER_CAP_BP) {
            multiplier = MULTIPLIER_CAP_BP;
        }
    }

    function getSoloGameState(uint256 gameId) external view returns (
        address player,
        uint256 betAmount,
        uint256 currentBands,
        uint256 currentMultiplier,
        uint8 state,
        uint256 potentialPayout,
        uint256 threshold,
        uint256 createdAt
    ) {
        SoloGame storage game = soloGames[gameId];
        player = game.player;
        betAmount = game.betAmount;
        currentBands = game.currentBands;
        currentMultiplier = game.currentMultiplier;
        state = uint8(game.state) + 1; // Offset by 1 to match original (0=VRF, 1=ACTIVE)
        potentialPayout = (game.betAmount * game.currentMultiplier) / BASIS_POINTS;
        threshold = game.snapThreshold;
        createdAt = game.createdAt;
    }

    function getPlayerGames(address player) external view returns (uint256[] memory) {
        return playerGames[player];
    }

    function getVRFFee() external pure returns (uint256) {
        return 0; // No VRF fee in mock
    }

    // ============ ADMIN FUNCTIONS ============

    function depositToHouse() external payable {
        houseBalance += msg.value;
        emit HouseDeposit(msg.sender, msg.value);
    }

    function withdrawFromHouse(uint256 amount) external onlyOwner {
        if (amount > houseBalance) revert InsufficientHouseBalance();
        houseBalance -= amount;
        (bool success, ) = treasury.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit HouseWithdraw(treasury, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = protocolFees;
        protocolFees = 0;
        (bool success, ) = treasury.call{value: fees}("");
        if (!success) revert TransferFailed();
    }

    receive() external payable {
        houseBalance += msg.value;
        emit HouseDeposit(msg.sender, msg.value);
    }
}

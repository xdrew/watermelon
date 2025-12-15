// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IEntropy.sol";

/// @title WatermelonSnapSolo - Arcade Mode with Leaderboard
/// @notice Hyper-casual game where players compete for high scores on a leaderboard
/// @dev Uses Pyth Entropy for verifiable random threshold generation
contract WatermelonSnapSolo is IEntropyConsumer {
    // ============ STATE VARIABLES ============

    IEntropy public immutable entropy;
    address public immutable entropyProvider;
    address public owner;

    uint256 public soloGameCounter;
    uint256 public currentSeason;
    uint256 public prizePool;
    uint256 public protocolBalance;
    uint256 public seasonStartTime;

    // ============ CONSTANTS ============

    uint256 public constant SOLO_MIN_THRESHOLD = 1;
    uint256 public constant SOLO_MAX_THRESHOLD = 50;
    uint256 public constant ENTRY_FEE = 0.01 ether;
    uint256 public constant PRIZE_POOL_BPS = 9000; // 90% to prize pool
    uint256 public constant PROTOCOL_FEE_BPS = 1000; // 10% protocol fee
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MULTIPLIER_RATE_BPS = 250; // 2.5% exponential growth per band
    uint256 public constant SEASON_DURATION = 1 days;

    // ============ STRUCTS ============

    enum SoloState {
        REQUESTING_VRF,  // Waiting for threshold
        ACTIVE,          // Player adding bands
        SCORED,          // Player cashed out with score
        EXPLODED         // Watermelon exploded (0 score)
    }

    struct SoloGame {
        address player;
        uint256 currentBands;
        uint256 snapThreshold;
        uint256 currentMultiplier; // In basis points (10000 = 1.0x)
        uint256 score;
        uint256 season;
        SoloState state;
        uint64 vrfSequence;
        uint256 createdAt;
    }

    // ============ MAPPINGS ============

    mapping(uint256 => SoloGame) public soloGames;
    mapping(uint64 => uint256) public vrfRequestToGame;
    mapping(address => uint256[]) public playerGames;

    // Leaderboard: season => player => best score (for verification)
    mapping(uint256 => mapping(address => uint256)) public playerBestScore;
    mapping(uint256 => mapping(address => uint256)) public playerBestGameId;

    // Season tracking
    mapping(uint256 => uint256) public seasonPrizePool;
    mapping(uint256 => bool) public seasonFinalized;

    // ============ EVENTS ============

    event SoloGameStarted(
        uint256 indexed gameId,
        uint256 indexed season,
        address indexed player,
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
        uint256 potentialScore
    );

    event SoloScored(
        uint256 indexed gameId,
        uint256 indexed season,
        address indexed player,
        uint256 score,
        uint256 bands,
        uint256 threshold
    );

    event SoloExploded(
        uint256 indexed gameId,
        uint256 indexed season,
        address indexed player,
        uint256 bandsAtExplosion,
        uint256 threshold
    );

    event NewHighScore(
        uint256 indexed season,
        address indexed player,
        uint256 score,
        uint256 gameId
    );

    event SeasonStarted(uint256 indexed season, uint256 startTime);
    event SeasonFinalized(uint256 indexed season, uint256 totalPrize);
    event PrizeDistributed(uint256 indexed season, address indexed winner, uint256 rank, uint256 amount);
    event Deposit(address indexed depositor, uint256 amount);
    event Withdraw(address indexed recipient, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ============ ERRORS ============

    error IncorrectEntryFee();
    error NotYourGame();
    error GameNotActive();
    error GameNotRequestingVRF();
    error OnlyEntropy();
    error InsufficientBalance();
    error TransferFailed();
    error OnlyOwner();
    error ZeroAddress();
    error InsufficientFee();
    error SeasonAlreadyFinalized();
    error SeasonNotOver();
    error InvalidWinners();

    // ============ MODIFIERS ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ============ CONSTRUCTOR ============

    /// @notice Initialize the arcade game contract
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

        // Start first season
        currentSeason = 1;
        seasonStartTime = block.timestamp;
        emit SeasonStarted(1, block.timestamp);
    }

    // ============ EXTERNAL FUNCTIONS ============

    /// @notice Start a new game with fixed entry fee
    /// @return gameId The ID of the created game
    function startGame() external payable returns (uint256 gameId) {
        // Check for new season
        _checkAndStartNewSeason();

        // Get VRF fee
        uint256 vrfFee = entropy.getFee(entropyProvider);
        uint256 totalRequired = ENTRY_FEE + vrfFee;
        if (msg.value < totalRequired) revert InsufficientFee();

        // Refund excess
        if (msg.value > totalRequired) {
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - totalRequired}("");
            if (!refundSuccess) revert TransferFailed();
        }

        // Split entry fee
        uint256 toPrizePool = (ENTRY_FEE * PRIZE_POOL_BPS) / BASIS_POINTS;
        uint256 toProtocol = ENTRY_FEE - toPrizePool;

        prizePool += toPrizePool;
        seasonPrizePool[currentSeason] += toPrizePool;
        protocolBalance += toProtocol;

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
        game.currentBands = 0;
        game.currentMultiplier = BASIS_POINTS; // 1.0x
        game.state = SoloState.REQUESTING_VRF;
        game.vrfSequence = sequenceNumber;
        game.createdAt = block.timestamp;
        game.season = currentSeason;

        vrfRequestToGame[sequenceNumber] = gameId;
        playerGames[msg.sender].push(gameId);

        emit SoloGameStarted(gameId, currentSeason, msg.sender, sequenceNumber);
    }

    /// @notice Add a rubber band to the watermelon
    /// @param gameId The game ID
    function addBand(uint256 gameId) external {
        SoloGame storage game = soloGames[gameId];
        if (game.player != msg.sender) revert NotYourGame();
        if (game.state != SoloState.ACTIVE) revert GameNotActive();

        game.currentBands++;
        game.currentMultiplier = getMultiplierForBands(game.currentBands);

        if (game.currentBands >= game.snapThreshold) {
            // BOOM! Watermelon explodes - score is 0
            game.state = SoloState.EXPLODED;
            game.score = 0;

            emit SoloExploded(gameId, game.season, msg.sender, game.currentBands, game.snapThreshold);
        } else {
            uint256 potentialScore = calculateScore(game.currentBands, game.currentMultiplier);
            emit SoloBandAdded(gameId, game.currentBands, game.currentMultiplier, potentialScore);
        }
    }

    /// @notice Cash out and record score
    /// @param gameId The game ID
    function cashOut(uint256 gameId) external {
        SoloGame storage game = soloGames[gameId];
        if (game.player != msg.sender) revert NotYourGame();
        if (game.state != SoloState.ACTIVE) revert GameNotActive();

        game.state = SoloState.SCORED;
        game.score = calculateScore(game.currentBands, game.currentMultiplier);

        // Update best score if this is a new high
        uint256 season = game.season;
        if (game.score > playerBestScore[season][msg.sender]) {
            playerBestScore[season][msg.sender] = game.score;
            playerBestGameId[season][msg.sender] = gameId;
            emit NewHighScore(season, msg.sender, game.score, gameId);
        }

        emit SoloScored(gameId, season, msg.sender, game.score, game.currentBands, game.snapThreshold);
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

    /// @notice Distribute prizes to winners (called by owner with verified data)
    /// @param season The season to distribute prizes for
    /// @param winners Array of winner addresses (in order: 1st, 2nd, 3rd, etc.)
    /// @param amounts Array of prize amounts for each winner
    function distributePrizes(
        uint256 season,
        address[] calldata winners,
        uint256[] calldata amounts
    ) external onlyOwner {
        if (seasonFinalized[season]) revert SeasonAlreadyFinalized();
        if (season == currentSeason && block.timestamp < seasonStartTime + SEASON_DURATION) {
            revert SeasonNotOver();
        }
        if (winners.length != amounts.length || winners.length == 0) revert InvalidWinners();

        uint256 totalDistributed = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalDistributed += amounts[i];
        }

        uint256 availablePrize = seasonPrizePool[season];
        if (totalDistributed > availablePrize) revert InsufficientBalance();

        seasonFinalized[season] = true;

        // Deduct from prize pool
        prizePool -= totalDistributed;

        // Distribute to winners
        for (uint256 i = 0; i < winners.length; i++) {
            if (winners[i] == address(0)) continue;

            (bool success, ) = winners[i].call{value: amounts[i]}("");
            if (!success) revert TransferFailed();

            emit PrizeDistributed(season, winners[i], i + 1, amounts[i]);
        }

        emit SeasonFinalized(season, totalDistributed);
    }

    // ============ VIEW FUNCTIONS ============

    /// @notice Calculate score for given bands and multiplier
    /// @param bands Number of bands
    /// @param multiplier Multiplier in basis points
    /// @return score The calculated score (bands * multiplier / 100)
    function calculateScore(uint256 bands, uint256 multiplier) public pure returns (uint256 score) {
        // Score = bands × (multiplier / 10000) × 100 for nicer numbers
        // Simplified: bands × multiplier / 100
        score = (bands * multiplier) / 100;
    }

    /// @notice Calculate multiplier for a given number of bands (2.5% exponential growth)
    /// @param bands Number of bands placed
    /// @return multiplier The multiplier in basis points (10000 = 1.0x)
    function getMultiplierForBands(uint256 bands) public pure returns (uint256 multiplier) {
        multiplier = BASIS_POINTS;
        for (uint256 i = 0; i < bands; i++) {
            multiplier = (multiplier * (BASIS_POINTS + MULTIPLIER_RATE_BPS)) / BASIS_POINTS;
        }
    }

    /// @notice Get full game state for frontend
    /// @param gameId The game ID
    function getGameState(uint256 gameId) external view returns (
        address player,
        uint256 currentBands,
        uint256 currentMultiplier,
        uint256 potentialScore,
        uint256 score,
        uint256 season,
        SoloState state,
        uint256 threshold,
        uint256 createdAt
    ) {
        SoloGame storage game = soloGames[gameId];
        player = game.player;
        currentBands = game.currentBands;
        currentMultiplier = game.currentMultiplier;
        potentialScore = calculateScore(game.currentBands, game.currentMultiplier);
        score = game.score;
        season = game.season;
        state = game.state;
        createdAt = game.createdAt;

        // Only reveal threshold after game is finished
        if (game.state == SoloState.SCORED || game.state == SoloState.EXPLODED) {
            threshold = game.snapThreshold;
        }
    }

    /// @notice Get player's best score for a season
    /// @param season The season number
    /// @param player The player address
    function getPlayerSeasonBest(uint256 season, address player) external view returns (
        uint256 bestScore,
        uint256 bestGameId
    ) {
        bestScore = playerBestScore[season][player];
        bestGameId = playerBestGameId[season][player];
    }

    /// @notice Get current season info
    function getSeasonInfo() external view returns (
        uint256 season,
        uint256 pool,
        uint256 startTime,
        uint256 endTime,
        bool finalized
    ) {
        season = currentSeason;
        pool = seasonPrizePool[currentSeason];
        startTime = seasonStartTime;
        endTime = seasonStartTime + SEASON_DURATION;
        finalized = seasonFinalized[currentSeason];
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

    /// @notice Get total cost to start a game
    function getGameCost() external view returns (uint256 entryFee, uint256 vrfFee, uint256 total) {
        entryFee = ENTRY_FEE;
        vrfFee = entropy.getFee(entropyProvider);
        total = entryFee + vrfFee;
    }

    // ============ INTERNAL FUNCTIONS ============

    /// @notice Check if season has ended and start new one
    function _checkAndStartNewSeason() internal {
        if (block.timestamp >= seasonStartTime + SEASON_DURATION) {
            currentSeason++;
            seasonStartTime = block.timestamp;
            emit SeasonStarted(currentSeason, block.timestamp);
        }
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Manually start a new season (owner only)
    function startNewSeason() external onlyOwner {
        currentSeason++;
        seasonStartTime = block.timestamp;
        emit SeasonStarted(currentSeason, block.timestamp);
    }

    /// @notice Withdraw protocol fees
    /// @param amount Amount to withdraw
    /// @param recipient Address to receive funds
    function withdrawProtocolFees(uint256 amount, address recipient) external onlyOwner {
        if (amount > protocolBalance) revert InsufficientBalance();
        if (recipient == address(0)) revert ZeroAddress();
        protocolBalance -= amount;

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Withdraw(recipient, amount);
    }

    /// @notice Add funds to prize pool (sponsorship)
    function sponsorPrizePool() external payable {
        prizePool += msg.value;
        seasonPrizePool[currentSeason] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice Transfer ownership
    /// @param newOwner New owner address
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Receive ETH as prize pool sponsorship
    receive() external payable {
        prizePool += msg.value;
        seasonPrizePool[currentSeason] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }
}

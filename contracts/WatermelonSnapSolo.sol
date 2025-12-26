// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IEntropy.sol";

/// @title WatermelonSnapSolo - Arcade Mode with Leaderboard
/// @notice Hyper-casual game where players compete for high scores on a leaderboard
/// @dev Uses Pyth Entropy for verifiable random threshold generation
contract WatermelonSnapSolo is IEntropyConsumer {
    // ============ STATE VARIABLES ============

    IEntropy public immutable entropy;
    uint256 public immutable entryFee;
    address public owner;

    uint256 public soloGameCounter;
    uint256 public currentSeason;
    uint256 public prizePool;
    uint256 public protocolBalance;
    uint256 public seasonStartTime;
    bool public paused;

    // Reentrancy guard
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private _status;

    // Precomputed multipliers for O(1) lookup (1.15^n in basis points)
    uint256[16] private MULTIPLIER_TABLE;

    // ============ CONSTANTS ============

    uint256 public constant SOLO_MIN_THRESHOLD = 1;
    uint256 public constant SOLO_MAX_THRESHOLD = 15;
    uint256 public constant MIN_ENTRY_FEE = 0.001 ether;
    uint256 public constant MAX_ENTRY_FEE = 10 ether;
    uint256 public constant PRIZE_POOL_BPS = 9000; // 90% to prize pool
    uint256 public constant PROTOCOL_FEE_BPS = 1000; // 10% protocol fee
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MULTIPLIER_RATE_BPS = 1500; // 15% exponential growth per band
    uint256 public constant SEASON_DURATION = 1 days;
    uint256 public constant STALE_GAME_TIMEOUT = 1 hours; // Time after which VRF game can be cancelled
    uint256 public constant LEADERBOARD_SIZE = 10; // Top N players per season
    uint256 public constant MAX_GAMES_PER_PAGE = 50; // Pagination limit
    uint256 public constant CALLER_REWARD_BPS = 100; // 1% reward for triggering distribution
    uint32 public constant CALLBACK_GAS_LIMIT = 100_000; // Gas limit for entropy callback

    // Prize distribution shares in basis points (must sum to 10000)
    // 1st: 40%, 2nd: 25%, 3rd: 15%, 4th: 8%, 5th: 5%, 6th-10th: 1.4% each
    uint256[10] private PRIZE_SHARES = [4000, 2500, 1500, 800, 500, 140, 140, 140, 140, 140];

    // ============ STRUCTS ============

    enum SoloState {
        REQUESTING_VRF,  // Waiting for threshold
        ACTIVE,          // Player adding bands
        SCORED,          // Player cashed out with score
        EXPLODED,        // Watermelon exploded (0 score)
        CANCELLED        // Game cancelled due to stale VRF
    }

    /// @dev Packed struct uses 2 storage slots instead of 9
    /// Slot 0: player (20) + currentBands (1) + snapThreshold (1) + state (1) = 23 bytes
    /// Slot 1: vrfSequence (8) + currentMultiplier (4) + score (4) + season (4) + createdAt (5) = 25 bytes
    struct SoloGame {
        // Slot 0
        address player;              // 20 bytes
        uint8 currentBands;          // 1 byte (max 15)
        uint8 snapThreshold;         // 1 byte (max 15)
        SoloState state;             // 1 byte (enum)
        // Slot 1
        uint64 vrfSequence;          // 8 bytes
        uint32 currentMultiplier;    // 4 bytes (max ~33530 basis points)
        uint32 score;                // 4 bytes (max ~16430)
        uint32 season;               // 4 bytes (enough for 136 years of daily seasons)
        uint40 createdAt;            // 5 bytes (good until year 36812)
    }

    struct LeaderboardEntry {
        address player;
        uint256 score;
        uint256 gameId;
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

    // On-chain leaderboard: season => sorted array of top scores
    mapping(uint256 => LeaderboardEntry[]) public seasonLeaderboard;

    // Operator authorization: user => authorized operator (burner wallet)
    mapping(address => address) public authorizedOperator;

    // Operator spending limits: user => remaining allowance (in wei)
    // 0 means unlimited (default for backwards compatibility)
    mapping(address => uint256) public operatorAllowance;

    // Pull-over-push: pending prize claims (protects against griefing)
    mapping(address => uint256) public pendingPrizes;

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
        uint256 threshold,
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
    event SoloGameCancelled(uint256 indexed gameId, address indexed player, uint256 refundAmount);
    event LeaderboardUpdated(uint256 indexed season, address indexed player, uint256 score, uint256 rank);
    event SeasonAutoFinalized(uint256 indexed season, address indexed triggeredBy, uint256 callerReward, uint256 totalDistributed);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OperatorAuthorized(address indexed user, address indexed operator);
    event OperatorRevoked(address indexed user, address indexed operator);
    event OperatorAllowanceSet(address indexed user, uint256 allowance);
    event PrizeAllocated(address indexed winner, uint256 amount);
    event PrizeClaimed(address indexed winner, uint256 amount);

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
    error InvalidEntryFee();
    error InsufficientFee();
    error SeasonAlreadyFinalized();
    error SeasonNotOver();
    error InvalidWinners();
    error ReentrancyGuardReentrantCall();
    error GameNotStale();
    error GameAlreadyCancelled();
    error ScoreOverflow();
    error NoPrizePool();
    error NoWinners();
    error ContractPaused();
    error NotAuthorizedOperator();
    error NoPrizeToClaim();
    error InsufficientOperatorAllowance();

    // ============ MODIFIERS ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier nonReentrant() {
        if (_status == ENTERED) revert ReentrancyGuardReentrantCall();
        _status = ENTERED;
        _;
        _status = NOT_ENTERED;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    // ============ CONSTRUCTOR ============

    /// @notice Initialize the arcade game contract
    /// @param _entropy Address of Pyth Entropy contract
    /// @param _entryFee Entry fee in wei
    constructor(
        address _entropy,
        uint256 _entryFee
    ) {
        if (_entropy == address(0)) {
            revert ZeroAddress();
        }
        if (_entryFee < MIN_ENTRY_FEE || _entryFee > MAX_ENTRY_FEE) {
            revert InvalidEntryFee();
        }
        entropy = IEntropy(_entropy);
        entryFee = _entryFee;
        owner = msg.sender;

        // Initialize reentrancy guard
        _status = NOT_ENTERED;

        // Precompute multiplier table for O(1) lookup
        // MULTIPLIER_TABLE[n] = 1.15^n in basis points
        uint256 multiplier = BASIS_POINTS;
        for (uint256 i = 0; i <= SOLO_MAX_THRESHOLD; i++) {
            MULTIPLIER_TABLE[i] = multiplier;
            multiplier = (multiplier * (BASIS_POINTS + MULTIPLIER_RATE_BPS)) / BASIS_POINTS;
        }

        // Start first season
        currentSeason = 1;
        seasonStartTime = block.timestamp;
        emit SeasonStarted(1, block.timestamp);
    }

    // ============ EXTERNAL FUNCTIONS ============

    /// @notice Start a new game with fixed entry fee
    /// @return gameId The ID of the created game
    function startGame() external payable whenNotPaused returns (uint256 gameId) {
        // Check for new season
        _checkAndStartNewSeason();

        // Get VRF fee
        uint256 vrfFee = entropy.getFeeV2();
        uint256 totalRequired = entryFee + vrfFee;
        if (msg.value < totalRequired) revert InsufficientFee();

        // Refund excess
        if (msg.value > totalRequired) {
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - totalRequired}("");
            if (!refundSuccess) revert TransferFailed();
        }

        // Split entry fee
        uint256 toPrizePool = (entryFee * PRIZE_POOL_BPS) / BASIS_POINTS;
        uint256 toProtocol = entryFee - toPrizePool;

        prizePool += toPrizePool;
        seasonPrizePool[currentSeason] += toPrizePool;
        protocolBalance += toProtocol;

        gameId = ++soloGameCounter;

        // Request random number from Pyth Entropy v2 with custom callback gas limit
        uint64 sequenceNumber = entropy.requestV2{value: vrfFee}(CALLBACK_GAS_LIMIT);

        SoloGame storage game = soloGames[gameId];
        game.player = msg.sender;
        game.currentBands = 0;
        game.currentMultiplier = uint32(BASIS_POINTS); // 1.0x
        game.state = SoloState.REQUESTING_VRF;
        game.vrfSequence = sequenceNumber;
        game.createdAt = uint40(block.timestamp);
        game.season = uint32(currentSeason);

        vrfRequestToGame[sequenceNumber] = gameId;
        playerGames[msg.sender].push(gameId);

        emit SoloGameStarted(gameId, currentSeason, msg.sender, sequenceNumber);
    }

    /// @notice Authorize an operator (burner wallet) to play on your behalf
    /// @param operator The operator address to authorize
    function authorizeOperator(address operator) external {
        if (operator == address(0)) revert ZeroAddress();
        authorizedOperator[msg.sender] = operator;
        emit OperatorAuthorized(msg.sender, operator);
    }

    /// @notice Set spending allowance for operator (0 = unlimited)
    /// @param allowance Maximum amount operator can spend (in wei)
    function setOperatorAllowance(uint256 allowance) external {
        operatorAllowance[msg.sender] = allowance;
        emit OperatorAllowanceSet(msg.sender, allowance);
    }

    /// @notice Revoke operator authorization
    function revokeOperator() external {
        address operator = authorizedOperator[msg.sender];
        if (operator != address(0)) {
            delete authorizedOperator[msg.sender];
            delete operatorAllowance[msg.sender];
            emit OperatorRevoked(msg.sender, operator);
        }
    }

    /// @notice Start a game on behalf of another user (operator only)
    /// @param player The user to start the game for
    /// @return gameId The ID of the created game
    function startGameFor(address player) external payable whenNotPaused returns (uint256 gameId) {
        if (authorizedOperator[player] != msg.sender) revert NotAuthorizedOperator();

        // Check for new season
        _checkAndStartNewSeason();

        // Get VRF fee
        uint256 vrfFee = entropy.getFeeV2();
        uint256 totalRequired = entryFee + vrfFee;
        if (msg.value < totalRequired) revert InsufficientFee();

        // Check and deduct operator allowance (0 means unlimited)
        uint256 allowance = operatorAllowance[player];
        if (allowance > 0) {
            if (allowance < totalRequired) revert InsufficientOperatorAllowance();
            operatorAllowance[player] = allowance - totalRequired;
        }

        // Refund excess
        if (msg.value > totalRequired) {
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - totalRequired}("");
            if (!refundSuccess) revert TransferFailed();
        }

        // Split entry fee
        uint256 toPrizePool = (entryFee * PRIZE_POOL_BPS) / BASIS_POINTS;
        uint256 toProtocol = entryFee - toPrizePool;

        prizePool += toPrizePool;
        seasonPrizePool[currentSeason] += toPrizePool;
        protocolBalance += toProtocol;

        gameId = ++soloGameCounter;

        // Request random number from Pyth Entropy v2 with custom callback gas limit
        uint64 sequenceNumber = entropy.requestV2{value: vrfFee}(CALLBACK_GAS_LIMIT);

        SoloGame storage game = soloGames[gameId];
        game.player = player; // Game belongs to the user, not the operator
        game.currentBands = 0;
        game.currentMultiplier = uint32(BASIS_POINTS);
        game.state = SoloState.REQUESTING_VRF;
        game.vrfSequence = sequenceNumber;
        game.createdAt = uint40(block.timestamp);
        game.season = uint32(currentSeason);

        vrfRequestToGame[sequenceNumber] = gameId;
        playerGames[player].push(gameId);

        emit SoloGameStarted(gameId, currentSeason, player, sequenceNumber);
    }

    /// @notice Add a rubber band to the watermelon
    /// @param gameId The game ID
    function addBand(uint256 gameId) external {
        SoloGame storage game = soloGames[gameId];
        if (!_isPlayerOrOperator(game.player)) revert NotYourGame();
        if (game.state != SoloState.ACTIVE) revert GameNotActive();

        game.currentBands++;
        game.currentMultiplier = uint32(getMultiplierForBands(game.currentBands));

        if (game.currentBands >= game.snapThreshold) {
            // BOOM! Watermelon explodes - score is 0
            game.state = SoloState.EXPLODED;
            game.score = 0;

            emit SoloExploded(gameId, uint256(game.season), msg.sender, game.currentBands, game.snapThreshold);
        } else {
            uint256 potentialScore = calculateScore(game.currentBands, game.snapThreshold);
            emit SoloBandAdded(gameId, game.currentBands, game.snapThreshold, potentialScore);
        }
    }

    /// @notice Cash out and record score
    /// @param gameId The game ID
    function cashOut(uint256 gameId) external {
        SoloGame storage game = soloGames[gameId];
        if (!_isPlayerOrOperator(game.player)) revert NotYourGame();
        if (game.state != SoloState.ACTIVE) revert GameNotActive();

        game.state = SoloState.SCORED;
        uint256 calculatedScore = calculateScore(game.currentBands, game.snapThreshold);
        if (calculatedScore > type(uint32).max) revert ScoreOverflow();
        game.score = uint32(calculatedScore);

        // Update best score if this matches or beats personal best
        // Using >= allows players to reclaim leaderboard position by matching their score
        address player = game.player;
        uint256 season = uint256(game.season);
        uint256 score = uint256(game.score);
        if (score >= playerBestScore[season][player]) {
            playerBestScore[season][player] = score;
            playerBestGameId[season][player] = gameId;
            emit NewHighScore(season, player, score, gameId);

            // Update on-chain leaderboard
            _updateLeaderboard(season, player, score, gameId);
        }

        emit SoloScored(gameId, season, player, score, game.currentBands, game.snapThreshold);
    }

    /// @notice Cancel a stale game stuck in REQUESTING_VRF state and refund player
    /// @param gameId The game ID to cancel
    function cancelStaleGame(uint256 gameId) external nonReentrant {
        SoloGame storage game = soloGames[gameId];
        if (game.player != msg.sender) revert NotYourGame();
        if (game.state != SoloState.REQUESTING_VRF) revert GameNotRequestingVRF();
        if (block.timestamp < game.createdAt + STALE_GAME_TIMEOUT) revert GameNotStale();

        game.state = SoloState.CANCELLED;

        // Calculate refund (entry fee portion that went to prize pool)
        uint256 refundAmount = (entryFee * PRIZE_POOL_BPS) / BASIS_POINTS;

        // Deduct from prize pool and season prize pool
        if (prizePool >= refundAmount) {
            prizePool -= refundAmount;
            if (seasonPrizePool[game.season] >= refundAmount) {
                seasonPrizePool[game.season] -= refundAmount;
            }

            // Refund to player
            (bool success, ) = msg.sender.call{value: refundAmount}("");
            if (!success) revert TransferFailed();
        } else {
            refundAmount = 0; // No refund if prize pool insufficient
        }

        emit SoloGameCancelled(gameId, msg.sender, refundAmount);
    }

    /// @notice Returns the entropy contract address (required by IEntropyConsumer)
    /// @return The entropy contract address
    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    /// @notice Pyth Entropy callback when VRF is fulfilled
    /// @param sequenceNumber The request sequence number
    /// @param randomNumber The generated random number
    function entropyCallback(
        uint64 sequenceNumber,
        address,
        bytes32 randomNumber
    ) internal override {
        // Caller validation done by _entropyCallback in IEntropyConsumer

        uint256 gameId = vrfRequestToGame[sequenceNumber];

        // Validate gameId exists (games start at 1, so 0 means no game)
        if (gameId == 0) return; // Silently ignore - don't revert in callback

        SoloGame storage game = soloGames[gameId];

        if (game.state != SoloState.REQUESTING_VRF) revert GameNotRequestingVRF();

        // Calculate threshold in range [SOLO_MIN_THRESHOLD, SOLO_MAX_THRESHOLD]
        uint256 range = SOLO_MAX_THRESHOLD - SOLO_MIN_THRESHOLD + 1;
        uint8 threshold = uint8(SOLO_MIN_THRESHOLD + (uint256(randomNumber) % range));

        game.snapThreshold = threshold;
        game.state = SoloState.ACTIVE;

        emit SoloGameReady(gameId, game.player);
    }

    /// @notice Finalize a season and distribute prizes (anyone can call after season ends)
    /// @dev Caller receives 1% reward for triggering distribution
    /// @param season The season to finalize
    function finalizeSeason(uint256 season) external nonReentrant {
        // Can only finalize past seasons, or current season if time has elapsed
        if (season == currentSeason && block.timestamp < seasonStartTime + SEASON_DURATION) {
            revert SeasonNotOver();
        }
        if (seasonFinalized[season]) revert SeasonAlreadyFinalized();
        if (seasonPrizePool[season] == 0) revert NoPrizePool();

        LeaderboardEntry[] storage leaderboard = seasonLeaderboard[season];
        if (leaderboard.length == 0) revert NoWinners();

        _autoDistributePrizes(season, msg.sender);
    }

    /// @notice Claim pending prize winnings (pull pattern)
    function claimPrize() external nonReentrant {
        uint256 amount = pendingPrizes[msg.sender];
        if (amount == 0) revert NoPrizeToClaim();

        pendingPrizes[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit PrizeClaimed(msg.sender, amount);
    }

    /// @notice Distribute prizes to winners (called by owner with verified data)
    /// @dev Uses pull pattern - prizes go to pendingPrizes mapping
    /// @param season The season to distribute prizes for
    /// @param winners Array of winner addresses (in order: 1st, 2nd, 3rd, etc.)
    /// @param amounts Array of prize amounts for each winner
    function distributePrizes(
        uint256 season,
        address[] calldata winners,
        uint256[] calldata amounts
    ) external onlyOwner nonReentrant {
        if (seasonFinalized[season]) revert SeasonAlreadyFinalized();
        if (season == currentSeason && block.timestamp < seasonStartTime + SEASON_DURATION) {
            revert SeasonNotOver();
        }
        if (winners.length != amounts.length || winners.length == 0) revert InvalidWinners();

        uint256 totalAllocated = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAllocated += amounts[i];
        }

        uint256 availablePrize = seasonPrizePool[season];
        if (totalAllocated > availablePrize) revert InsufficientBalance();

        seasonFinalized[season] = true;

        // Deduct from prize pool
        prizePool -= totalAllocated;

        // Try push first, fallback to pull if transfer fails
        for (uint256 i = 0; i < winners.length; i++) {
            if (winners[i] == address(0)) continue;

            (bool success, ) = winners[i].call{value: amounts[i]}("");
            if (!success) {
                pendingPrizes[winners[i]] += amounts[i];
                emit PrizeAllocated(winners[i], amounts[i]);
            }
            emit PrizeDistributed(season, winners[i], i + 1, amounts[i]);
        }

        emit SeasonFinalized(season, totalAllocated);
    }

    // ============ VIEW FUNCTIONS ============

    /// @notice Calculate score based on bands and threshold difficulty
    /// @param bands Number of bands placed
    /// @param threshold The snap threshold (lower = harder)
    /// @return score The calculated score: bands² + bands × (16 - threshold)
    function calculateScore(uint256 bands, uint256 threshold) public pure returns (uint256 score) {
        // Quadratic scoring: bands² + bands × (16 - threshold)
        // More bands = exponentially higher score (primary factor)
        // Lower threshold = bonus per band (secondary factor)
        // Examples: 14 bands easy (th=15) = 196+14 = 210
        //           2 bands hard (th=3) = 4+26 = 30
        score = (bands * bands) + (bands * (16 - threshold));
    }

    /// @notice Calculate multiplier for a given number of bands (15% exponential growth)
    /// @param bands Number of bands placed
    /// @return multiplier The multiplier in basis points (10000 = 1.0x)
    function getMultiplierForBands(uint256 bands) public view returns (uint256 multiplier) {
        // O(1) lookup from precomputed table
        if (bands <= SOLO_MAX_THRESHOLD) {
            return MULTIPLIER_TABLE[bands];
        }
        // Fallback for bands > 15 (shouldn't happen in normal gameplay)
        multiplier = MULTIPLIER_TABLE[SOLO_MAX_THRESHOLD];
        for (uint256 i = SOLO_MAX_THRESHOLD; i < bands; i++) {
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
        uint256 createdAt,
        uint64 vrfSequence
    ) {
        SoloGame storage game = soloGames[gameId];
        player = game.player;
        currentBands = game.currentBands;
        currentMultiplier = game.currentMultiplier;
        potentialScore = calculateScore(game.currentBands, game.snapThreshold);
        score = game.score;
        season = game.season;
        state = game.state;
        createdAt = game.createdAt;
        vrfSequence = game.vrfSequence;

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

    /// @notice Get player's game history with pagination
    /// @param player The player address
    /// @param offset Starting index
    /// @param limit Maximum number of games to return
    function getPlayerGamesPage(
        address player,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory games, uint256 total) {
        uint256[] storage allGames = playerGames[player];
        total = allGames.length;

        if (offset >= total) {
            return (new uint256[](0), total);
        }

        // Clamp limit
        if (limit > MAX_GAMES_PER_PAGE) {
            limit = MAX_GAMES_PER_PAGE;
        }

        uint256 remaining = total - offset;
        uint256 count = remaining < limit ? remaining : limit;

        games = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            games[i] = allGames[offset + i];
        }
    }

    /// @notice Get the on-chain leaderboard for a season
    /// @param season The season number
    function getLeaderboard(uint256 season) external view returns (LeaderboardEntry[] memory) {
        return seasonLeaderboard[season];
    }

    /// @notice Get player's rank in a season (0 = not ranked)
    /// @param season The season number
    /// @param player The player address
    function getPlayerRank(uint256 season, address player) external view returns (uint256 rank) {
        LeaderboardEntry[] storage leaderboard = seasonLeaderboard[season];
        for (uint256 i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].player == player) {
                return i + 1; // 1-indexed rank
            }
        }
        return 0; // Not ranked
    }

    /// @notice Get current VRF fee
    function getVRFFee() external view returns (uint256) {
        return entropy.getFeeV2();
    }

    /// @notice Get total cost to start a game
    function getGameCost() external view returns (uint256 _entryFee, uint256 vrfFee, uint256 total) {
        _entryFee = entryFee;
        vrfFee = entropy.getFeeV2();
        total = _entryFee + vrfFee;
    }

    // ============ INTERNAL FUNCTIONS ============

    /// @notice Check if caller is the player or their authorized operator
    /// @param player The player address to check against
    /// @return True if caller is player or authorized operator
    function _isPlayerOrOperator(address player) internal view returns (bool) {
        return msg.sender == player || authorizedOperator[player] == msg.sender;
    }

    /// @notice Check if season has ended and start new one
    /// @dev Auto-distributes prizes for the ended season if not yet finalized
    function _checkAndStartNewSeason() internal {
        if (block.timestamp >= seasonStartTime + SEASON_DURATION) {
            uint256 endedSeason = currentSeason;

            // Auto-distribute prizes if season has winners and prize pool
            if (!seasonFinalized[endedSeason] &&
                seasonPrizePool[endedSeason] > 0 &&
                seasonLeaderboard[endedSeason].length > 0) {
                _autoDistributePrizes(endedSeason, msg.sender);
            }

            currentSeason++;
            seasonStartTime = block.timestamp;
            emit SeasonStarted(currentSeason, block.timestamp);
        }
    }

    /// @notice Update the on-chain leaderboard with a new score
    /// @dev Optimized: single pass find, in-place update when possible, single directional shift
    /// @param season The season number
    /// @param player The player address
    /// @param score The new score
    /// @param gameId The game ID
    function _updateLeaderboard(
        uint256 season,
        address player,
        uint256 score,
        uint256 gameId
    ) internal {
        LeaderboardEntry[] storage leaderboard = seasonLeaderboard[season];
        uint256 len = leaderboard.length;

        // Single pass: find target position and existing position
        uint256 targetIdx = len; // Default: append at end
        uint256 existingIdx = type(uint256).max; // Not found marker

        for (uint256 i = 0; i < len; i++) {
            // Find target position (first entry with score < new score)
            // Tie-break: >= means new score wins ties
            if (targetIdx == len && score >= leaderboard[i].score) {
                targetIdx = i;
            }
            // Find existing entry
            if (leaderboard[i].player == player) {
                existingIdx = i;
                break; // Player found, target already set if score qualifies
            }
        }

        // Case 1: Player exists in leaderboard
        if (existingIdx != type(uint256).max) {
            // Score can only improve, so targetIdx <= existingIdx
            if (targetIdx > existingIdx) {
                targetIdx = existingIdx;
            }

            // Same position - just update in place (2 SSTOREs, not ~54)
            if (targetIdx == existingIdx) {
                leaderboard[existingIdx].score = score;
                leaderboard[existingIdx].gameId = gameId;
                emit LeaderboardUpdated(season, player, score, existingIdx + 1);
                return;
            }

            // Moving up - single shift: move entries[targetIdx..existingIdx-1] down by 1
            for (uint256 i = existingIdx; i > targetIdx; i--) {
                leaderboard[i] = leaderboard[i - 1];
            }
            leaderboard[targetIdx] = LeaderboardEntry(player, score, gameId);
            emit LeaderboardUpdated(season, player, score, targetIdx + 1);
            return;
        }

        // Case 2: New player - continue search if target not found yet
        if (targetIdx == len) {
            for (uint256 i = 0; i < len; i++) {
                if (score >= leaderboard[i].score) {
                    targetIdx = i;
                    break;
                }
            }
        }

        // Only insert if within top N
        if (targetIdx >= LEADERBOARD_SIZE) {
            return;
        }

        // Expand array if needed, then shift right
        if (len < LEADERBOARD_SIZE) {
            leaderboard.push(LeaderboardEntry(address(0), 0, 0));
            len++;
        }

        for (uint256 i = len - 1; i > targetIdx; i--) {
            leaderboard[i] = leaderboard[i - 1];
        }

        leaderboard[targetIdx] = LeaderboardEntry(player, score, gameId);
        emit LeaderboardUpdated(season, player, score, targetIdx + 1);
    }

    /// @notice Auto-distribute prizes based on leaderboard (pull pattern)
    /// @param season The season to distribute
    /// @param caller The address that triggered distribution (receives reward)
    function _autoDistributePrizes(uint256 season, address caller) internal {
        LeaderboardEntry[] storage leaderboard = seasonLeaderboard[season];
        uint256 pool = seasonPrizePool[season];

        // Calculate caller reward (1%)
        uint256 callerReward = (pool * CALLER_REWARD_BPS) / BASIS_POINTS;
        uint256 distributablePool = pool - callerReward;

        seasonFinalized[season] = true;

        uint256 totalAllocated = 0;
        uint256 winnersCount = leaderboard.length;
        if (winnersCount > LEADERBOARD_SIZE) winnersCount = LEADERBOARD_SIZE;

        // Calculate total shares for actual winners (for proportional distribution)
        // This ensures 1st always gets more than 2nd, etc. regardless of winner count
        uint256 totalShares = 0;
        for (uint256 i = 0; i < winnersCount; i++) {
            if (leaderboard[i].player != address(0)) {
                totalShares += PRIZE_SHARES[i];
            }
        }

        // Distribute prizes proportionally - try push first, fallback to pull if transfer fails
        for (uint256 i = 0; i < winnersCount; i++) {
            address winner = leaderboard[i].player;
            if (winner == address(0)) continue;

            // Calculate prize proportionally: (pool * originalShare) / totalShares
            // Example with 2 winners: 1st gets 40/65 = 61.5%, 2nd gets 25/65 = 38.5%
            uint256 prize = (distributablePool * PRIZE_SHARES[i]) / totalShares;
            if (prize > 0) {
                totalAllocated += prize;
                // Try direct transfer first (works for most wallets)
                (bool success, ) = winner.call{value: prize}("");
                if (!success) {
                    // Fallback to pending claim if transfer fails (contract wallets, etc)
                    pendingPrizes[winner] += prize;
                    emit PrizeAllocated(winner, prize);
                }
                emit PrizeDistributed(season, winner, i + 1, prize);
            }
        }

        // Pay caller reward immediately (caller triggered this, so they're responsive)
        if (callerReward > 0 && caller != address(0)) {
            totalAllocated += callerReward;
            (bool success, ) = caller.call{value: callerReward}("");
            if (!success) {
                // If caller transfer fails, add to pending prizes instead
                pendingPrizes[caller] += callerReward;
            }
        }

        // Deduct from prize pool
        prizePool -= totalAllocated;

        emit SeasonAutoFinalized(season, caller, callerReward, totalAllocated);
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Pause the contract (emergency stop for new games)
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause the contract
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Manually start a new season (owner only)
    function startNewSeason() external onlyOwner {
        currentSeason++;
        seasonStartTime = block.timestamp;
        emit SeasonStarted(currentSeason, block.timestamp);
    }

    /// @notice Withdraw protocol fees
    /// @param amount Amount to withdraw
    /// @param recipient Address to receive funds
    function withdrawProtocolFees(uint256 amount, address recipient) external onlyOwner nonReentrant {
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

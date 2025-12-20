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
    uint256 public immutable entryFee;
    address public owner;

    uint256 public soloGameCounter;
    uint256 public currentSeason;
    uint256 public prizePool;
    uint256 public protocolBalance;
    uint256 public seasonStartTime;

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
    event SoloGameCancelled(uint256 indexed gameId, address indexed player, uint256 refundAmount);
    event LeaderboardUpdated(uint256 indexed season, address indexed player, uint256 score, uint256 rank);
    event SeasonAutoFinalized(uint256 indexed season, address indexed triggeredBy, uint256 callerReward, uint256 totalDistributed);

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

    // ============ CONSTRUCTOR ============

    /// @notice Initialize the arcade game contract
    /// @param _entropy Address of Pyth Entropy contract
    /// @param _entropyProvider Address of the entropy provider
    constructor(
        address _entropy,
        address _entropyProvider,
        uint256 _entryFee
    ) {
        if (_entropy == address(0) || _entropyProvider == address(0)) {
            revert ZeroAddress();
        }
        if (_entryFee < MIN_ENTRY_FEE || _entryFee > MAX_ENTRY_FEE) {
            revert InvalidEntryFee();
        }
        entropy = IEntropy(_entropy);
        entropyProvider = _entropyProvider;
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
    function startGame() external payable returns (uint256 gameId) {
        // Check for new season
        _checkAndStartNewSeason();

        // Get VRF fee
        uint256 vrfFee = entropy.getFee(entropyProvider);
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
        game.currentMultiplier = uint32(BASIS_POINTS); // 1.0x
        game.state = SoloState.REQUESTING_VRF;
        game.vrfSequence = sequenceNumber;
        game.createdAt = uint40(block.timestamp);
        game.season = uint32(currentSeason);

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
        game.currentMultiplier = uint32(getMultiplierForBands(game.currentBands));

        if (game.currentBands >= game.snapThreshold) {
            // BOOM! Watermelon explodes - score is 0
            game.state = SoloState.EXPLODED;
            game.score = 0;

            emit SoloExploded(gameId, uint256(game.season), msg.sender, game.currentBands, game.snapThreshold);
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
        uint256 calculatedScore = calculateScore(game.currentBands, game.currentMultiplier);
        if (calculatedScore > type(uint32).max) revert ScoreOverflow();
        game.score = uint32(calculatedScore);

        // Update best score if this is a new high
        uint256 season = uint256(game.season);
        uint256 score = uint256(game.score);
        if (score > playerBestScore[season][msg.sender]) {
            playerBestScore[season][msg.sender] = score;
            playerBestGameId[season][msg.sender] = gameId;
            emit NewHighScore(season, msg.sender, score, gameId);

            // Update on-chain leaderboard
            _updateLeaderboard(season, msg.sender, score, gameId);
        }

        emit SoloScored(gameId, season, msg.sender, score, game.currentBands, game.snapThreshold);
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

    /// @notice Distribute prizes to winners (called by owner with verified data)
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
        return entropy.getFee(entropyProvider);
    }

    /// @notice Get total cost to start a game
    function getGameCost() external view returns (uint256 _entryFee, uint256 vrfFee, uint256 total) {
        _entryFee = entryFee;
        vrfFee = entropy.getFee(entropyProvider);
        total = _entryFee + vrfFee;
    }

    // ============ INTERNAL FUNCTIONS ============

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

        // Find if player already exists in leaderboard
        int256 existingIndex = -1;
        for (uint256 i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].player == player) {
                existingIndex = int256(i);
                break;
            }
        }

        // If player exists, remove their old entry first
        if (existingIndex >= 0) {
            // Shift entries left to remove
            for (uint256 i = uint256(existingIndex); i < leaderboard.length - 1; i++) {
                leaderboard[i] = leaderboard[i + 1];
            }
            leaderboard.pop();
        }

        // Find insertion position (sorted descending by score)
        uint256 insertPos = leaderboard.length;
        for (uint256 i = 0; i < leaderboard.length; i++) {
            if (score > leaderboard[i].score) {
                insertPos = i;
                break;
            }
        }

        // Only insert if within top N
        if (insertPos < LEADERBOARD_SIZE) {
            // Make room by shifting entries right
            if (leaderboard.length < LEADERBOARD_SIZE) {
                leaderboard.push(LeaderboardEntry(address(0), 0, 0));
            }

            // Shift entries right from insertPos
            for (uint256 i = leaderboard.length - 1; i > insertPos; i--) {
                leaderboard[i] = leaderboard[i - 1];
            }

            // Insert new entry
            leaderboard[insertPos] = LeaderboardEntry(player, score, gameId);

            // Trim to max size if needed
            while (leaderboard.length > LEADERBOARD_SIZE) {
                leaderboard.pop();
            }

            emit LeaderboardUpdated(season, player, score, insertPos + 1);
        }
    }

    /// @notice Auto-distribute prizes based on leaderboard
    /// @param season The season to distribute
    /// @param caller The address that triggered distribution (receives reward)
    function _autoDistributePrizes(uint256 season, address caller) internal {
        LeaderboardEntry[] storage leaderboard = seasonLeaderboard[season];
        uint256 pool = seasonPrizePool[season];

        // Calculate caller reward (1%)
        uint256 callerReward = (pool * CALLER_REWARD_BPS) / BASIS_POINTS;
        uint256 distributablePool = pool - callerReward;

        seasonFinalized[season] = true;

        uint256 totalDistributed = 0;
        uint256 winnersCount = leaderboard.length;

        // Distribute to each winner based on their rank
        for (uint256 i = 0; i < winnersCount && i < LEADERBOARD_SIZE; i++) {
            address winner = leaderboard[i].player;
            if (winner == address(0)) continue;

            // Calculate prize: (distributable pool * share) / 10000
            // If fewer than 10 winners, remaining shares go to last winner
            uint256 share;
            if (i == winnersCount - 1 && winnersCount < LEADERBOARD_SIZE) {
                // Last winner gets remaining shares
                uint256 usedShares = 0;
                for (uint256 j = 0; j < i; j++) {
                    usedShares += PRIZE_SHARES[j];
                }
                share = BASIS_POINTS - usedShares;
            } else {
                share = PRIZE_SHARES[i];
            }

            uint256 prize = (distributablePool * share) / BASIS_POINTS;
            if (prize > 0) {
                totalDistributed += prize;
                (bool success, ) = winner.call{value: prize}("");
                if (!success) revert TransferFailed();
                emit PrizeDistributed(season, winner, i + 1, prize);
            }
        }

        // Pay caller reward
        if (callerReward > 0 && caller != address(0)) {
            totalDistributed += callerReward;
            (bool success, ) = caller.call{value: callerReward}("");
            if (!success) revert TransferFailed();
        }

        // Deduct from prize pool
        prizePool -= totalDistributed;

        emit SeasonAutoFinalized(season, caller, callerReward, totalDistributed);
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

// Contract address from environment variable
export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;

// SessionKeyManager for EIP-7702 session keys (optional - set after deploying)
export const SESSION_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_SESSION_MANAGER_ADDRESS as `0x${string}` | undefined;

export const CONTRACT_ABI = [
  // View functions
  {
    inputs: [{ name: "gameId", type: "uint256" }],
    name: "getGameState",
    outputs: [
      { name: "player", type: "address" },
      { name: "currentBands", type: "uint256" },
      { name: "currentMultiplier", type: "uint256" },
      { name: "potentialScore", type: "uint256" },
      { name: "score", type: "uint256" },
      { name: "season", type: "uint256" },
      { name: "state", type: "uint8" },
      { name: "threshold", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "vrfSequence", type: "uint64" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "bands", type: "uint256" }],
    name: "getMultiplierForBands",
    outputs: [{ name: "multiplier", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [{ name: "bands", type: "uint256" }, { name: "multiplier", type: "uint256" }],
    name: "calculateScore",
    outputs: [{ name: "score", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [],
    name: "getVRFFee",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "entryFee",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getGameCost",
    outputs: [
      { name: "entryFee", type: "uint256" },
      { name: "vrfFee", type: "uint256" },
      { name: "total", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "player", type: "address" }],
    name: "getPlayerGames",
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "player", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    name: "getPlayerGamesPage",
    outputs: [
      { name: "games", type: "uint256[]" },
      { name: "total", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "season", type: "uint256" }],
    name: "getLeaderboard",
    outputs: [
      {
        components: [
          { name: "player", type: "address" },
          { name: "score", type: "uint256" },
          { name: "gameId", type: "uint256" },
        ],
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "season", type: "uint256" },
      { name: "player", type: "address" },
    ],
    name: "getPlayerRank",
    outputs: [{ name: "rank", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "season", type: "uint256" }, { name: "player", type: "address" }],
    name: "getPlayerSeasonBest",
    outputs: [
      { name: "bestScore", type: "uint256" },
      { name: "bestGameId", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getSeasonInfo",
    outputs: [
      { name: "season", type: "uint256" },
      { name: "pool", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "finalized", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "soloGameCounter",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "currentSeason",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "prizePool",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "season", type: "uint256" }],
    name: "seasonPrizePool",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Write functions
  {
    inputs: [],
    name: "startGame",
    outputs: [{ name: "gameId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "gameId", type: "uint256" }],
    name: "addBand",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "gameId", type: "uint256" }],
    name: "cashOut",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "gameId", type: "uint256" }],
    name: "cancelStaleGame",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Operator (burner wallet) functions
  {
    inputs: [{ name: "operator", type: "address" }],
    name: "authorizeOperator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "revokeOperator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "player", type: "address" }],
    name: "startGameFor",
    outputs: [{ name: "gameId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "authorizedOperator",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "uint256" },
      { indexed: true, name: "season", type: "uint256" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "vrfSequence", type: "uint64" },
    ],
    name: "SoloGameStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "uint256" },
      { indexed: true, name: "player", type: "address" },
    ],
    name: "SoloGameReady",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "uint256" },
      { indexed: false, name: "totalBands", type: "uint256" },
      { indexed: false, name: "currentMultiplier", type: "uint256" },
      { indexed: false, name: "potentialScore", type: "uint256" },
    ],
    name: "SoloBandAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "uint256" },
      { indexed: true, name: "season", type: "uint256" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "score", type: "uint256" },
      { indexed: false, name: "bands", type: "uint256" },
      { indexed: false, name: "threshold", type: "uint256" },
    ],
    name: "SoloScored",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "uint256" },
      { indexed: true, name: "season", type: "uint256" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "bandsAtExplosion", type: "uint256" },
      { indexed: false, name: "threshold", type: "uint256" },
    ],
    name: "SoloExploded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "season", type: "uint256" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "score", type: "uint256" },
      { indexed: false, name: "gameId", type: "uint256" },
    ],
    name: "NewHighScore",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "uint256" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "refundAmount", type: "uint256" },
    ],
    name: "SoloGameCancelled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "season", type: "uint256" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "score", type: "uint256" },
      { indexed: false, name: "rank", type: "uint256" },
    ],
    name: "LeaderboardUpdated",
    type: "event",
  },
] as const;

export const MONAD_TESTNET = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
} as const;

// Game constants - must match contract values
// Default entry fee for display before contract is loaded
// Actual fee is read from contract via getGameCost()
export const DEFAULT_ENTRY_FEE = 0.01;
export const BASIS_POINTS = 10000;
export const SEASON_DURATION = 24 * 60 * 60; // 1 day in seconds
export const STALE_GAME_TIMEOUT = 3600; // 1 hour in seconds
export const SOLO_MIN_THRESHOLD = 1;
export const SOLO_MAX_THRESHOLD = 15;
export const MULTIPLIER_RATE_BPS = 1500; // 15% per band
export const LEADERBOARD_SIZE = 10;
export const MAX_GAMES_PER_PAGE = 50;

// Gas optimization settings for Monad
// Monad charges based on gas limit, not actual usage - use tight limits
export const GAS_LIMITS = {
  startGame: 600_000n,      // VRF request + state init (Pyth Entropy v2 needs ~555k)
  addBand: 80_000n,         // State update + event
  cashOut: 250_000n,        // State update + leaderboard update (can shift entries) + events
  cancelStaleGame: 100_000n, // State cleanup + refund
} as const;

// EIP-1559 gas price settings (configurable per network)
// Monad minimum base fee is 100 gwei
const GWEI = 10n ** 9n;

// Testnet: higher gas prices (tokens are free)
const TESTNET_GAS_PRICE = {
  maxFeePerGas: BigInt(process.env.NEXT_PUBLIC_TESTNET_MAX_FEE_GWEI || "150") * GWEI,
  maxPriorityFeePerGas: BigInt(process.env.NEXT_PUBLIC_TESTNET_PRIORITY_FEE_GWEI || "1") * GWEI,
} as const;

// Mainnet: optimized for lower costs
const MAINNET_GAS_PRICE = {
  maxFeePerGas: BigInt(process.env.NEXT_PUBLIC_MAINNET_MAX_FEE_GWEI || "120") * GWEI,
  maxPriorityFeePerGas: BigInt(process.env.NEXT_PUBLIC_MAINNET_PRIORITY_FEE_GWEI || "1") * GWEI,
} as const;

// Select based on chain ID
export function getGasPrice(chainId: number) {
  return chainId === MONAD_TESTNET.id ? TESTNET_GAS_PRICE : MAINNET_GAS_PRICE;
}

// Default export for backwards compatibility (testnet)
export const GAS_PRICE = TESTNET_GAS_PRICE;

// Precomputed multiplier table (matches contract MULTIPLIER_TABLE)
// MULTIPLIER_TABLE[n] = 1.15^n in basis points
const MULTIPLIER_TABLE: bigint[] = (() => {
  const table: bigint[] = [];
  let multiplier = BigInt(BASIS_POINTS);
  for (let i = 0; i <= SOLO_MAX_THRESHOLD; i++) {
    table.push(multiplier);
    multiplier = (multiplier * BigInt(BASIS_POINTS + MULTIPLIER_RATE_BPS)) / BigInt(BASIS_POINTS);
  }
  return table;
})();

// Client-side multiplier calculation (matches contract getMultiplierForBands)
export function getMultiplierForBands(bands: number): bigint {
  if (bands <= SOLO_MAX_THRESHOLD) {
    return MULTIPLIER_TABLE[bands];
  }
  // Fallback for bands > 15
  let multiplier = MULTIPLIER_TABLE[SOLO_MAX_THRESHOLD];
  for (let i = SOLO_MAX_THRESHOLD; i < bands; i++) {
    multiplier = (multiplier * BigInt(BASIS_POINTS + MULTIPLIER_RATE_BPS)) / BigInt(BASIS_POINTS);
  }
  return multiplier;
}

// Client-side score calculation (matches contract calculateScore)
export function calculateScore(bands: number, multiplier: bigint): bigint {
  return (BigInt(bands) * multiplier) / 100n;
}

// Calculate survival probability as percentage
export function getSurvivalProbability(bands: number): number {
  if (bands >= SOLO_MAX_THRESHOLD) return 0;
  return Math.round(((SOLO_MAX_THRESHOLD - bands) / SOLO_MAX_THRESHOLD) * 100);
}

// Calculate danger level (0-100) based on bands placed
export function getDangerLevel(bands: number): number {
  return Math.min(100, Math.round((bands / SOLO_MAX_THRESHOLD) * 100));
}

// Pyth Entropy provider on Monad Testnet
export const ENTROPY_PROVIDER = "0x825c0390f379c631f3cf11a82a37d20bddf93c07";

export enum GameState {
  REQUESTING_VRF = 0,
  ACTIVE = 1,
  SCORED = 2,
  EXPLODED = 3,
  CANCELLED = 4,
}

const VALID_GAME_STATES = new Set([0, 1, 2, 3, 4]);

export function parseGameState(value: unknown): GameState | null {
  const num = Number(value);
  if (!VALID_GAME_STATES.has(num)) return null;
  return num as GameState;
}

export function formatMultiplier(basisPoints: bigint): string {
  return (Number(basisPoints) / 10000).toFixed(2) + "x";
}

export function formatScore(score: bigint): string {
  return score.toLocaleString();
}

export function formatTimeLeft(endTime: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = endTime - now;
  if (diff <= 0) return "Ended";
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  return `${hours}h ${mins}m`;
}

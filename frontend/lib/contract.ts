export const CONTRACT_ADDRESS = "0xC9b820C2437eFEa3CDE50Df75C3d8D9E6c5DBDf7" as const;

export const CONTRACT_ABI = [
  {
    inputs: [{ name: "gameId", type: "uint256" }],
    name: "getSoloGameState",
    outputs: [
      { name: "player", type: "address" },
      { name: "betAmount", type: "uint256" },
      { name: "currentBands", type: "uint256" },
      { name: "currentMultiplier", type: "uint256" },
      { name: "state", type: "uint8" },
      { name: "potentialPayout", type: "uint256" },
      { name: "threshold", type: "uint256" },
      { name: "createdAt", type: "uint256" },
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
    inputs: [],
    name: "getVRFFee",
    outputs: [{ name: "", type: "uint256" }],
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
    inputs: [],
    name: "soloGameCounter",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "houseBalance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "startSoloGame",
    outputs: [{ name: "gameId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "gameId", type: "uint256" }],
    name: "soloAddBand",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "gameId", type: "uint256" }],
    name: "soloCashOut",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "uint256" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "betAmount", type: "uint256" },
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
      { indexed: false, name: "potentialPayout", type: "uint256" },
    ],
    name: "SoloBandAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "uint256" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "payout", type: "uint256" },
      { indexed: false, name: "bandsPlaced", type: "uint256" },
      { indexed: false, name: "threshold", type: "uint256" },
    ],
    name: "SoloCashOut",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "uint256" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "bandsPlaced", type: "uint256" },
      { indexed: false, name: "threshold", type: "uint256" },
    ],
    name: "SoloExploded",
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

// Game constants
export const MIN_BET = 0.001;
export const MAX_BET = 0.01;
export const VRF_FEE = 0; // No VRF fee in mock version
export const PROTOCOL_FEE_BPS = 500;
export const BASIS_POINTS = 10000;

export enum GameState {
  REQUESTING_VRF = 0,
  ACTIVE = 1,
  CASHED_OUT = 2,
  EXPLODED = 3,
}

export function formatMultiplier(basisPoints: bigint): string {
  return (Number(basisPoints) / 10000).toFixed(2) + "x";
}

export function calculateNetPayout(gross: bigint): bigint {
  const fee = (gross * BigInt(PROTOCOL_FEE_BPS)) / BigInt(BASIS_POINTS);
  return gross - fee;
}

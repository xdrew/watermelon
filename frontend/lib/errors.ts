// Contract error to user-friendly message mapping
const CONTRACT_ERRORS: Record<string, string> = {
  // Game errors
  NotYourGame: "This game belongs to another player",
  GameNotActive: "Game is not active",
  GameNotRequestingVRF: "Game is not waiting for VRF",
  GameNotStale: "Game hasn't timed out yet (1 hour required)",
  GameAlreadyCancelled: "Game was already cancelled",

  // Fee errors
  IncorrectEntryFee: "Incorrect entry fee amount",
  InsufficientFee: "Insufficient MON for entry fee + VRF",
  InsufficientBalance: "Insufficient contract balance",

  // Season errors
  SeasonAlreadyFinalized: "Season prizes already distributed",
  SeasonNotOver: "Season hasn't ended yet",
  InvalidWinners: "Invalid winner list",

  // Access errors
  OnlyOwner: "Only contract owner can do this",
  OnlyEntropy: "Only Entropy contract can call this",

  // Transfer errors
  TransferFailed: "MON transfer failed",
  ZeroAddress: "Invalid zero address",

  // Reentrancy
  ReentrancyGuardReentrantCall: "Transaction already in progress",
};

// Common wallet errors
const WALLET_ERRORS: Record<string, string> = {
  "User rejected": "Transaction cancelled",
  "user rejected": "Transaction cancelled",
  "denied": "Transaction denied",
  "insufficient funds": "Insufficient MON balance",
  "nonce too low": "Please wait for pending transaction",
  "replacement fee too low": "Gas price too low, try again",
};

export function parseContractError(error: Error | string): string {
  const message = typeof error === "string" ? error : error.message;

  // Check wallet errors first
  for (const [key, value] of Object.entries(WALLET_ERRORS)) {
    if (message.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }

  // Check contract errors
  for (const [key, value] of Object.entries(CONTRACT_ERRORS)) {
    if (message.includes(key)) {
      return value;
    }
  }

  // Fallback: truncate and clean up
  const cleaned = message
    .replace(/^Error: /, "")
    .replace(/reverted with reason string '([^']+)'/, "$1")
    .replace(/execution reverted: /, "");

  return cleaned.length > 60 ? cleaned.slice(0, 57) + "..." : cleaned;
}

export function isUserRejection(error: Error | string): boolean {
  const message = typeof error === "string" ? error : error.message;
  return (
    message.toLowerCase().includes("user rejected") ||
    message.toLowerCase().includes("denied")
  );
}

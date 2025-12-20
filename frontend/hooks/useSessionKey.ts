"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  createWalletClient,
  http,
  encodeFunctionData,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { CONTRACT_ADDRESS, MONAD_TESTNET } from "@/lib/contract";

// Session Key Manager ABI (minimal)
const SESSION_MANAGER_ABI = [
  {
    name: "createSession",
    type: "function",
    inputs: [
      { name: "sessionKey", type: "address" },
      { name: "duration", type: "uint256" },
      { name: "target", type: "address" },
      { name: "selectors", type: "bytes4[]" },
      { name: "gameId", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "revokeSession",
    type: "function",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "execute",
    type: "function",
    inputs: [
      { name: "account", type: "address" },
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
    stateMutability: "nonpayable",
  },
  {
    name: "isSessionValid",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    name: "getRemainingTime",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// Game contract selectors
const ADD_BAND_SELECTOR = "0x8f2839b0" as Hex; // addBand(uint256)
const CASH_OUT_SELECTOR = "0x4e530f52" as Hex; // cashOut(uint256)

// Session duration (1 hour)
const SESSION_DURATION = 3600;

// Storage keys
const SESSION_KEY_STORAGE = "watermelon_session_key";
const SESSION_EXPIRY_STORAGE = "watermelon_session_expiry";

export interface SessionKeyState {
  isActive: boolean;
  remainingTime: number;
  sessionKeyAddress: string | null;
}

export function useSessionKey(sessionManagerAddress: string | null) {
  const { wallets } = useWallets();
  const activeWallet = wallets[0];
  const userAddress = activeWallet?.address as `0x${string}` | undefined;

  const [sessionState, setSessionState] = useState<SessionKeyState>({
    isActive: false,
    remainingTime: 0,
    sessionKeyAddress: null,
  });
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load session key from storage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedKey = localStorage.getItem(SESSION_KEY_STORAGE);
    const storedExpiry = localStorage.getItem(SESSION_EXPIRY_STORAGE);

    if (storedKey && storedExpiry) {
      const expiry = parseInt(storedExpiry, 10);
      const now = Math.floor(Date.now() / 1000);

      if (expiry > now) {
        const account = privateKeyToAccount(storedKey as Hex);
        setSessionState({
          isActive: true,
          remainingTime: expiry - now,
          sessionKeyAddress: account.address,
        });
      } else {
        // Expired - clear storage
        localStorage.removeItem(SESSION_KEY_STORAGE);
        localStorage.removeItem(SESSION_EXPIRY_STORAGE);
      }
    }
  }, []);

  // Countdown timer for remaining time
  useEffect(() => {
    if (!sessionState.isActive || sessionState.remainingTime <= 0) return;

    const interval = setInterval(() => {
      setSessionState((prev) => {
        const newTime = prev.remainingTime - 1;
        if (newTime <= 0) {
          // Session expired - clear
          localStorage.removeItem(SESSION_KEY_STORAGE);
          localStorage.removeItem(SESSION_EXPIRY_STORAGE);
          return { isActive: false, remainingTime: 0, sessionKeyAddress: null };
        }
        return { ...prev, remainingTime: newTime };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionState.isActive, sessionState.remainingTime]);

  // Create a new session
  const createSession = useCallback(
    async (gameId: bigint) => {
      if (!userAddress || !sessionManagerAddress || !activeWallet) {
        setError("Wallet not connected");
        return false;
      }

      setIsCreatingSession(true);
      setError(null);

      try {
        // Generate ephemeral session key
        const sessionPrivateKey = generatePrivateKey();
        const sessionAccount = privateKeyToAccount(sessionPrivateKey);

        // Get the wallet provider
        const provider = await activeWallet.getEthereumProvider();

        // Encode createSession call
        const createSessionData = encodeFunctionData({
          abi: SESSION_MANAGER_ABI,
          functionName: "createSession",
          args: [
            sessionAccount.address,
            BigInt(SESSION_DURATION),
            CONTRACT_ADDRESS,
            [ADD_BAND_SELECTOR, CASH_OUT_SELECTOR],
            gameId,
          ],
        });

        // For EIP-7702, we need to:
        // 1. Sign an authorization to delegate EOA to SessionKeyManager
        // 2. Send a transaction with the authorization + createSession call

        // Note: This requires EIP-7702 support in the wallet
        // For now, we'll use a regular transaction as a placeholder
        // In production with EIP-7702:
        // const authorization = await walletClient.signAuthorization({
        //   account: userAddress,
        //   contractAddress: sessionManagerAddress,
        // });

        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: userAddress,
              to: sessionManagerAddress,
              data: createSessionData,
              // In production: authorizationList: [authorization]
            },
          ],
        });

        // Wait for confirmation (simplified)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Store session key
        const expiry = Math.floor(Date.now() / 1000) + SESSION_DURATION;
        localStorage.setItem(SESSION_KEY_STORAGE, sessionPrivateKey);
        localStorage.setItem(SESSION_EXPIRY_STORAGE, expiry.toString());

        setSessionState({
          isActive: true,
          remainingTime: SESSION_DURATION,
          sessionKeyAddress: sessionAccount.address,
        });

        return true;
      } catch (err) {
        console.error("Failed to create session:", err);
        setError(err instanceof Error ? err.message : "Failed to create session");
        return false;
      } finally {
        setIsCreatingSession(false);
      }
    },
    [userAddress, sessionManagerAddress, activeWallet]
  );

  // Execute a call using the session key
  const executeWithSession = useCallback(
    async (functionName: "addBand" | "cashOut", gameId: bigint) => {
      if (!sessionState.isActive || !userAddress || !sessionManagerAddress) {
        throw new Error("No active session");
      }

      const storedKey = localStorage.getItem(SESSION_KEY_STORAGE);
      if (!storedKey) {
        throw new Error("Session key not found");
      }

      const sessionAccount = privateKeyToAccount(storedKey as Hex);

      // Create wallet client for session key
      const sessionWalletClient = createWalletClient({
        account: sessionAccount,
        chain: MONAD_TESTNET,
        transport: http(),
      });

      // Encode the game contract call
      const gameCallData = encodeFunctionData({
        abi: [
          {
            name: functionName,
            type: "function",
            inputs: [{ name: "gameId", type: "uint256" }],
            outputs: [],
            stateMutability: "nonpayable",
          },
        ],
        functionName,
        args: [gameId],
      });

      // Encode execute call to SessionKeyManager
      const executeData = encodeFunctionData({
        abi: SESSION_MANAGER_ABI,
        functionName: "execute",
        args: [userAddress, CONTRACT_ADDRESS, gameCallData],
      });

      // In production with EIP-7702, this call would go to the user's
      // delegated EOA address. For now, we call the SessionKeyManager directly.
      const hash = await sessionWalletClient.sendTransaction({
        to: sessionManagerAddress as `0x${string}`,
        data: executeData,
      });

      return hash;
    },
    [sessionState.isActive, userAddress, sessionManagerAddress]
  );

  // Revoke current session
  const revokeSession = useCallback(async () => {
    localStorage.removeItem(SESSION_KEY_STORAGE);
    localStorage.removeItem(SESSION_EXPIRY_STORAGE);

    setSessionState({
      isActive: false,
      remainingTime: 0,
      sessionKeyAddress: null,
    });
  }, []);

  // Format remaining time as mm:ss
  const formattedRemainingTime = `${Math.floor(sessionState.remainingTime / 60)}:${(
    sessionState.remainingTime % 60
  )
    .toString()
    .padStart(2, "0")}`;

  return {
    // State
    sessionState,
    isCreatingSession,
    error,
    formattedRemainingTime,

    // Actions
    createSession,
    executeWithSession,
    revokeSession,

    // Helpers
    hasActiveSession: sessionState.isActive && sessionState.remainingTime > 0,
  };
}

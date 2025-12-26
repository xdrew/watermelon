"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  createWalletClient,
  custom,
  http,
  encodeFunctionData,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { CONTRACT_ADDRESS, SESSION_MANAGER_ADDRESS, MONAD_CHAIN, GAS_LIMITS, GAS_PRICE } from "@/lib/contract";

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
const SESSION_GAME_ID_STORAGE = "watermelon_session_game_id";

export interface SessionKeyState {
  isSupported: boolean;        // EIP-7702 is available
  isActive: boolean;           // Session is currently active
  isChecking: boolean;         // Checking support
  remainingTime: number;
  sessionKeyAddress: string | null;
  gameId: bigint | null;
}

export function useSessionKey() {
  const { wallets } = useWallets();
  const activeWallet = wallets[0];
  const userAddress = activeWallet?.address as `0x${string}` | undefined;

  const [state, setState] = useState<SessionKeyState>({
    isSupported: false,
    isActive: false,
    isChecking: true,
    remainingTime: 0,
    sessionKeyAddress: null,
    gameId: null,
  });
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const sessionWalletRef = useRef<ReturnType<typeof createWalletClient> | null>(null);

  // Check if EIP-7702 is supported
  useEffect(() => {
    const checkSupport = async () => {
      // Requirements for session key support:
      // 1. SessionKeyManager is deployed (address configured)
      // 2. Wallet is connected
      // 3. Wallet supports EIP-7702 (signAuthorization)

      if (!SESSION_MANAGER_ADDRESS) {
        setState(prev => ({ ...prev, isSupported: false, isChecking: false }));
        return;
      }

      if (!activeWallet) {
        setState(prev => ({ ...prev, isChecking: false }));
        return;
      }

      try {
        const provider = await activeWallet.getEthereumProvider();

        // Check if wallet supports EIP-7702 by checking for signAuthorization
        // This is a heuristic - in practice, we try and catch
        const walletClient = createWalletClient({
          chain: MONAD_CHAIN,
          transport: custom(provider),
        });

        // Check if signAuthorization method exists
        const hasEip7702 = typeof (walletClient as any).signAuthorization === 'function';

        setState(prev => ({
          ...prev,
          isSupported: hasEip7702,
          isChecking: false
        }));
      } catch {
        setState(prev => ({ ...prev, isSupported: false, isChecking: false }));
      }
    };

    checkSupport();
  }, [activeWallet]);

  // Load existing session from storage
  useEffect(() => {
    if (typeof window === "undefined" || !userAddress) return;

    const storedKey = localStorage.getItem(SESSION_KEY_STORAGE);
    const storedExpiry = localStorage.getItem(SESSION_EXPIRY_STORAGE);
    const storedGameId = localStorage.getItem(SESSION_GAME_ID_STORAGE);

    if (storedKey && storedExpiry) {
      const expiry = parseInt(storedExpiry, 10);
      const now = Math.floor(Date.now() / 1000);

      if (expiry > now) {
        const account = privateKeyToAccount(storedKey as Hex);

        // Create wallet client for session key
        sessionWalletRef.current = createWalletClient({
          account,
          chain: MONAD_CHAIN,
          transport: http(),
        });

        setState(prev => ({
          ...prev,
          isActive: true,
          remainingTime: expiry - now,
          sessionKeyAddress: account.address,
          gameId: storedGameId ? BigInt(storedGameId) : null,
        }));
      } else {
        // Expired - clear storage
        clearSession();
      }
    }
  }, [userAddress]);

  // Countdown timer
  useEffect(() => {
    if (!state.isActive || state.remainingTime <= 0) return;

    const interval = setInterval(() => {
      setState(prev => {
        const newTime = prev.remainingTime - 1;
        if (newTime <= 0) {
          clearSession();
          return { ...prev, isActive: false, remainingTime: 0, sessionKeyAddress: null, gameId: null };
        }
        return { ...prev, remainingTime: newTime };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [state.isActive]);

  const clearSession = useCallback(() => {
    localStorage.removeItem(SESSION_KEY_STORAGE);
    localStorage.removeItem(SESSION_EXPIRY_STORAGE);
    localStorage.removeItem(SESSION_GAME_ID_STORAGE);
    sessionWalletRef.current = null;
  }, []);

  // Create a new session for a game
  const createSession = useCallback(
    async (gameId: bigint): Promise<boolean> => {
      if (!userAddress || !SESSION_MANAGER_ADDRESS || !activeWallet || !state.isSupported) {
        return false;
      }

      setIsCreatingSession(true);

      try {
        const provider = await activeWallet.getEthereumProvider();

        // Generate ephemeral session key
        const sessionPrivateKey = generatePrivateKey();
        const sessionAccount = privateKeyToAccount(sessionPrivateKey);

        // Create wallet client for EIP-7702
        const walletClient = createWalletClient({
          account: userAddress,
          chain: MONAD_CHAIN,
          transport: custom(provider),
        });

        // Step 1: Sign EIP-7702 authorization to delegate EOA to SessionKeyManager
        const authorization = await (walletClient as any).signAuthorization({
          contractAddress: SESSION_MANAGER_ADDRESS,
        });

        // Step 2: Encode createSession call
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

        // Step 3: Send EIP-7702 transaction (type 0x04)
        const hash = await walletClient.sendTransaction({
          to: userAddress, // Call to self (delegated EOA)
          data: createSessionData,
          authorizationList: [authorization],
        } as any);

        // Wait for confirmation
        // In production, use waitForTransactionReceipt
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Store session key
        const expiry = Math.floor(Date.now() / 1000) + SESSION_DURATION;
        localStorage.setItem(SESSION_KEY_STORAGE, sessionPrivateKey);
        localStorage.setItem(SESSION_EXPIRY_STORAGE, expiry.toString());
        localStorage.setItem(SESSION_GAME_ID_STORAGE, gameId.toString());

        // Create wallet client for session key
        sessionWalletRef.current = createWalletClient({
          account: sessionAccount,
          chain: MONAD_CHAIN,
          transport: http(),
        });

        setState(prev => ({
          ...prev,
          isActive: true,
          remainingTime: SESSION_DURATION,
          sessionKeyAddress: sessionAccount.address,
          gameId,
        }));

        return true;
      } catch (err: unknown) {
        // Silently fail for unsupported wallet types (EIP-7702 not available)
        const errorName = (err as { name?: string })?.name;
        if (errorName !== "AccountTypeNotSupportedError") {
          console.error("Failed to create session:", err);
        }
        return false;
      } finally {
        setIsCreatingSession(false);
      }
    },
    [userAddress, activeWallet, state.isSupported]
  );

  // Execute a call using the session key (no wallet popup!)
  const executeWithSession = useCallback(
    async (functionName: "addBand" | "cashOut", gameId: bigint): Promise<Hex | null> => {
      if (!state.isActive || !userAddress || !SESSION_MANAGER_ADDRESS || !sessionWalletRef.current) {
        return null;
      }

      // Verify gameId matches session
      if (state.gameId !== null && state.gameId !== gameId) {
        console.error("GameId mismatch with session");
        return null;
      }

      try {
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

        // Encode execute call
        const executeData = encodeFunctionData({
          abi: SESSION_MANAGER_ABI,
          functionName: "execute",
          args: [userAddress, CONTRACT_ADDRESS, gameCallData],
        });

        // Send via session key - NO WALLET POPUP
        // Use appropriate gas limit based on function
        const gasLimit = functionName === "addBand" ? GAS_LIMITS.addBand : GAS_LIMITS.cashOut;

        const hash = await sessionWalletRef.current.sendTransaction({
          account: sessionWalletRef.current.account!,
          to: userAddress, // User's delegated EOA
          data: executeData,
          chain: MONAD_CHAIN,
          gas: gasLimit + 50_000n, // Add buffer for session key overhead
          ...GAS_PRICE,
        });

        return hash;
      } catch (err) {
        console.error("Session execution failed:", err);
        return null;
      }
    },
    [state.isActive, state.gameId, userAddress]
  );

  // Revoke session
  const revokeSession = useCallback(async () => {
    clearSession();
    setState(prev => ({
      ...prev,
      isActive: false,
      remainingTime: 0,
      sessionKeyAddress: null,
      gameId: null,
    }));
  }, [clearSession]);

  // Check if session is valid for a specific gameId
  const isValidForGame = useCallback((gameId: bigint): boolean => {
    if (!state.isActive || state.remainingTime <= 0) return false;
    if (state.gameId === null) return true; // Session allows any game
    return state.gameId === gameId;
  }, [state.isActive, state.remainingTime, state.gameId]);

  return {
    // State
    isSupported: state.isSupported,
    isActive: state.isActive,
    isChecking: state.isChecking,
    isCreatingSession,
    remainingTime: state.remainingTime,
    formattedRemainingTime: `${Math.floor(state.remainingTime / 60)}:${(state.remainingTime % 60).toString().padStart(2, "0")}`,

    // Actions
    createSession,
    executeWithSession,
    revokeSession,
    isValidForGame,
  };
}

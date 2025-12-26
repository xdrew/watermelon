"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  createWalletClient,
  createPublicClient,
  http,
  formatEther,
  parseEther,
  type Hex,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { CONTRACT_ADDRESS, CONTRACT_ABI, MONAD_CHAIN, GAS_LIMITS } from "@/lib/contract";

// Storage keys
const BURNER_KEY_STORAGE = "watermelon_burner_key";
const TX_LOCK_STORAGE = "watermelon_tx_lock";
const TAB_ID_STORAGE = "watermelon_tab_id";
const LOCK_TIMEOUT_MS = 30000; // Lock expires after 30s (in case tab crashes)

// Minimum balance needed for a full game (entry + VRF + max gas)
// Mainnet entry fee is 10 MON + ~0.2 for VRF/gas
const MIN_GAME_BALANCE = parseEther("10.5");
// Recommended funding amount - enough for 1 game with buffer
const RECOMMENDED_FUNDING = parseEther("11.0");
// Minimum balance worth withdrawing (must cover gas cost ~0.003 MON + reserve)
const MIN_WITHDRAW_BALANCE = parseEther("0.01");
// Monad requires minimum reserve balance in accounts
const MONAD_RESERVE_BALANCE = parseEther("0.001");

// Gas settings for Monad
const GAS_PRICE = {
  maxFeePerGas: 150n * 10n ** 9n, // 150 gwei
  maxPriorityFeePerGas: 1n * 10n ** 9n, // 1 gwei
};

export interface BurnerWalletState {
  address: Hex | null;
  balance: bigint;
  isAuthorized: boolean;
  isReady: boolean; // Has enough balance and is authorized
  isLoading: boolean;
  error: string | null;
  hasOtherTabs: boolean; // Multiple tabs detected
}

// Generate unique tab ID
const getTabId = (): string => {
  let tabId = sessionStorage.getItem(TAB_ID_STORAGE);
  if (!tabId) {
    tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(TAB_ID_STORAGE, tabId);
  }
  return tabId;
};

// Transaction lock helpers
interface TxLock {
  tabId: string;
  timestamp: number;
}

const acquireTxLock = (tabId: string): boolean => {
  const lockStr = localStorage.getItem(TX_LOCK_STORAGE);
  if (lockStr) {
    const lock: TxLock = JSON.parse(lockStr);
    // Check if lock is from another tab and not expired
    if (lock.tabId !== tabId && Date.now() - lock.timestamp < LOCK_TIMEOUT_MS) {
      return false; // Another tab has the lock
    }
  }
  // Acquire lock
  localStorage.setItem(TX_LOCK_STORAGE, JSON.stringify({ tabId, timestamp: Date.now() }));
  return true;
};

const releaseTxLock = (tabId: string): void => {
  const lockStr = localStorage.getItem(TX_LOCK_STORAGE);
  if (lockStr) {
    const lock: TxLock = JSON.parse(lockStr);
    if (lock.tabId === tabId) {
      localStorage.removeItem(TX_LOCK_STORAGE);
    }
  }
};

export function useBurnerWallet(userAddress: `0x${string}` | undefined) {
  const { wallets } = useWallets();
  const activeWallet = wallets.find((w) => w.address === userAddress);

  const [state, setState] = useState<BurnerWalletState>({
    address: null,
    balance: BigInt(0),
    isAuthorized: false,
    isReady: false,
    isLoading: true,
    error: null,
    hasOtherTabs: false,
  });

  const [burnerAccount, setBurnerAccount] = useState<ReturnType<typeof privateKeyToAccount> | null>(null);
  const [tabId] = useState(() => getTabId());

  // Public client for reading
  const publicClient = useMemo(() => createPublicClient({
    chain: MONAD_CHAIN,
    transport: http(),
  }), []);

  // Initialize or retrieve burner wallet
  useEffect(() => {
    let privateKey = localStorage.getItem(BURNER_KEY_STORAGE) as Hex | null;

    if (!privateKey) {
      privateKey = generatePrivateKey();
      localStorage.setItem(BURNER_KEY_STORAGE, privateKey);
    }

    const account = privateKeyToAccount(privateKey);
    setBurnerAccount(account);
    setState(prev => ({ ...prev, address: account.address }));
  }, []);

  // Detect other tabs using BroadcastChannel
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel("watermelon_tabs");

    // Announce this tab
    channel.postMessage({ type: "ping", tabId });

    // Listen for other tabs
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === "ping" && event.data.tabId !== tabId) {
        setState(prev => ({ ...prev, hasOtherTabs: true }));
        // Respond so the other tab knows we exist
        channel.postMessage({ type: "pong", tabId });
      } else if (event.data.type === "pong" && event.data.tabId !== tabId) {
        setState(prev => ({ ...prev, hasOtherTabs: true }));
      }
    };

    channel.addEventListener("message", handleMessage);

    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
  }, [tabId]);

  // Check balance and authorization status - returns fresh values
  const refreshStatus = useCallback(async (): Promise<{ balance: bigint; isAuthorized: boolean } | null> => {
    if (!burnerAccount?.address || !userAddress) return null;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Get balance
      const balance = await publicClient.getBalance({ address: burnerAccount.address });

      // Check if authorized
      const authorizedOperator = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "authorizedOperator",
        args: [userAddress],
      }) as Hex;

      const isAuthorized = authorizedOperator.toLowerCase() === burnerAccount.address.toLowerCase();
      const isReady = isAuthorized && balance >= MIN_GAME_BALANCE;

      setState(prev => ({
        ...prev,
        balance,
        isAuthorized,
        isReady,
        isLoading: false,
      }));

      // Return fresh values for immediate use
      return { balance, isAuthorized };
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: (err as Error).message,
      }));
      return null;
    }
  }, [burnerAccount?.address, userAddress, publicClient]);

  // Refresh on mount and when user changes
  useEffect(() => {
    if (burnerAccount?.address && userAddress) {
      refreshStatus();
    }
  }, [burnerAccount?.address, userAddress, refreshStatus]);

  // Fund burner wallet (user sends MON to burner)
  const fundBurner = useCallback(async (): Promise<boolean> => {
    if (!activeWallet || !burnerAccount?.address || !userAddress) return false;

    try {
      const provider = await activeWallet.getEthereumProvider();

      const walletClient = createWalletClient({
        account: userAddress,
        chain: MONAD_CHAIN,
        transport: http(),
      });

      // Send RECOMMENDED_FUNDING to burner
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: userAddress,
          to: burnerAccount.address,
          value: `0x${RECOMMENDED_FUNDING.toString(16)}`,
        }],
      });

      console.log("fundBurner tx:", hash);
      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash: hash as Hex, timeout: 60_000 });

      await refreshStatus();
      return true;
    } catch (err) {
      console.error("fundBurner error:", err);
      setState(prev => ({ ...prev, error: (err as Error).message }));
      return false;
    }
  }, [activeWallet, burnerAccount?.address, userAddress, publicClient, refreshStatus]);

  // Authorize burner in contract (user tx)
  const authorizeBurner = useCallback(async (): Promise<boolean> => {
    if (!activeWallet || !burnerAccount?.address || !userAddress) return false;

    try {
      const provider = await activeWallet.getEthereumProvider();

      const data = encodeFunctionData({
        abi: CONTRACT_ABI,
        functionName: "authorizeOperator",
        args: [burnerAccount.address],
      });

      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: userAddress,
          to: CONTRACT_ADDRESS,
          data,
        }],
      });

      console.log("authorizeBurner tx:", hash);
      await publicClient.waitForTransactionReceipt({ hash: hash as Hex, timeout: 60_000 });

      await refreshStatus();
      return true;
    } catch (err) {
      console.error("authorizeBurner error:", err);
      setState(prev => ({ ...prev, error: (err as Error).message }));
      return false;
    }
  }, [activeWallet, burnerAccount?.address, userAddress, publicClient, refreshStatus]);

  // Setup burner (fund + authorize in optimal order)
  const setupBurner = useCallback(async (): Promise<boolean> => {
    if (!burnerAccount?.address) return false;

    // Get fresh status - use returned values, not stale state
    const freshStatus = await refreshStatus();
    if (!freshStatus) return false;

    // Fund if needed
    if (freshStatus.balance < MIN_GAME_BALANCE) {
      const funded = await fundBurner();
      if (!funded) return false;
    }

    // Authorize if needed
    if (!freshStatus.isAuthorized) {
      const authorized = await authorizeBurner();
      if (!authorized) return false;
    }

    return true;
  }, [burnerAccount?.address, fundBurner, authorizeBurner, refreshStatus]);

  // Withdraw all remaining balance back to user
  const withdrawToUser = useCallback(async (): Promise<boolean> => {
    if (!burnerAccount || !userAddress) return false;

    try {
      // Fetch current balance (not stale state)
      const currentBalance = await publicClient.getBalance({ address: burnerAccount.address });

      if (currentBalance === 0n) return true;

      const walletClient = createWalletClient({
        account: burnerAccount,
        chain: MONAD_CHAIN,
        transport: http(),
      });

      // Calculate gas cost for transfer (use base fee, not max fee for tighter estimate)
      const gasLimit = 21000n;
      const baseFee = 100n * 10n ** 9n; // 100 gwei minimum on Monad
      const priorityFee = GAS_PRICE.maxPriorityFeePerGas;
      const gasCost = gasLimit * (baseFee + priorityFee);

      // Amount to send (balance minus gas minus reserve for Monad)
      const amountToSend = currentBalance - gasCost - MONAD_RESERVE_BALANCE;

      if (amountToSend <= 0n) {
        // Not enough to cover gas + reserve, nothing to withdraw
        return true;
      }

      const hash = await walletClient.sendTransaction({
        to: userAddress,
        value: amountToSend,
        gas: gasLimit,
        ...GAS_PRICE,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      await refreshStatus();
      return true;
    } catch (err) {
      setState(prev => ({ ...prev, error: (err as Error).message }));
      return false;
    }
  }, [burnerAccount, userAddress, publicClient, refreshStatus]);

  // Start game using burner wallet (with retry for RPC inconsistencies)
  const startGameWithBurner = useCallback(async (): Promise<Hex | null> => {
    if (!burnerAccount || !userAddress) return null;

    // Acquire transaction lock to prevent nonce conflicts across tabs
    if (!acquireTxLock(tabId)) {
      setState(prev => ({ ...prev, error: "Another tab is processing a transaction" }));
      return null;
    }

    const maxRetries = 2;
    let lastError: Error | null = null;

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Fresh check - don't rely on potentially stale state
          const balance = await publicClient.getBalance({ address: burnerAccount.address });
        const authorizedOperator = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "authorizedOperator",
          args: [userAddress],
        }) as `0x${string}`;

        const isAuthorized = authorizedOperator.toLowerCase() === burnerAccount.address.toLowerCase();

        // Get game cost to check if we have enough
        const [, , totalCost] = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "getGameCost",
        }) as [bigint, bigint, bigint];

        // Need game cost + gas buffer (0.15 MON for gas at 150 gwei)
        const gasBuffer = parseEther("0.15");
        const requiredBalance = totalCost + gasBuffer;

        if (!isAuthorized || balance < requiredBalance) {
          console.error("Burner not ready:", {
            isAuthorized,
            balance: formatEther(balance),
            required: formatEther(requiredBalance),
            totalCost: formatEther(totalCost),
          });
          // Update state so UI can react
          setState(prev => ({ ...prev, balance, isAuthorized, isReady: false }));
          return null;
        }

        const walletClient = createWalletClient({
          account: burnerAccount,
          chain: MONAD_CHAIN,
          transport: http(),
        });

        // Get fresh nonce to avoid stale nonce issues
        const nonce = await publicClient.getTransactionCount({
          address: burnerAccount.address,
          blockTag: "pending",
        });

        const data = encodeFunctionData({
          abi: CONTRACT_ABI,
          functionName: "startGameFor",
          args: [userAddress],
        });

        const hash = await walletClient.sendTransaction({
          to: CONTRACT_ADDRESS,
          data,
          value: totalCost,
          gas: GAS_LIMITS.startGame,
          nonce,
          ...GAS_PRICE,
        });

        // Wait for transaction to be mined before returning
        await publicClient.waitForTransactionReceipt({ hash });
        await refreshStatus();
        return hash;
      } catch (err) {
        lastError = err as Error;
        const errorMsg = lastError.message || "";

        // Retry on "insufficient balance" errors (RPC inconsistency)
        if (errorMsg.includes("insufficient balance") && attempt < maxRetries) {
          console.warn(`startGameWithBurner attempt ${attempt + 1} failed, retrying...`);
          // Wait a moment for RPC nodes to sync
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

          console.error("startGameWithBurner error:", err);
          setState(prev => ({ ...prev, error: errorMsg }));
          return null;
        }
      }

      // All retries exhausted
      console.error("startGameWithBurner failed after retries:", lastError);
      setState(prev => ({ ...prev, error: lastError?.message || "Transaction failed" }));
      return null;
    } finally {
      releaseTxLock(tabId);
    }
  }, [burnerAccount, userAddress, publicClient, refreshStatus, tabId]);

  // Add band using burner wallet (with retry for RPC inconsistencies)
  const addBandWithBurner = useCallback(async (gameId: bigint): Promise<Hex | null> => {
    if (!burnerAccount || !state.isAuthorized) return null;

    // Acquire transaction lock to prevent nonce conflicts across tabs
    if (!acquireTxLock(tabId)) {
      setState(prev => ({ ...prev, error: "Another tab is processing a transaction" }));
      return null;
    }

    const maxRetries = 2;

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const walletClient = createWalletClient({
          account: burnerAccount,
          chain: MONAD_CHAIN,
          transport: http(),
        });

        // Get fresh nonce
        const nonce = await publicClient.getTransactionCount({
          address: burnerAccount.address,
          blockTag: "pending",
        });

        const data = encodeFunctionData({
          abi: CONTRACT_ABI,
          functionName: "addBand",
          args: [gameId],
        });

        const hash = await walletClient.sendTransaction({
          to: CONTRACT_ADDRESS,
          data,
          gas: GAS_LIMITS.addBand,
          nonce,
          ...GAS_PRICE,
        });

        // Wait for confirmation
        await publicClient.waitForTransactionReceipt({ hash });

        return hash;
      } catch (err) {
        const errorMsg = (err as Error).message || "";

        // Retry on "insufficient balance" errors (RPC inconsistency)
        if (errorMsg.includes("insufficient balance") && attempt < maxRetries) {
          console.warn(`addBandWithBurner attempt ${attempt + 1} failed, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

          setState(prev => ({ ...prev, error: errorMsg }));
          return null;
        }
      }

      return null;
    } finally {
      releaseTxLock(tabId);
    }
  }, [burnerAccount, state.isAuthorized, publicClient, tabId]);

  // Cash out using burner wallet (with retry for RPC inconsistencies)
  const cashOutWithBurner = useCallback(async (gameId: bigint): Promise<Hex | null> => {
    if (!burnerAccount || !state.isAuthorized) return null;

    // Acquire transaction lock to prevent nonce conflicts across tabs
    if (!acquireTxLock(tabId)) {
      setState(prev => ({ ...prev, error: "Another tab is processing a transaction" }));
      return null;
    }

    const maxRetries = 2;

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const walletClient = createWalletClient({
          account: burnerAccount,
          chain: MONAD_CHAIN,
          transport: http(),
        });

        // Get fresh nonce
        const nonce = await publicClient.getTransactionCount({
          address: burnerAccount.address,
          blockTag: "pending",
        });

        const data = encodeFunctionData({
          abi: CONTRACT_ABI,
          functionName: "cashOut",
          args: [gameId],
        });

        const hash = await walletClient.sendTransaction({
          to: CONTRACT_ADDRESS,
          data,
          gas: GAS_LIMITS.cashOut,
          nonce,
          ...GAS_PRICE,
        });

        // Wait for confirmation
        await publicClient.waitForTransactionReceipt({ hash });

        return hash;
      } catch (err) {
        const errorMsg = (err as Error).message || "";

        // Retry on "insufficient balance" errors (RPC inconsistency)
        if (errorMsg.includes("insufficient balance") && attempt < maxRetries) {
          console.warn(`cashOutWithBurner attempt ${attempt + 1} failed, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

          setState(prev => ({ ...prev, error: errorMsg }));
          return null;
        }
      }

      return null;
    } finally {
      releaseTxLock(tabId);
    }
  }, [burnerAccount, state.isAuthorized, publicClient, tabId]);

  // Check if balance is worth withdrawing (covers gas cost)
  const canWithdraw = state.balance >= MIN_WITHDRAW_BALANCE;

  // Security warning: balance exceeds recommended max (excessive risk in localStorage)
  const MAX_SAFE_BALANCE = parseEther("3.0");
  const hasExcessiveBalance = state.balance > MAX_SAFE_BALANCE;

  return {
    // State
    ...state,
    formattedBalance: formatEther(state.balance),
    minGameBalance: formatEther(MIN_GAME_BALANCE),
    recommendedFunding: formatEther(RECOMMENDED_FUNDING),
    maxSafeBalance: formatEther(MAX_SAFE_BALANCE),
    canWithdraw,

    // Security warnings
    hasExcessiveBalance, // Balance exceeds safe amount
    // hasOtherTabs is in state - nonce conflict risk

    // Actions
    refreshStatus,
    fundBurner,
    authorizeBurner,
    setupBurner,
    withdrawToUser,

    // Game actions (no wallet popup!)
    startGameWithBurner,
    addBandWithBurner,
    cashOutWithBurner,
  };
}

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
import { CONTRACT_ADDRESS, CONTRACT_ABI, MONAD_TESTNET, GAS_LIMITS } from "@/lib/contract";

// Storage keys
const BURNER_KEY_STORAGE = "watermelon_burner_key";

// Minimum balance needed for a full game (entry + VRF + max gas)
// Monad may have stricter requirements, so use higher buffer
const MIN_GAME_BALANCE = parseEther("0.5");
// Recommended funding amount - enough for 2-3 games
const RECOMMENDED_FUNDING = parseEther("1.0");
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
}

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
  });

  const [burnerAccount, setBurnerAccount] = useState<ReturnType<typeof privateKeyToAccount> | null>(null);

  // Public client for reading
  const publicClient = useMemo(() => createPublicClient({
    chain: MONAD_TESTNET,
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
        chain: MONAD_TESTNET,
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

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash: hash as Hex });

      await refreshStatus();
      return true;
    } catch (err) {
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

      await publicClient.waitForTransactionReceipt({ hash: hash as Hex });

      await refreshStatus();
      return true;
    } catch (err) {
      setState(prev => ({ ...prev, error: (err as Error).message }));
      return false;
    }
  }, [activeWallet, burnerAccount?.address, userAddress, publicClient, refreshStatus]);

  // Setup burner (fund + authorize in optimal order)
  const setupBurner = useCallback(async (): Promise<boolean> => {
    if (!burnerAccount?.address) return false;

    // Check current status
    await refreshStatus();

    // Fund if needed
    if (state.balance < MIN_GAME_BALANCE) {
      const funded = await fundBurner();
      if (!funded) return false;
    }

    // Authorize if needed
    if (!state.isAuthorized) {
      const authorized = await authorizeBurner();
      if (!authorized) return false;
    }

    return true;
  }, [burnerAccount?.address, state.balance, state.isAuthorized, fundBurner, authorizeBurner, refreshStatus]);

  // Withdraw all remaining balance back to user
  const withdrawToUser = useCallback(async (): Promise<boolean> => {
    if (!burnerAccount || !userAddress) return false;

    try {
      // Fetch current balance (not stale state)
      const currentBalance = await publicClient.getBalance({ address: burnerAccount.address });

      if (currentBalance === 0n) return true;

      const walletClient = createWalletClient({
        account: burnerAccount,
        chain: MONAD_TESTNET,
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

    const maxRetries = 2;
    let lastError: Error | null = null;

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
          chain: MONAD_TESTNET,
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
  }, [burnerAccount, userAddress, publicClient, refreshStatus]);

  // Add band using burner wallet (with retry for RPC inconsistencies)
  const addBandWithBurner = useCallback(async (gameId: bigint): Promise<Hex | null> => {
    if (!burnerAccount || !state.isAuthorized) return null;

    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const walletClient = createWalletClient({
          account: burnerAccount,
          chain: MONAD_TESTNET,
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
  }, [burnerAccount, state.isAuthorized, publicClient]);

  // Cash out using burner wallet (with retry for RPC inconsistencies)
  const cashOutWithBurner = useCallback(async (gameId: bigint): Promise<Hex | null> => {
    if (!burnerAccount || !state.isAuthorized) return null;

    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const walletClient = createWalletClient({
          account: burnerAccount,
          chain: MONAD_TESTNET,
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
  }, [burnerAccount, state.isAuthorized, publicClient]);

  // Check if balance is worth withdrawing (covers gas cost)
  const canWithdraw = state.balance >= MIN_WITHDRAW_BALANCE;

  return {
    // State
    ...state,
    formattedBalance: formatEther(state.balance),
    minGameBalance: formatEther(MIN_GAME_BALANCE),
    recommendedFunding: formatEther(RECOMMENDED_FUNDING),
    canWithdraw,

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

"use client";

import { useState, useEffect, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useBalance, useChainId } from "wagmi";
import { formatEther } from "viem";
import { MONAD_CHAIN } from "@/lib/contract";

export function ConnectWallet() {
  const [mounted, setMounted] = useState(false);
  const [switching, setSwitching] = useState(false);
  const { login, logout, authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const chainId = useChainId();

  const activeWallet = wallets[0];
  const address = activeWallet?.address as `0x${string}` | undefined;

  const { data: balance } = useBalance({ address });

  useEffect(() => {
    setMounted(true);
  }, []);

  const isWrongNetwork = authenticated && chainId !== MONAD_CHAIN.id;

  const handleSwitchChain = useCallback(async () => {
    if (!activeWallet || switching) return;
    setSwitching(true);
    try {
      const provider = await activeWallet.getEthereumProvider();
      // Try to switch first
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${MONAD_CHAIN.id.toString(16)}` }],
        });
      } catch (switchError: unknown) {
        // Chain doesn't exist (4902), add it
        if ((switchError as { code?: number })?.code === 4902) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: `0x${MONAD_CHAIN.id.toString(16)}`,
              chainName: MONAD_CHAIN.name,
              nativeCurrency: MONAD_CHAIN.nativeCurrency,
              rpcUrls: [MONAD_CHAIN.rpcUrls.default.http[0]],
              blockExplorerUrls: [MONAD_CHAIN.blockExplorers.default.url],
            }],
          });
        }
      }
    } catch (e) {
      console.error("Failed to switch chain:", e);
    } finally {
      setSwitching(false);
    }
  }, [activeWallet, switching]);

  // Auto-switch when on wrong network
  useEffect(() => {
    if (isWrongNetwork && activeWallet && !switching) {
      handleSwitchChain();
    }
  }, [isWrongNetwork, activeWallet, switching, handleSwitchChain]);

  if (!mounted || !ready) {
    return (
      <button
        disabled
        className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium opacity-50"
      >
        Connect
      </button>
    );
  }

  if (authenticated && isWrongNetwork) {
    return (
      <button
        onClick={handleSwitchChain}
        disabled={switching}
        className="px-4 py-2 border border-yellow-500 text-yellow-600 hover:bg-yellow-50 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
      >
        {switching ? "Switching..." : "Switch to Monad"}
      </button>
    );
  }

  if (authenticated && address) {
    return (
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="text-right">
          <div className="text-gray-500 text-[10px] sm:text-xs">
            {address.slice(0, 4)}...{address.slice(-4)}
          </div>
          <div className="font-medium text-xs sm:text-sm">
            {balance ? Number(formatEther(balance.value)).toFixed(2) : "0"} MON
          </div>
        </div>
        <button
          onClick={logout}
          className="px-2 py-1 sm:px-3 sm:py-1.5 border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 rounded-lg text-[10px] sm:text-xs transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      className="px-4 py-2 bg-black text-white hover:bg-gray-800 rounded-lg text-sm font-medium transition-colors"
    >
      Connect
    </button>
  );
}

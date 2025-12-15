"use client";

import { useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useBalance, useChainId } from "wagmi";
import { formatEther } from "viem";
import { MONAD_TESTNET } from "@/lib/contract";

export function ConnectWallet() {
  const [mounted, setMounted] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const { address, isConnected, connector } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });
  const chainId = useChainId();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isWrongNetwork = isConnected && chainId !== MONAD_TESTNET.id;

  const handleSwitchChain = async () => {
    if (!connector) return;
    setIsSwitching(true);

    try {
      const provider = await connector.getProvider();
      // First try to switch
      try {
        await (provider as any).request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${MONAD_TESTNET.id.toString(16)}` }],
        });
      } catch (switchError: any) {
        // Chain doesn't exist, add it
        if (switchError.code === 4902) {
          await (provider as any).request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: `0x${MONAD_TESTNET.id.toString(16)}`,
              chainName: MONAD_TESTNET.name,
              nativeCurrency: MONAD_TESTNET.nativeCurrency,
              rpcUrls: [MONAD_TESTNET.rpcUrls.default.http[0]],
              blockExplorerUrls: [MONAD_TESTNET.blockExplorers.default.url],
            }],
          });
        }
      }
    } catch (e) {
      // User rejected or other error - silently ignore
    } finally {
      setIsSwitching(false);
    }
  };

  const handleConnect = (connector: typeof connectors[number]) => {
    connect(
      { connector },
      {
        onSuccess: () => setShowWalletModal(false),
        onError: () => {},
      }
    );
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <button
        disabled
        className="px-6 py-3 bg-purple-600 rounded-lg font-semibold opacity-50"
      >
        Connect Wallet
      </button>
    );
  }

  if (isConnected && isWrongNetwork) {
    return (
      <button
        onClick={handleSwitchChain}
        disabled={isSwitching}
        className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-800 rounded-lg font-semibold transition-colors"
      >
        {isSwitching ? "Switching..." : "Switch to Monad"}
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-4">
        <div className="text-sm">
          <div className="text-gray-400">
            {address.slice(0, 6)}...{address.slice(-4)}
          </div>
          <div className="text-green-400 font-mono">
            {balance ? Number(formatEther(balance.value)).toFixed(4) : "0"} MON
          </div>
        </div>
        <button
          onClick={() => disconnect()}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowWalletModal(true)}
        className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition-colors"
      >
        Connect Wallet
      </button>

      {showWalletModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setShowWalletModal(false)}
        >
          <div
            className="bg-gray-800 rounded-xl p-6 w-80 max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">Connect Wallet</h2>
            <div className="space-y-2">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => handleConnect(connector)}
                  disabled={isConnecting}
                  className="w-full py-3 px-4 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-700 disabled:opacity-50 rounded-lg text-left transition-colors flex items-center gap-3"
                >
                  {connector.icon ? (
                    <img src={connector.icon} alt="" className="w-6 h-6 rounded" />
                  ) : (
                    <span className="w-6 h-6 flex items-center justify-center">👛</span>
                  )}
                  <span>{connector.name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowWalletModal(false)}
              className="w-full mt-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

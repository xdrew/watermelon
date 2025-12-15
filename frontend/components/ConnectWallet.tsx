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
        className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium opacity-50"
      >
        Connect
      </button>
    );
  }

  if (isConnected && isWrongNetwork) {
    return (
      <button
        onClick={handleSwitchChain}
        disabled={isSwitching}
        className="px-4 py-2 border border-yellow-500 text-yellow-600 hover:bg-yellow-50 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
      >
        {isSwitching ? "Switching..." : "Switch Network"}
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3">
        <div className="text-sm text-right">
          <div className="text-gray-500 text-xs">
            {address.slice(0, 6)}...{address.slice(-4)}
          </div>
          <div className="font-medium">
            {balance ? Number(formatEther(balance.value)).toFixed(4) : "0"} MON
          </div>
        </div>
        <button
          onClick={() => disconnect()}
          className="px-3 py-1.5 border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 rounded-lg text-xs transition-colors"
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
        className="px-4 py-2 bg-black text-white hover:bg-gray-800 rounded-lg text-sm font-medium transition-colors"
      >
        Connect
      </button>

      {showWalletModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowWalletModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-80 max-w-[90vw] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-4">Connect Wallet</h2>
            <div className="space-y-2">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => handleConnect(connector)}
                  disabled={isConnecting}
                  className="w-full py-3 px-4 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded-xl text-left transition-colors flex items-center gap-3"
                >
                  {connector.icon ? (
                    <img src={connector.icon} alt="" className="w-6 h-6 rounded" />
                  ) : (
                    <span className="w-6 h-6 flex items-center justify-center">👛</span>
                  )}
                  <span className="font-medium">{connector.name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowWalletModal(false)}
              className="w-full mt-4 py-2 text-gray-400 hover:text-gray-600 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

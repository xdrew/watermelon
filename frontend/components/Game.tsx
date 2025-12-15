"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useChainId,
} from "wagmi";
import { parseEther, formatEther } from "viem";
import {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  MONAD_TESTNET,
  GameState,
  formatMultiplier,
  MIN_BET,
  MAX_BET,
  VRF_FEE,
} from "@/lib/contract";

export function Game() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [betAmount, setBetAmount] = useState("0.005");
  const [status, setStatus] = useState<string>("");
  const [isWaitingForVRF, setIsWaitingForVRF] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Read game state
  const { data: gameState, refetch: refetchGameState } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getSoloGameState",
    args: gameId ? [gameId] : undefined,
    query: { enabled: !!gameId },
  });

  // Read house balance
  const { data: houseBalance } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "houseBalance",
  });

  // Read VRF fee from contract
  const { data: vrfFeeData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getVRFFee",
  });

  const actualVrfFee = vrfFeeData ? Number(formatEther(vrfFeeData)) : VRF_FEE;

  // Read player's games to find active game
  const { data: playerGames } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getPlayerGames",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Check for existing active game on load
  useEffect(() => {
    if (playerGames) {
      if (playerGames.length > 0) {
        const lastGameId = playerGames[playerGames.length - 1];
        setGameId(lastGameId);
      } else {
        // No games on this contract - clear state
        setGameId(null);
        setIsWaitingForVRF(false);
        setStatus("");
      }
    }
  }, [playerGames]);

  // Write functions
  const { writeContract, data: txHash, isPending } = useWriteContract();

  // Wait for transaction
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Watch for game started event to capture game ID
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloGameStarted",
    onLogs(logs) {
      const log = logs[0];
      if (log && log.args.player?.toLowerCase() === address?.toLowerCase() && log.args.gameId !== undefined) {
        setGameId(log.args.gameId);
        setStatus("Waiting for VRF...");
      }
    },
  });

  // Watch for game ready event
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloGameReady",
    onLogs(logs) {
      const log = logs[0];
      if (log && log.args.player?.toLowerCase() === address?.toLowerCase()) {
        if (log.args.gameId !== undefined) {
          setGameId(log.args.gameId);
        }
        setIsWaitingForVRF(false);
        setStatus("");
        refetchGameState();
      }
    },
  });

  // Watch for explosion event
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloExploded",
    onLogs(logs) {
      const log = logs[0];
      if (log && gameId && log.args.gameId === gameId) {
        setStatus(`BOOM! Exploded at ${log.args.threshold} bands`);
        refetchGameState();
      }
    },
  });

  // Watch for cash out event
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloCashOut",
    onLogs(logs) {
      const log = logs[0];
      if (log && gameId && log.args.gameId === gameId && log.args.payout !== undefined) {
        setStatus(`Won ${Number(formatEther(log.args.payout)).toFixed(4)} MON!`);
        refetchGameState();
      }
    },
  });

  // Refetch game state after transaction
  useEffect(() => {
    if (isSuccess) {
      refetchGameState();
    }
  }, [isSuccess, refetchGameState]);

  const startGame = () => {
    const bet = parseFloat(betAmount);
    if (bet < MIN_BET || bet > MAX_BET) {
      setStatus(`Bet must be between ${MIN_BET} and ${MAX_BET} MON`);
      return;
    }

    const betWei = parseEther(betAmount);
    const vrfFeeWei = vrfFeeData ?? parseEther(VRF_FEE.toString());
    const totalValue = betWei + vrfFeeWei;

    setStatus("Starting game...");
    setIsWaitingForVRF(true);

    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "startSoloGame",
        value: totalValue,
      },
      {
        onSuccess: () => {
          setStatus("Waiting for VRF...");
        },
        onError: (error) => {
          if (error.message.includes("User rejected") || error.message.includes("denied")) {
            setStatus("");
          } else {
            setStatus(`Error: ${error.message.slice(0, 50)}`);
          }
          setIsWaitingForVRF(false);
        },
      }
    );
  };

  const addBand = () => {
    if (!gameId) return;
    setStatus("Adding band...");
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "soloAddBand",
        args: [gameId],
      },
      {
        onError: (error) => {
          if (error.message.includes("User rejected") || error.message.includes("denied")) {
            setStatus("");
          } else {
            setStatus(`Error: ${error.message.slice(0, 50)}`);
          }
        },
      }
    );
  };

  const cashOut = () => {
    if (!gameId) return;
    setStatus("Cashing out...");
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "soloCashOut",
        args: [gameId],
      },
      {
        onError: (error) => {
          if (error.message.includes("User rejected") || error.message.includes("denied")) {
            setStatus("");
          } else {
            setStatus(`Error: ${error.message.slice(0, 50)}`);
          }
        },
      }
    );
  };

  // Parse game state
  const currentState = gameState ? Number(gameState[4]) : null;
  const currentBands = gameState ? Number(gameState[2]) : 0;
  const currentMultiplier = gameState ? gameState[3] : BigInt(10000);
  const potentialPayout = gameState ? gameState[5] : BigInt(0);
  const threshold = gameState ? Number(gameState[6]) : 0;
  const betValue = gameState ? gameState[1] : BigInt(0);
  const isGameActive = currentState === GameState.ACTIVE;
  const isGameOver = currentState === GameState.CASHED_OUT || currentState === GameState.EXPLODED;
  const isExploded = currentState === GameState.EXPLODED;
  const isCashedOut = currentState === GameState.CASHED_OUT;

  // Calculate danger level (0-100)
  const dangerLevel = Math.min(100, currentBands * 2);

  // Auto-poll while waiting for VRF
  useEffect(() => {
    if (!isWaitingForVRF && currentState !== GameState.REQUESTING_VRF) return;

    const interval = setInterval(() => {
      refetchGameState();
    }, 15000); // Poll every 15 seconds to avoid rate limiting

    return () => clearInterval(interval);
  }, [isWaitingForVRF, currentState, refetchGameState]);

  // Update UI when game becomes active
  useEffect(() => {
    if (currentState === GameState.ACTIVE && isWaitingForVRF) {
      setIsWaitingForVRF(false);
      setStatus("");
    }
  }, [currentState, isWaitingForVRF]);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">🍉</div>
        <p className="text-gray-400 text-lg">Connect your wallet to play</p>
      </div>
    );
  }

  if (chainId !== MONAD_TESTNET.id) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">⚠️</div>
        <p className="text-yellow-400 text-lg">Switch to Monad Testnet to play</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Glass Card Container */}
      <div className="bg-gradient-to-b from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-3xl p-8 border border-gray-700/50 shadow-2xl">

        {/* Watermelon Visual */}
        <div className="relative w-56 h-56 mx-auto mb-8">
          {/* Glow effect based on danger */}
          <div
            className="absolute inset-0 rounded-full blur-xl transition-all duration-300"
            style={{
              background: `radial-gradient(circle, ${
                isExploded ? 'rgba(239, 68, 68, 0.6)' :
                dangerLevel > 60 ? 'rgba(239, 68, 68, 0.4)' :
                dangerLevel > 30 ? 'rgba(249, 115, 22, 0.3)' :
                'rgba(34, 197, 94, 0.2)'
              } 0%, transparent 70%)`
            }}
          />

          {/* Main watermelon */}
          <div
            className={`relative w-full h-full rounded-full flex items-center justify-center text-7xl transition-all duration-300 ${
              isExploded ? 'scale-110' :
              isWaitingForVRF ? 'animate-pulse' :
              currentBands > 30 ? 'animate-[wiggle_0.3s_ease-in-out_infinite]' :
              currentBands > 20 ? 'animate-[wiggle_0.5s_ease-in-out_infinite]' :
              ''
            }`}
            style={{
              background: isExploded
                ? 'linear-gradient(135deg, #ef4444 0%, #991b1b 100%)'
                : 'linear-gradient(135deg, #22c55e 0%, #15803d 50%, #14532d 100%)',
              boxShadow: isExploded
                ? '0 0 60px rgba(239, 68, 68, 0.5), inset 0 -10px 30px rgba(0,0,0,0.3)'
                : `0 10px 40px rgba(0,0,0,0.3), inset 0 -10px 30px rgba(0,0,0,0.2), 0 0 ${dangerLevel}px rgba(${dangerLevel > 60 ? '239, 68, 68' : dangerLevel > 30 ? '249, 115, 22' : '34, 197, 94'}, ${dangerLevel / 100})`,
            }}
          >
            {isExploded ? '💥' : '🍉'}
          </div>

          {/* Rubber bands indicator */}
          {currentBands > 0 && !isExploded && (
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2">
              <div className={`px-4 py-1.5 rounded-full font-bold text-sm shadow-lg ${
                dangerLevel > 60 ? 'bg-red-500 text-white' :
                dangerLevel > 30 ? 'bg-orange-500 text-white' :
                'bg-yellow-400 text-gray-900'
              }`}>
                {currentBands} {currentBands === 1 ? 'band' : 'bands'}
              </div>
            </div>
          )}
        </div>

        {/* Game Stats - Only show when game is active or over */}
        {(isGameActive || isGameOver) && gameState && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-800/80 rounded-2xl p-4 text-center">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Multiplier</div>
              <div className={`text-3xl font-bold ${isExploded ? 'text-red-400' : 'text-green-400'}`}>
                {formatMultiplier(currentMultiplier)}
              </div>
            </div>
            <div className="bg-gray-800/80 rounded-2xl p-4 text-center">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                {isExploded ? 'Lost' : isCashedOut ? 'Won' : 'Potential'}
              </div>
              <div className={`text-3xl font-bold ${isExploded ? 'text-red-400' : 'text-yellow-400'}`}>
                {isExploded ? `-${Number(formatEther(betValue)).toFixed(3)}` : Number(formatEther(potentialPayout)).toFixed(3)}
              </div>
            </div>
          </div>
        )}

        {/* Threshold reveal on game over */}
        {isGameOver && threshold > 0 && (
          <div className={`text-center mb-6 py-3 rounded-xl ${isExploded ? 'bg-red-500/20' : 'bg-green-500/20'}`}>
            <span className="text-gray-400">Threshold was </span>
            <span className={`font-bold ${isExploded ? 'text-red-400' : 'text-green-400'}`}>{threshold} bands</span>
          </div>
        )}

        {/* Status Message */}
        {status && (
          <div className={`text-center mb-6 py-3 px-4 rounded-xl text-sm ${
            status.includes('BOOM') || status.includes('Error') ? 'bg-red-500/20 text-red-300' :
            status.includes('Won') ? 'bg-green-500/20 text-green-300' :
            'bg-gray-700/50 text-gray-300'
          }`}>
            {status}
          </div>
        )}

        {/* Controls */}
        <div className="space-y-4">
          {isWaitingForVRF ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-500/20 flex items-center justify-center">
                <div className="text-3xl animate-bounce">🎲</div>
              </div>
              <p className="text-gray-400">Generating random threshold...</p>
              <p className="text-xs text-gray-500 mt-2">Powered by Pyth Entropy VRF</p>
              <p className="text-xs text-gray-600 mt-4">This may take a few minutes on testnet</p>
              <button
                onClick={() => {
                  refetchGameState();
                  setStatus("Checking...");
                  setTimeout(() => setStatus(""), 1000);
                }}
                className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
              >
                Check Status
              </button>
            </div>
          ) : !gameId || isGameOver ? (
            <>
              {/* Bet Input */}
              <div className="bg-gray-800/50 rounded-2xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-gray-400">Bet Amount</label>
                  <span className="text-xs text-gray-500">{MIN_BET} - {MAX_BET} MON</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min={MIN_BET}
                    max={MAX_BET}
                    step="0.001"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-xl font-mono focus:border-green-500 focus:outline-none transition-colors"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">MON</span>
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-500">
                  <span>+ {actualVrfFee.toFixed(4)} VRF fee</span>
                  <span className="text-gray-400">Total: {(parseFloat(betAmount) + actualVrfFee).toFixed(4)} MON</span>
                </div>
              </div>

              {/* Start Button */}
              <button
                onClick={() => {
                  setGameId(null);
                  setStatus("");
                  startGame();
                }}
                disabled={isPending || isConfirming}
                className="w-full py-4 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 disabled:from-gray-600 disabled:to-gray-600 rounded-2xl text-xl font-bold transition-all shadow-lg shadow-green-500/25 hover:shadow-green-500/40 disabled:shadow-none"
              >
                {isPending || isConfirming ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Processing...
                  </span>
                ) : (
                  '🍉 Start Game'
                )}
              </button>
            </>
          ) : currentState === GameState.REQUESTING_VRF ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-500/20 flex items-center justify-center">
                <div className="text-3xl animate-bounce">🎲</div>
              </div>
              <p className="text-gray-400">Generating random threshold...</p>
              <p className="text-xs text-gray-500 mt-2">Powered by Pyth Entropy VRF</p>
            </div>
          ) : isGameActive ? (
            <div className="space-y-3">
              {/* Danger meter */}
              <div className="bg-gray-800/50 rounded-xl p-3">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Risk Level</span>
                  <span>{dangerLevel}%</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      dangerLevel > 60 ? 'bg-red-500' :
                      dangerLevel > 30 ? 'bg-orange-500' :
                      'bg-green-500'
                    }`}
                    style={{ width: `${dangerLevel}%` }}
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={cashOut}
                  disabled={isPending || isConfirming}
                  className="py-4 bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-400 hover:to-amber-400 disabled:from-gray-600 disabled:to-gray-600 rounded-2xl text-lg font-bold transition-all shadow-lg shadow-yellow-500/25"
                >
                  💰 Cash Out
                </button>
                <button
                  onClick={addBand}
                  disabled={isPending || isConfirming}
                  className="py-4 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 disabled:from-gray-600 disabled:to-gray-600 rounded-2xl text-lg font-bold transition-all shadow-lg shadow-red-500/25"
                >
                  🎯 Add Band
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <div className="bg-gray-800/30 rounded-2xl p-4 text-center">
          <div className="text-gray-500 text-xs uppercase tracking-wider">House Balance</div>
          <div className="text-lg font-mono text-gray-300 mt-1">
            {houseBalance ? Number(formatEther(houseBalance)).toFixed(2) : "0"} MON
          </div>
        </div>
        <div className="bg-gray-800/30 rounded-2xl p-4 text-center">
          <div className="text-gray-500 text-xs uppercase tracking-wider">Max Win</div>
          <div className="text-lg font-mono text-gray-300 mt-1">1.50x</div>
        </div>
      </div>

      {/* Multiplier progression */}
      <div className="mt-6 bg-gray-800/30 rounded-2xl p-4">
        <div className="text-gray-500 text-xs uppercase tracking-wider mb-3">Multiplier Progression</div>
        <div className="flex justify-between items-end h-12">
          {[0, 5, 10, 15, 20, 25].map((bands) => {
            const mult = Math.min(1.5, 1 + bands * 0.02);
            const height = ((mult - 1) / 0.5) * 100;
            const isActive = currentBands >= bands && currentBands < bands + 5;
            return (
              <div key={bands} className="flex flex-col items-center gap-1">
                <div
                  className={`w-8 rounded-t transition-all ${isActive ? 'bg-green-500' : 'bg-gray-600'}`}
                  style={{ height: `${Math.max(4, height)}%` }}
                />
                <span className="text-[10px] text-gray-500">{bands}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

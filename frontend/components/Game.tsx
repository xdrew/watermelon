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
  ENTRY_FEE,
  formatTimeLeft,
} from "@/lib/contract";

export function Game() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [status, setStatus] = useState<string>("");
  const [isWaitingForVRF, setIsWaitingForVRF] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Read game state
  const { data: gameState, refetch: refetchGameState } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getGameState",
    args: gameId ? [gameId] : undefined,
    query: { enabled: !!gameId },
  });

  // Read season info
  const { data: seasonInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getSeasonInfo",
  });

  // Read game cost
  const { data: gameCost } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getGameCost",
  });

  // Read player's best score for current season
  const currentSeason = seasonInfo ? seasonInfo[0] : BigInt(1);
  const { data: playerBest } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getPlayerSeasonBest",
    args: address ? [currentSeason, address] : undefined,
    query: { enabled: !!address },
  });

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

  // Watch for score event
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloScored",
    onLogs(logs) {
      const log = logs[0];
      if (log && gameId && log.args.gameId === gameId && log.args.score !== undefined) {
        setStatus(`Score: ${log.args.score.toString()} pts!`);
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
    if (!gameCost) return;

    const totalValue = gameCost[2]; // total cost from contract

    setStatus("Starting game...");
    setIsWaitingForVRF(true);

    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "startGame",
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
        functionName: "addBand",
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
    setStatus("Recording score...");
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "cashOut",
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

  // Parse game state - updated for new structure
  const currentState = gameState ? Number(gameState[6]) : null;
  const currentBands = gameState ? Number(gameState[1]) : 0;
  const currentMultiplier = gameState ? gameState[2] : BigInt(10000);
  const potentialScore = gameState ? gameState[3] : BigInt(0);
  const finalScore = gameState ? gameState[4] : BigInt(0);
  const threshold = gameState ? Number(gameState[7]) : 0;
  const isGameActive = currentState === GameState.ACTIVE;
  const isGameOver = currentState === GameState.SCORED || currentState === GameState.EXPLODED;
  const isExploded = currentState === GameState.EXPLODED;
  const isScored = currentState === GameState.SCORED;

  // Calculate danger level (0-100)
  const dangerLevel = Math.min(100, currentBands * 2);

  // Parse season info
  const seasonNumber = seasonInfo ? Number(seasonInfo[0]) : 1;
  const prizePool = seasonInfo ? seasonInfo[1] : BigInt(0);
  const seasonEndTime = seasonInfo ? Number(seasonInfo[3]) : 0;

  // Parse player best
  const bestScore = playerBest ? playerBest[0] : BigInt(0);

  // Parse game cost
  const entryFee = gameCost ? gameCost[0] : parseEther(ENTRY_FEE.toString());
  const vrfFee = gameCost ? gameCost[1] : BigInt(0);
  const totalCost = gameCost ? gameCost[2] : entryFee;

  // Auto-poll while waiting for VRF
  useEffect(() => {
    if (!isWaitingForVRF && currentState !== GameState.REQUESTING_VRF) return;

    const interval = setInterval(() => {
      refetchGameState();
    }, 15000);

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
        <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">🍉</div>
        <p className="text-gray-500">Connect your wallet to play</p>
      </div>
    );
  }

  if (chainId !== MONAD_TESTNET.id) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">⚠️</div>
        <p className="text-gray-500">Switch to Monad Testnet to play</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4">
      {/* Season info */}
      <div className="flex justify-between items-center mb-8 text-sm">
        <div>
          <div className="text-gray-400 text-xs">Season {seasonNumber}</div>
          <div className="font-medium">{Number(formatEther(prizePool)).toFixed(2)} MON pool</div>
        </div>
        <div className="text-right">
          <div className="text-gray-400 text-xs">Ends in</div>
          <div className="font-medium">{formatTimeLeft(seasonEndTime)}</div>
        </div>
      </div>

      {/* Main card */}
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">

        {/* Watermelon */}
        <div className="relative w-40 h-40 mx-auto mb-8">
          <div
            className={`w-full h-full rounded-full flex items-center justify-center text-6xl transition-all ${
              isExploded ? 'bg-red-50' : 'bg-green-50'
            } ${
              isWaitingForVRF ? 'animate-pulse' :
              currentBands > 20 && !isExploded ? 'animate-[wiggle_0.5s_ease-in-out_infinite]' : ''
            }`}
          >
            {isExploded ? '💥' : '🍉'}
          </div>

          {/* Band count */}
          {currentBands > 0 && !isExploded && (
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-black text-white text-xs font-medium px-3 py-1 rounded-full">
              {currentBands} bands
            </div>
          )}
        </div>

        {/* Stats */}
        {(isGameActive || isGameOver) && gameState && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="text-center">
              <div className="text-gray-400 text-xs mb-1">Multiplier</div>
              <div className={`text-2xl font-bold ${isExploded ? 'text-red-500' : 'text-black'}`}>
                {formatMultiplier(currentMultiplier)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-gray-400 text-xs mb-1">Score</div>
              <div className={`text-2xl font-bold ${isExploded ? 'text-red-500' : 'text-black'}`}>
                {isExploded ? '0' : isScored ? finalScore.toString() : potentialScore.toString()}
              </div>
            </div>
          </div>
        )}

        {/* Threshold reveal */}
        {isGameOver && threshold > 0 && (
          <div className={`text-center text-sm mb-6 py-2 rounded-lg ${isExploded ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            Threshold was {threshold} bands
          </div>
        )}

        {/* Status */}
        {status && !isGameOver && (
          <div className="text-center text-sm text-gray-500 mb-6">
            {status}
          </div>
        )}

        {/* Controls */}
        {isWaitingForVRF ? (
          <div className="text-center py-4">
            <div className="text-2xl mb-2 animate-bounce">🎲</div>
            <p className="text-gray-500 text-sm">Generating threshold...</p>
            <p className="text-xs text-gray-400 mt-1">Pyth Entropy VRF</p>
            <button
              onClick={() => {
                refetchGameState();
                setStatus("Checking...");
                setTimeout(() => setStatus(""), 1000);
              }}
              className="mt-4 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Check Status
            </button>
          </div>
        ) : !gameId || isGameOver ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Entry fee</span>
              <div className="text-right">
                <span className="font-medium">{ENTRY_FEE} MON</span>
                {vrfFee > 0 && (
                  <div className="text-xs text-gray-400">+ {Number(formatEther(vrfFee)).toFixed(4)} VRF</div>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                setGameId(null);
                setStatus("");
                startGame();
              }}
              disabled={isPending || isConfirming}
              className="w-full py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
            >
              {isPending || isConfirming ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </span>
              ) : isGameOver ? 'Play Again' : 'Start Game'}
            </button>
          </div>
        ) : currentState === GameState.REQUESTING_VRF ? (
          <div className="text-center py-4">
            <div className="text-2xl mb-2 animate-bounce">🎲</div>
            <p className="text-gray-500 text-sm">Generating threshold...</p>
            <p className="text-xs text-gray-400 mt-1">Pyth Entropy VRF</p>
          </div>
        ) : isGameActive ? (
          <div className="space-y-4">
            {/* Risk bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Risk</span>
                <span>{dangerLevel}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    dangerLevel > 60 ? 'bg-red-500' :
                    dangerLevel > 30 ? 'bg-yellow-500' :
                    'bg-green-500'
                  }`}
                  style={{ width: `${dangerLevel}%` }}
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={cashOut}
                disabled={isPending || isConfirming || currentBands === 0}
                className="py-3 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                Secure
              </button>
              <button
                onClick={addBand}
                disabled={isPending || isConfirming}
                className="py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                Add Band
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Bottom stats */}
      <div className="flex justify-between mt-6 text-sm text-gray-500">
        <div>
          <span className="text-gray-400">Best: </span>
          <span className="font-medium text-black">{bestScore.toString()} pts</span>
        </div>
        <div>
          <span className="text-gray-400">Max: </span>
          <span className="font-medium text-black">3.35x</span>
        </div>
      </div>
    </div>
  );
}

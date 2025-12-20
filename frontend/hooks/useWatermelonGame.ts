"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
} from "wagmi";
import { parseEther } from "viem";
import {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  GameState,
  ENTRY_FEE,
  STALE_GAME_TIMEOUT,
} from "@/lib/contract";
import { parseContractError, isUserRejection } from "@/lib/errors";

export interface GameStateData {
  currentState: GameState | null;
  currentBands: number;
  currentMultiplier: bigint;
  potentialScore: bigint;
  finalScore: bigint;
  threshold: number;
  createdAt: number;
}

export interface SeasonData {
  number: number;
  prizePool: bigint;
  endTime: number;
}

export interface CostData {
  entryFee: bigint;
  vrfFee: bigint;
  total: bigint;
}

export function useWatermelonGame(address: `0x${string}` | undefined) {
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [status, setStatus] = useState<string>("");
  const [isWaitingForVRF, setIsWaitingForVRF] = useState(false);

  // Read game state
  const { data: rawGameState, refetch: refetchGameState } = useReadContract({
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

  // Write contract
  const { writeContract, data: txHash, isPending } = useWriteContract();

  // Wait for transaction
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
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

  // Watch for game started event
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloGameStarted",
    onLogs(logs) {
      const log = logs[0];
      if (log?.args.player?.toLowerCase() === address?.toLowerCase() && log.args.gameId !== undefined) {
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
      if (log?.args.player?.toLowerCase() === address?.toLowerCase()) {
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

  // Handle errors
  const handleError = useCallback((error: Error) => {
    if (isUserRejection(error)) {
      setStatus("");
    } else {
      setStatus(`Error: ${parseContractError(error)}`);
    }
    setIsWaitingForVRF(false);
  }, []);

  // Game actions
  const startGame = useCallback(() => {
    if (!gameCost) return;

    const totalValue = gameCost[2];
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
        onSuccess: () => setStatus("Waiting for VRF..."),
        onError: handleError,
      }
    );
  }, [gameCost, writeContract, handleError]);

  const addBand = useCallback(() => {
    if (!gameId) return;
    setStatus("Adding band...");
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "addBand",
        args: [gameId],
      },
      { onError: handleError }
    );
  }, [gameId, writeContract, handleError]);

  const cashOut = useCallback(() => {
    if (!gameId) return;
    setStatus("Recording score...");
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "cashOut",
        args: [gameId],
      },
      { onError: handleError }
    );
  }, [gameId, writeContract, handleError]);

  const cancelGame = useCallback(() => {
    if (!gameId) return;
    setStatus("Cancelling stale game...");
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "cancelStaleGame",
        args: [gameId],
      },
      {
        onSuccess: () => {
          setStatus("Game cancelled, refund sent!");
          setIsWaitingForVRF(false);
        },
        onError: handleError,
      }
    );
  }, [gameId, writeContract, handleError]);

  const resetGame = useCallback(() => {
    setGameId(null);
    setStatus("");
  }, []);

  const checkStatus = useCallback(() => {
    refetchGameState();
    setStatus("Checking...");
    setTimeout(() => setStatus(""), 1000);
  }, [refetchGameState]);

  // Parse game state
  const gameState: GameStateData = useMemo(() => ({
    currentState: rawGameState ? Number(rawGameState[6]) as GameState : null,
    currentBands: rawGameState ? Number(rawGameState[1]) : 0,
    currentMultiplier: rawGameState ? rawGameState[2] : BigInt(10000),
    potentialScore: rawGameState ? rawGameState[3] : BigInt(0),
    finalScore: rawGameState ? rawGameState[4] : BigInt(0),
    threshold: rawGameState ? Number(rawGameState[7]) : 0,
    createdAt: rawGameState ? Number(rawGameState[8]) : 0,
  }), [rawGameState]);

  // Derived state
  const isGameActive = gameState.currentState === GameState.ACTIVE;
  const isGameOver = gameState.currentState === GameState.SCORED ||
                     gameState.currentState === GameState.EXPLODED ||
                     gameState.currentState === GameState.CANCELLED;
  const isExploded = gameState.currentState === GameState.EXPLODED;
  const isScored = gameState.currentState === GameState.SCORED;
  const isCancelled = gameState.currentState === GameState.CANCELLED;
  const isStale = gameState.currentState === GameState.REQUESTING_VRF &&
                  gameState.createdAt > 0 &&
                  (Math.floor(Date.now() / 1000) - gameState.createdAt) > STALE_GAME_TIMEOUT;
  const dangerLevel = Math.min(100, gameState.currentBands * 2);

  // Parse season info
  const season: SeasonData = useMemo(() => ({
    number: seasonInfo ? Number(seasonInfo[0]) : 1,
    prizePool: seasonInfo ? seasonInfo[1] : BigInt(0),
    endTime: seasonInfo ? Number(seasonInfo[3]) : 0,
  }), [seasonInfo]);

  // Parse cost info
  const cost: CostData = useMemo(() => ({
    entryFee: gameCost ? gameCost[0] : parseEther(ENTRY_FEE.toString()),
    vrfFee: gameCost ? gameCost[1] : BigInt(0),
    total: gameCost ? gameCost[2] : parseEther(ENTRY_FEE.toString()),
  }), [gameCost]);

  // Best score
  const bestScore = playerBest ? playerBest[0] : BigInt(0);

  // Auto-poll while waiting for VRF
  useEffect(() => {
    if (!isWaitingForVRF && gameState.currentState !== GameState.REQUESTING_VRF) return;

    const interval = setInterval(() => {
      refetchGameState();
    }, 5000); // Reduced from 15s to 5s for better UX

    return () => clearInterval(interval);
  }, [isWaitingForVRF, gameState.currentState, refetchGameState]);

  // Update UI when game becomes active
  useEffect(() => {
    if (gameState.currentState === GameState.ACTIVE && isWaitingForVRF) {
      setIsWaitingForVRF(false);
      setStatus("");
    }
  }, [gameState.currentState, isWaitingForVRF]);

  return {
    // State
    gameId,
    status,
    isWaitingForVRF,
    isPending,
    isConfirming,

    // Parsed data
    gameState,
    season,
    cost,
    bestScore,

    // Derived state
    isGameActive,
    isGameOver,
    isExploded,
    isScored,
    isCancelled,
    isStale,
    dangerLevel,

    // Actions
    startGame,
    addBand,
    cashOut,
    cancelGame,
    resetGame,
    checkStatus,
  };
}

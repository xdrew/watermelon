"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useChainId,
} from "wagmi";
import { parseEther } from "viem";
import {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  GameState,
  DEFAULT_ENTRY_FEE,
  STALE_GAME_TIMEOUT,
  getDangerLevel,
  parseGameState,
  GAS_LIMITS,
  getGasPrice,
} from "@/lib/contract";
import { parseContractError, isUserRejection } from "@/lib/errors";
import { useSessionKey } from "./useSessionKey";

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
  const [candidateGameId, setCandidateGameId] = useState<bigint | null>(null);
  const [status, setStatus] = useState<string>("");
  const [isWaitingForVRF, setIsWaitingForVRF] = useState(false);

  // Get chain-specific gas prices
  const chainId = useChainId();
  const gasPrice = useMemo(() => getGasPrice(chainId), [chainId]);

  // Session key support for gasless gameplay (EIP-7702)
  const {
    isSupported: sessionKeySupported,
    isActive: sessionKeyActive,
    isCreatingSession,
    createSession,
    executeWithSession,
    isValidForGame,
    formattedRemainingTime,
  } = useSessionKey();

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

  // Read game cost (static, rarely changes - cache indefinitely)
  const { data: gameCost } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getGameCost",
    query: { staleTime: Infinity },
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

  // Check state of candidate game (last game in player's history)
  const { data: candidateGameState, isLoading: isLoadingCandidateState } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getGameState",
    args: candidateGameId ? [candidateGameId] : undefined,
    query: { enabled: !!candidateGameId },
  });

  // Track if we're validating a candidate game (prevents race conditions)
  const isValidatingGame = !!candidateGameId && (isLoadingCandidateState || !candidateGameState);

  // Write contract
  const { writeContract, data: txHash, isPending } = useWriteContract();

  // Wait for transaction
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Step 1: When playerGames changes, set candidate game ID to check
  useEffect(() => {
    if (playerGames && playerGames.length > 0) {
      const lastGameId = playerGames[playerGames.length - 1];
      setCandidateGameId(lastGameId);
    } else {
      setCandidateGameId(null);
      setGameId(null);
      setIsWaitingForVRF(false);
      setStatus("");
    }
  }, [playerGames]);

  // Step 2: Check if candidate game is active (REQUESTING_VRF or ACTIVE)
  useEffect(() => {
    if (candidateGameId && candidateGameState) {
      const state = parseGameState(candidateGameState[6]);
      if (state === null) {
        // Invalid state from contract - reset
        setGameId(null);
        setIsWaitingForVRF(false);
        return;
      }
      if (state === GameState.REQUESTING_VRF || state === GameState.ACTIVE) {
        // Game is still in progress - use it
        setGameId(candidateGameId);
        if (state === GameState.REQUESTING_VRF) {
          setIsWaitingForVRF(true);
        }
      } else {
        // Game is finished (SCORED, EXPLODED, or CANCELLED) - don't auto-select
        // Keep gameId as null so user can start a new game
        setGameId(null);
        setIsWaitingForVRF(false);
      }
    }
  }, [candidateGameId, candidateGameState]);

  // Watch for game started event (only when waiting for VRF after starting)
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloGameStarted",
    enabled: isWaitingForVRF && !gameId,
    onLogs(logs) {
      const log = logs[0];
      if (log?.args.player?.toLowerCase() === address?.toLowerCase() && log.args.gameId !== undefined) {
        setGameId(log.args.gameId);
        setStatus("Waiting for VRF...");
      }
    },
  });

  // Watch for game ready event (only when waiting for VRF)
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloGameReady",
    enabled: isWaitingForVRF,
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

  // Watch for explosion event (only during active game)
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloExploded",
    enabled: !!gameId,
    onLogs(logs) {
      const log = logs[0];
      if (log && gameId && log.args.gameId === gameId) {
        setStatus(`BOOM! Exploded at ${log.args.threshold} bands`);
        refetchGameState();
      }
    },
  });

  // Watch for score event (only during active game)
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloScored",
    enabled: !!gameId,
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
        gas: GAS_LIMITS.startGame,
        ...gasPrice,
      },
      {
        onSuccess: () => setStatus("Waiting for VRF..."),
        onError: handleError,
      }
    );
  }, [gameCost, writeContract, handleError, gasPrice]);

  const addBand = useCallback(async () => {
    if (!gameId) return;
    setStatus("Adding band...");

    // Try session key first (no wallet popup!)
    if (sessionKeyActive && isValidForGame(gameId)) {
      try {
        const hash = await executeWithSession("addBand", gameId);
        if (hash) {
          // Session key execution succeeded - wait for confirmation
          setStatus("Band added!");
          setTimeout(() => {
            setStatus("");
            refetchGameState();
          }, 1000);
          return;
        }
      } catch (err) {
        console.error("Session key execution failed, falling back to wallet:", err);
      }
    }

    // Fallback to regular wallet signing
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "addBand",
        args: [gameId],
        gas: GAS_LIMITS.addBand,
        ...gasPrice,
      },
      { onError: handleError }
    );
  }, [gameId, writeContract, handleError, sessionKeyActive, isValidForGame, executeWithSession, refetchGameState, gasPrice]);

  const cashOut = useCallback(async () => {
    if (!gameId) return;
    setStatus("Recording score...");

    // Try session key first (no wallet popup!)
    if (sessionKeyActive && isValidForGame(gameId)) {
      try {
        const hash = await executeWithSession("cashOut", gameId);
        if (hash) {
          // Session key execution succeeded - wait for confirmation
          setStatus("Score recorded!");
          setTimeout(() => {
            refetchGameState();
          }, 1000);
          return;
        }
      } catch (err) {
        console.error("Session key execution failed, falling back to wallet:", err);
      }
    }

    // Fallback to regular wallet signing
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "cashOut",
        args: [gameId],
        gas: GAS_LIMITS.cashOut,
        ...gasPrice,
      },
      { onError: handleError }
    );
  }, [gameId, writeContract, handleError, sessionKeyActive, isValidForGame, executeWithSession, refetchGameState, gasPrice]);

  const cancelGame = useCallback(() => {
    if (!gameId) return;
    setStatus("Cancelling stale game...");
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "cancelStaleGame",
        args: [gameId],
        gas: GAS_LIMITS.cancelStaleGame,
        ...gasPrice,
      },
      {
        onSuccess: () => {
          setStatus("Game cancelled, refund sent!");
          setIsWaitingForVRF(false);
        },
        onError: handleError,
      }
    );
  }, [gameId, writeContract, handleError, gasPrice]);

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
    currentState: rawGameState ? parseGameState(rawGameState[6]) : null,
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
  const dangerLevel = getDangerLevel(gameState.currentBands);

  // Parse season info
  const season: SeasonData = useMemo(() => ({
    number: seasonInfo ? Number(seasonInfo[0]) : 1,
    prizePool: seasonInfo ? seasonInfo[1] : BigInt(0),
    endTime: seasonInfo ? Number(seasonInfo[3]) : 0,
  }), [seasonInfo]);

  // Parse cost info
  const cost: CostData = useMemo(() => ({
    entryFee: gameCost ? gameCost[0] : parseEther(DEFAULT_ENTRY_FEE.toString()),
    vrfFee: gameCost ? gameCost[1] : BigInt(0),
    total: gameCost ? gameCost[2] : parseEther(DEFAULT_ENTRY_FEE.toString()),
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

  // Auto-create session when game becomes active (if EIP-7702 supported)
  useEffect(() => {
    if (
      sessionKeySupported &&
      !sessionKeyActive &&
      !isCreatingSession &&
      gameId &&
      gameState.currentState === GameState.ACTIVE
    ) {
      // Only prompt for session if we don't have one valid for this game
      if (!isValidForGame(gameId)) {
        setStatus("Enable fast mode? (one-time signature)");
        // Auto-create session in background
        createSession(gameId).then((success) => {
          if (success) {
            setStatus("Fast mode enabled!");
            setTimeout(() => setStatus(""), 2000);
          } else {
            setStatus("");
          }
        });
      }
    }
  }, [sessionKeySupported, sessionKeyActive, isCreatingSession, gameId, gameState.currentState, isValidForGame, createSession]);

  return {
    // State
    gameId,
    status,
    isWaitingForVRF,
    isPending,
    isConfirming,
    isValidatingGame,

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

    // Session key state (EIP-7702)
    sessionKeySupported,
    sessionKeyActive,
    isCreatingSession,
    sessionRemainingTime: formattedRemainingTime,

    // Actions
    startGame,
    addBand,
    cashOut,
    cancelGame,
    resetGame,
    checkStatus,
  };
}

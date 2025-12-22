"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  vrfSequence: bigint;
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

// VRF polling timeout - stop after 5 minutes
const VRF_TIMEOUT_MS = 5 * 60 * 1000;

export function useWatermelonGame(address: `0x${string}` | undefined) {
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [candidateGameId, setCandidateGameId] = useState<bigint | null>(null);
  const [status, setStatus] = useState<string>("");
  const [isWaitingForVRF, setIsWaitingForVRF] = useState(false);
  const [vrfTimedOut, setVrfTimedOut] = useState(false);
  const vrfWaitStartRef = useRef<number | null>(null);

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

  // Read game state (no staleTime - needs fresh data)
  const { data: rawGameState, refetch: refetchGameState } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getGameState",
    args: gameId ? [gameId] : undefined,
    query: { enabled: !!gameId },
  });

  // Read season info (changes rarely - cache for 5 min)
  const { data: seasonInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getSeasonInfo",
    query: { staleTime: 300000 },
  });

  // Read game cost (static - cache for 10 min)
  const { data: gameCost } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getGameCost",
    query: { staleTime: 600000 },
  });

  // Read player's best score for current season (cache for 30s)
  const currentSeason = seasonInfo ? seasonInfo[0] : BigInt(1);
  const { data: playerBest, refetch: refetchPlayerBest } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getPlayerSeasonBest",
    args: address ? [currentSeason, address] : undefined,
    query: { enabled: !!address, staleTime: 30000 },
  });

  // Read player's games to find active game
  // staleTime prevents background refetches, but explicit refetchPlayerGames() still works
  const { data: playerGames, refetch: refetchPlayerGames } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getPlayerGames",
    args: address ? [address] : undefined,
    query: { enabled: !!address, staleTime: 30000 },
  });

  // Check state of candidate game (no staleTime - needs fresh)
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

  // Step 2: Check if candidate game is active or recently finished
  useEffect(() => {
    if (candidateGameId && candidateGameState) {
      const state = parseGameState(candidateGameState[6]);
      if (state === null) {
        // Invalid state from contract - reset
        setGameId(null);
        setIsWaitingForVRF(false);
        return;
      }
      // Always set gameId if we have a candidate - even for finished games
      // This allows showing the game result (threshold reveal)
      // User will call resetGame() when they want to start a new game
      setGameId(candidateGameId);
      if (state === GameState.REQUESTING_VRF) {
        setIsWaitingForVRF(true);
        // Track when VRF waiting started for timeout
        if (vrfWaitStartRef.current === null) {
          vrfWaitStartRef.current = Date.now();
        }
      } else {
        setIsWaitingForVRF(false);
        vrfWaitStartRef.current = null;
        setVrfTimedOut(false);
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

  // Watch for explosion event (only during active game - not when game over)
  const gameIsActive = rawGameState ? parseGameState(rawGameState[6]) === GameState.ACTIVE : false;
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloExploded",
    enabled: !!gameId && gameIsActive,
    onLogs(logs) {
      const log = logs[0];
      if (log && gameId && log.args.gameId === gameId) {
        setStatus(`BOOM! Exploded at ${log.args.threshold} bands`);
        refetchGameState();
      }
    },
  });

  // Watch for score event (only during active game - not when game over)
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    eventName: "SoloScored",
    enabled: !!gameId && gameIsActive,
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

  // Refetch best score when game ends (scored or exploded)
  const prevGameState = useRef<GameState | null>(null);
  useEffect(() => {
    const currentState = rawGameState ? parseGameState(rawGameState[6]) : null;
    const wasActive = prevGameState.current === GameState.ACTIVE;
    const isNowFinished = currentState === GameState.SCORED || currentState === GameState.EXPLODED;

    if (wasActive && isNowFinished) {
      refetchPlayerBest();
    }
    prevGameState.current = currentState;
  }, [rawGameState, refetchPlayerBest]);

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
    setVrfTimedOut(false);
    vrfWaitStartRef.current = null;
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
    vrfSequence: rawGameState ? BigInt(rawGameState[9]) : BigInt(0),
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

  // Auto-poll while waiting for VRF (less aggressive to avoid 429)
  // Stops after VRF_TIMEOUT_MS to prevent infinite polling
  useEffect(() => {
    if (!isWaitingForVRF && gameState.currentState !== GameState.REQUESTING_VRF) return;

    const interval = setInterval(() => {
      // Check for timeout
      if (vrfWaitStartRef.current !== null) {
        const elapsed = Date.now() - vrfWaitStartRef.current;
        if (elapsed > VRF_TIMEOUT_MS) {
          setVrfTimedOut(true);
          setStatus("VRF timeout - you can cancel for a refund");
          clearInterval(interval);
          return;
        }
      }
      refetchGameState();
    }, 10000); // Poll every 10s to avoid rate limits

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
    setStatus,
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
    vrfTimedOut,
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
    refetchGameState,
    refetchPlayerGames,
  };
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useChainId } from "wagmi";
import { formatEther } from "viem";
import {
  MONAD_TESTNET,
  GameState,
  formatMultiplier,
  getMultiplierForBands,
  calculateScore,
  getDangerLevel,
  SOLO_MAX_THRESHOLD,
  ENTROPY_PROVIDER,
} from "@/lib/contract";
import { useWatermelonGame } from "@/hooks/useWatermelonGame";
import { useBurnerWallet } from "@/hooks/useBurnerWallet";

interface GameProps {
  onGameEnd?: () => void;
}

export function Game({ onGameEnd }: GameProps) {
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const activeWallet = wallets[0];
  const address = activeWallet?.address as `0x${string}` | undefined;
  const isConnected = authenticated && !!address;
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);
  const [burnerMode, setBurnerMode] = useState(false);
  const [isSettingUpBurner, setIsSettingUpBurner] = useState(false);
  const [isStartingGame, setIsStartingGame] = useState(false);

  // Optimistic UI state for instant feedback
  const [optimisticBands, setOptimisticBands] = useState<number | null>(null);

  const {
    gameId,
    status,
    setStatus,
    isWaitingForVRF,
    isPending,
    isConfirming,
    isValidatingGame,
    gameState,
    season,
    cost,
    bestScore,
    isGameActive,
    isGameOver,
    isExploded,
    isScored,
    isCancelled,
    isStale,
    dangerLevel,
    startGame,
    addBand,
    cashOut,
    cancelGame,
    resetGame,
    checkStatus,
    refetchGameState,
    refetchPlayerGames,
  } = useWatermelonGame(address);

  const burner = useBurnerWallet(address);
  const prevIsGameOver = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Trigger onGameEnd when game transitions to over (explosion or score)
  useEffect(() => {
    if (isGameOver && !prevIsGameOver.current) {
      onGameEnd?.();
    }
    prevIsGameOver.current = isGameOver;
  }, [isGameOver, onGameEnd]);

  // Clear isStartingGame only when game actually becomes ACTIVE
  // This prevents the "Start Game" button from appearing during state transitions
  useEffect(() => {
    if (isStartingGame && isGameActive) {
      setIsStartingGame(false);
    }
  }, [isStartingGame, isGameActive]);


  // Handle starting game with burner
  const handleStartGame = useCallback(async () => {
    setIsSettingUpBurner(true);
    setStatus?.("Checking session...");

    // Get fresh status
    const freshStatus = await burner.refreshStatus();
    if (!freshStatus) {
      setStatus?.("Failed to check status");
      setIsSettingUpBurner(false);
      return;
    }

    // Check authorization using fresh values
    if (!freshStatus.isAuthorized) {
      setStatus?.("Authorizing burner wallet...");
      const authorized = await burner.authorizeBurner();
      if (!authorized) {
        setStatus?.("Authorization failed");
        setIsSettingUpBurner(false);
        return;
      }
    }

    // Check balance and fund BEFORE trying to start
    // Need ~0.22 MON but Monad may need higher buffer
    const minBalance = BigInt(0.5 * 10**18); // 0.5 MON minimum
    if (freshStatus.balance < minBalance) {
      setStatus?.("Funding game session...");
      const funded = await burner.fundBurner();
      if (!funded) {
        setStatus?.("Funding failed");
        setIsSettingUpBurner(false);
        return;
      }
    }

    setIsSettingUpBurner(false);
    setBurnerMode(true);
    setIsStartingGame(true);
    setStatus?.("Starting game...");

    const hash = await burner.startGameWithBurner();

    if (hash) {
      setStatus?.("Waiting for VRF...");
      // Transaction is confirmed - immediately refetch player games to pick up new gameId
      // Note: isStartingGame will be cleared by effect when game becomes ACTIVE
      await refetchPlayerGames?.();
    } else {
      setStatus?.("Failed to start game");
      setBurnerMode(false);
      setIsStartingGame(false);
    }
  }, [burner, setStatus, refetchPlayerGames]);

  // Handle add band with burner
  const [isAddingBand, setIsAddingBand] = useState(false);
  const isAddingBandRef = useRef(false);

  const handleAddBand = useCallback(async () => {
    if (!gameId || isAddingBandRef.current) return;

    if (burnerMode && burner.isAuthorized) {
      // Prevent double execution
      isAddingBandRef.current = true;

      // Optimistic update - show new band count immediately
      const newBands = gameState.currentBands + 1;
      setOptimisticBands(newBands);
      setIsAddingBand(true);

      const hash = await burner.addBandWithBurner(gameId);
      setIsAddingBand(false);
      isAddingBandRef.current = false;

      if (hash) {
        // Wait for refetch to complete BEFORE clearing optimistic state
        await refetchGameState?.();
        setOptimisticBands(null);
      } else {
        setOptimisticBands(null);
        setStatus?.("Failed to add band");
      }
    } else {
      addBand();
    }
  }, [burnerMode, burner, gameId, gameState.currentBands, addBand, setStatus, refetchGameState]);

  // Handle cash out with burner
  const [isCashingOut, setIsCashingOut] = useState(false);
  const isCashingOutRef = useRef(false);

  const handleCashOut = useCallback(async () => {
    if (!gameId || isCashingOutRef.current) return;

    if (burnerMode && burner.isAuthorized) {
      // Prevent double execution
      isCashingOutRef.current = true;
      setIsCashingOut(true);

      const hash = await burner.cashOutWithBurner(gameId);
      setIsCashingOut(false);
      isCashingOutRef.current = false;

      if (hash) {
        await refetchGameState?.();
        // Auto-withdraw silently in background (don't override game result display)
        if (burner.canWithdraw) {
          burner.withdrawToUser().then(() => burner.refreshStatus());
        }
        setBurnerMode(false);
      } else {
        setStatus?.("Failed to cash out");
      }
    } else {
      cashOut();
    }
  }, [burnerMode, burner, gameId, cashOut, setStatus, refetchGameState]);

  if (!mounted || !ready) {
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

  const isProcessing = isPending || isConfirming || isValidatingGame || isSettingUpBurner || isCashingOut || isAddingBand || isStartingGame;
  const isStartingFlow = isSettingUpBurner || isStartingGame;
  const showVRFWaiting = isWaitingForVRF || isStartingGame || gameState.currentState === GameState.REQUESTING_VRF;

  // Compute display values - use optimistic state for instant feedback
  const displayBands = optimisticBands ?? gameState.currentBands;
  const displayMultiplier = optimisticBands !== null
    ? getMultiplierForBands(optimisticBands)
    : gameState.currentMultiplier;
  const displayScore = optimisticBands !== null
    ? calculateScore(optimisticBands, displayMultiplier)
    : gameState.potentialScore;
  const displayDangerLevel = optimisticBands !== null
    ? getDangerLevel(optimisticBands)
    : dangerLevel;

  return (
    <div className="max-w-md mx-auto">
      {/* Top stats */}
      <div className="flex justify-between mb-4 text-sm text-gray-500">
        <div>
          <span className="text-gray-400">Best: </span>
          <span className="font-medium text-black">{bestScore.toString()} pts</span>
        </div>
        <div>
          <span className="text-gray-400">Max: </span>
          <span className="font-medium text-black">{formatMultiplier(getMultiplierForBands(SOLO_MAX_THRESHOLD - 1))}</span>
        </div>
      </div>

      {/* Main card */}
      <div className="p-4">

        {/* Burner mode indicator */}
        {burnerMode && isGameActive && (
          <div className="flex items-center justify-center gap-1.5 mb-4">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-xs text-green-600 font-medium">Instant Mode</span>
            <span className="text-xs text-gray-400">({burner.formattedBalance} MON)</span>
          </div>
        )}

        {/* Watermelon */}
        <div className="relative w-36 h-36 mx-auto mb-6">
          <div
            className={`w-full h-full rounded-full flex items-center justify-center text-6xl transition-all ${
              isExploded ? 'bg-red-50' : 'bg-green-50'
            } ${
              isWaitingForVRF ? 'animate-pulse' :
              displayBands > 20 && !isExploded ? 'animate-[wiggle_0.5s_ease-in-out_infinite]' : ''
            }`}
          >
            {isExploded ? '💥' : '🍉'}
          </div>

          {/* Band count */}
          {displayBands > 0 && !isExploded && (
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-black text-white text-xs font-medium px-3 py-1 rounded-full">
              {displayBands} bands
            </div>
          )}
        </div>

        {/* Stats */}
        {(isGameActive || isGameOver) && gameState.currentState !== null && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="text-center">
              <div className="text-gray-400 text-xs mb-1">Multiplier</div>
              <div className={`text-2xl font-bold ${isExploded ? 'text-red-500' : 'text-black'}`}>
                {formatMultiplier(displayMultiplier)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-gray-400 text-xs mb-1">Score</div>
              <div className={`text-2xl font-bold ${isExploded ? 'text-red-500' : 'text-black'}`}>
                {isExploded ? '0' : isScored ? gameState.finalScore.toString() : displayScore.toString()}
              </div>
            </div>
          </div>
        )}

        {/* Threshold reveal with VRF verification */}
        {isGameOver && gameState.threshold > 0 && !isCancelled && (
          <div className={`text-center text-sm mb-6 py-3 px-4 rounded-lg ${isExploded ? 'bg-red-50' : 'bg-green-50'}`}>
            <div className={isExploded ? 'text-red-600' : 'text-green-600'}>
              Threshold was {gameState.threshold} bands
            </div>
            {gameState.vrfSequence > 0n && (
              <a
                href={`https://entropy-explorer.pyth.network/?chain=monad-testnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600 underline mt-1 inline-block"
              >
                Verify on Pyth (seq #{gameState.vrfSequence.toString()})
              </a>
            )}
          </div>
        )}

        {/* Cancelled game message */}
        {isCancelled && (
          <div className="text-center text-sm mb-6 py-2 rounded-lg bg-gray-50 text-gray-600">
            Game cancelled - entry fee refunded
          </div>
        )}

        {/* Status - hide when setup spinner shows status */}
        {status && !isGameOver && !isSettingUpBurner && (
          <div className={`text-center text-sm mb-6 ${
            status.startsWith('Error:')
              ? 'text-red-600 bg-red-50 py-2 px-3 rounded-lg'
              : 'text-gray-500'
          }`}>
            {status}
          </div>
        )}

        {/* Controls */}
        {isSettingUpBurner ? (
          <div className="text-center py-4">
            <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-500 text-sm">{status || "Setting up..."}</p>
          </div>
        ) : showVRFWaiting ? (
          <div className="text-center py-4">
            <div className="text-2xl mb-2 animate-bounce">🎲</div>
            <p className="text-gray-500 text-sm">Generating threshold...</p>
            <p className="text-xs text-gray-400 mt-1">Pyth Entropy VRF</p>
            <div className="flex gap-2 justify-center mt-4">
              <button
                onClick={checkStatus}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Check Status
              </button>
              {isStale && (
                <button
                  onClick={cancelGame}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
                >
                  Cancel & Refund
                </button>
              )}
            </div>
            {isStale && (
              <p className="text-xs text-red-500 mt-2">VRF timed out - you can cancel for a refund</p>
            )}
          </div>
        ) : (gameId && !isGameActive && !isGameOver) || isValidatingGame || isStartingGame ? (
          // Transitional state - have gameId but not yet ACTIVE, or validating/starting
          <div className="text-center py-4">
            <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-500 text-sm">Loading game...</p>
          </div>
        ) : !gameId || isGameOver ? (
          <div className="space-y-4">
            {/* Entry fee */}
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Entry fee</span>
              <span className="font-medium">{formatEther(cost.entryFee)} MON</span>
            </div>

            {/* Session balance when funded */}
            {burner.isReady && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Session balance</span>
                <span className="font-medium text-green-600">{burner.formattedBalance} MON</span>
              </div>
            )}

            <button
              onClick={() => {
                resetGame();
                handleStartGame();
              }}
              disabled={isProcessing}
              className="w-full py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
            >
              {isProcessing ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {isSettingUpBurner ? 'Setting up...' : isValidatingGame ? 'Loading...' : isPending ? 'Confirm in wallet...' : 'Processing...'}
                </span>
              ) : isGameOver ? 'Play Again' : 'Start Game'}
            </button>

            {/* Withdraw option - show amount */}
            {burner.canWithdraw && (
              <button
                onClick={() => burner.withdrawToUser()}
                className="w-full py-2 text-sm text-gray-500 hover:text-black transition-colors"
              >
                Withdraw {burner.formattedBalance} MON
              </button>
            )}
          </div>
        ) : isGameActive ? (
          <div className="space-y-4">
            {/* Risk bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Risk</span>
                <span>{displayDangerLevel}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    displayDangerLevel > 60 ? 'bg-red-500' :
                    displayDangerLevel > 30 ? 'bg-yellow-500' :
                    'bg-green-500'
                  }`}
                  style={{ width: `${displayDangerLevel}%` }}
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleCashOut}
                disabled={isProcessing || displayBands === 0}
                className="py-3 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                {isCashingOut ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Confirming
                  </span>
                ) : 'Secure'}
              </button>
              <button
                onClick={handleAddBand}
                disabled={isProcessing}
                className="py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                {isAddingBand ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Adding
                  </span>
                ) : 'Add Band'}
              </button>
            </div>
          </div>
        ) : null}
      </div>

    </div>
  );
}

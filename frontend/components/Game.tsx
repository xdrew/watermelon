"use client";

import { useState, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useChainId } from "wagmi";
import { formatEther } from "viem";
import {
  MONAD_TESTNET,
  GameState,
  formatMultiplier,
  formatTimeLeft,
  getMultiplierForBands,
  SOLO_MAX_THRESHOLD,
} from "@/lib/contract";
import { useWatermelonGame } from "@/hooks/useWatermelonGame";

export function Game() {
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const activeWallet = wallets[0];
  const address = activeWallet?.address as `0x${string}` | undefined;
  const isConnected = authenticated && !!address;
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);

  const {
    gameId,
    status,
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
    sessionKeySupported,
    sessionKeyActive,
    isCreatingSession,
    sessionRemainingTime,
    startGame,
    addBand,
    cashOut,
    cancelGame,
    resetGame,
    checkStatus,
  } = useWatermelonGame(address);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const isProcessing = isPending || isConfirming || isValidatingGame;
  const showVRFWaiting = isWaitingForVRF || gameState.currentState === GameState.REQUESTING_VRF;

  return (
    <div className="max-w-md mx-auto px-4">
      {/* Season info */}
      <div className="flex justify-between items-center mb-8 text-sm">
        <div>
          <div className="text-gray-400 text-xs">Season {season.number}</div>
          <div className="font-medium">{Number(formatEther(season.prizePool)).toFixed(2)} MON pool</div>
        </div>
        <div className="text-right">
          <div className="text-gray-400 text-xs">Ends in</div>
          <div className="font-medium">{formatTimeLeft(season.endTime)}</div>
        </div>
      </div>

      {/* Main card */}
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">

        {/* Session key indicator */}
        {sessionKeyActive && isGameActive && (
          <div className="flex items-center justify-center gap-1.5 mb-4">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-xs text-green-600 font-medium">Fast Mode</span>
            <span className="text-xs text-gray-400">({sessionRemainingTime})</span>
          </div>
        )}
        {isCreatingSession && (
          <div className="flex items-center justify-center gap-1.5 mb-4">
            <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-blue-600">Enabling fast mode...</span>
          </div>
        )}

        {/* Watermelon */}
        <div className="relative w-40 h-40 mx-auto mb-8">
          <div
            className={`w-full h-full rounded-full flex items-center justify-center text-6xl transition-all ${
              isExploded ? 'bg-red-50' : 'bg-green-50'
            } ${
              isWaitingForVRF ? 'animate-pulse' :
              gameState.currentBands > 20 && !isExploded ? 'animate-[wiggle_0.5s_ease-in-out_infinite]' : ''
            }`}
          >
            {isExploded ? '💥' : '🍉'}
          </div>

          {/* Band count */}
          {gameState.currentBands > 0 && !isExploded && (
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-black text-white text-xs font-medium px-3 py-1 rounded-full">
              {gameState.currentBands} bands
            </div>
          )}
        </div>

        {/* Stats */}
        {(isGameActive || isGameOver) && gameState.currentState !== null && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="text-center">
              <div className="text-gray-400 text-xs mb-1">Multiplier</div>
              <div className={`text-2xl font-bold ${isExploded ? 'text-red-500' : 'text-black'}`}>
                {formatMultiplier(gameState.currentMultiplier)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-gray-400 text-xs mb-1">Score</div>
              <div className={`text-2xl font-bold ${isExploded ? 'text-red-500' : 'text-black'}`}>
                {isExploded ? '0' : isScored ? gameState.finalScore.toString() : gameState.potentialScore.toString()}
              </div>
            </div>
          </div>
        )}

        {/* Threshold reveal */}
        {isGameOver && gameState.threshold > 0 && !isCancelled && (
          <div className={`text-center text-sm mb-6 py-2 rounded-lg ${isExploded ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            Threshold was {gameState.threshold} bands
          </div>
        )}

        {/* Cancelled game message */}
        {isCancelled && (
          <div className="text-center text-sm mb-6 py-2 rounded-lg bg-gray-50 text-gray-600">
            Game cancelled - entry fee refunded
          </div>
        )}

        {/* Status */}
        {status && !isGameOver && (
          <div className={`text-center text-sm mb-6 ${
            status.startsWith('Error:')
              ? 'text-red-600 bg-red-50 py-2 px-3 rounded-lg'
              : 'text-gray-500'
          }`}>
            {status}
          </div>
        )}

        {/* Controls */}
        {showVRFWaiting ? (
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
        ) : !gameId || isGameOver ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Entry fee</span>
              <div className="text-right">
                <span className="font-medium">{Number(formatEther(cost.entryFee)).toFixed(3)} MON</span>
                {cost.vrfFee > 0 && (
                  <div className="text-xs text-gray-400">+ {Number(formatEther(cost.vrfFee)).toFixed(4)} VRF</div>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                resetGame();
                startGame();
              }}
              disabled={isProcessing}
              className="w-full py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
            >
              {isProcessing ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {isValidatingGame ? 'Loading...' : isPending ? 'Confirm in wallet...' : 'Processing...'}
                </span>
              ) : isGameOver ? 'Play Again' : 'Start Game'}
            </button>
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
                disabled={isProcessing || gameState.currentBands === 0}
                className="py-3 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                {isPending || isConfirming ? (
                  <span className="flex items-center justify-center gap-1">
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {isPending ? 'Confirm...' : 'Saving...'}
                  </span>
                ) : 'Secure'}
              </button>
              <button
                onClick={addBand}
                disabled={isProcessing}
                className="py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                {isPending || isConfirming ? (
                  <span className="flex items-center justify-center gap-1">
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {isPending ? 'Confirm...' : 'Adding...'}
                  </span>
                ) : 'Add Band'}
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
          <span className="font-medium text-black">{formatMultiplier(getMultiplierForBands(SOLO_MAX_THRESHOLD - 1))}</span>
        </div>
      </div>
    </div>
  );
}

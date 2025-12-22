"use client";

import { useState } from "react";
import { DEFAULT_ENTRY_FEE, getDangerLevel, SOLO_MAX_THRESHOLD } from "@/lib/contract";

function calculateScore(bands: number, threshold: number): number {
  // Match contract: score = bands² + bands × (16 - threshold)
  return (bands * bands) + (bands * (16 - threshold));
}

export function GameDemo() {
  const [gameId, setGameId] = useState<number | null>(null);
  const [currentBands, setCurrentBands] = useState(0);
  const [threshold, setThreshold] = useState(0);
  const [status, setStatus] = useState("");
  const [isExploded, setIsExploded] = useState(false);
  const [isScored, setIsScored] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [prizePool, setPrizePool] = useState(0);

  const dangerLevel = getDangerLevel(currentBands);
  const isGameActive = gameId !== null && !isExploded && !isScored;
  const isGameOver = isExploded || isScored;

  const startGame = () => {
    const newThreshold = Math.floor(Math.random() * 15) + 1;
    setGameId(Date.now());
    setThreshold(newThreshold);
    setCurrentBands(0);
    setIsExploded(false);
    setIsScored(false);
    setFinalScore(0);
    setStatus("");
    setPrizePool(prev => prev + DEFAULT_ENTRY_FEE * 0.9);
  };

  const addBand = () => {
    const newBands = currentBands + 1;
    setCurrentBands(newBands);
    if (newBands >= threshold) {
      setIsExploded(true);
      setFinalScore(0);
      setStatus(`Exploded at ${threshold} bands`);
    } else {
      setStatus("");
    }
  };

  const cashOut = () => {
    const score = calculateScore(currentBands, threshold);
    setIsScored(true);
    setFinalScore(score);
    if (score > bestScore) {
      setBestScore(score);
      setStatus(`New best: ${score} pts`);
    } else {
      setStatus(`${score} pts`);
    }
  };

  const resetGame = () => {
    setGameId(null);
    setCurrentBands(0);
    setThreshold(0);
    setIsExploded(false);
    setIsScored(false);
    setFinalScore(0);
    setStatus("");
  };

  return (
    <div className="max-w-md mx-auto">
      {/* Header row */}
      <div className="flex justify-between items-center mb-2 px-1 text-xs">
        <div className="text-gray-400">Demo Mode</div>
        <div className="text-gray-400">Best: <span className="text-gray-600 font-medium">{bestScore}</span></div>
      </div>

      {/* Main card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">

        {/* Watermelon */}
        <div className="relative w-36 h-36 mx-auto mb-6">
          <div
            className={`w-full h-full rounded-full flex items-center justify-center text-6xl transition-all ${
              isExploded ? 'bg-red-50' : 'bg-green-50'
            } ${currentBands > 20 && !isExploded ? 'animate-[wiggle_0.5s_ease-in-out_infinite]' : ''}`}
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

        {/* Score display - prominent when game ends */}
        {isGameOver && (
          <div className="text-center mb-6">
            <div className={`text-5xl font-bold ${isExploded ? 'text-red-500' : 'text-green-600'}`}>
              {isExploded ? '0' : finalScore}
            </div>
            <div className="text-gray-400 text-sm mt-1">points</div>
          </div>
        )}

        {/* Threshold reveal */}
        {isGameOver && (
          <div className={`text-center text-sm mb-6 py-2 px-3 rounded-lg ${isExploded ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            {isExploded ? (
              <>Exploded at {threshold} bands!</>
            ) : (
              <>Cashed out! Threshold was {threshold}</>
            )}
          </div>
        )}

        {/* Status */}
        {status && !isGameOver && (
          <div className="text-center text-sm text-gray-500 mb-6">
            {status}
          </div>
        )}

        {/* Controls */}
        {!gameId || isGameOver ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Entry fee</span>
              <span className="font-medium">{DEFAULT_ENTRY_FEE} MON</span>
            </div>
            <button
              onClick={isGameOver ? resetGame : startGame}
              className="w-full py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 transition-colors"
            >
              {isGameOver ? 'Play Again' : 'Start Game'}
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
                disabled={currentBands === 0}
                className="py-3 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                Secure
              </button>
              <button
                onClick={addBand}
                className="py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 transition-colors"
              >
                Add Band
              </button>
            </div>
          </div>
        ) : null}
      </div>

    </div>
  );
}

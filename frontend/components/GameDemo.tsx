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
    <div className="flex flex-col items-center">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span>Demo Mode</span>
        <span className="text-gray-300">|</span>
        <span>Best: <span className="text-gray-600 font-medium">{bestScore}</span></span>
      </div>

      {/* HERO: Watermelon */}
      <div className="relative w-72 h-72 md:w-80 md:h-80 mx-auto z-0 overflow-hidden">
        <div
          className={`w-full h-full flex items-center justify-center transition-all ${
            currentBands >= 10 && !isExploded ? 'animate-[wiggle-intense_0.15s_ease-in-out_infinite]' :
            currentBands >= 5 && !isExploded ? 'animate-[wiggle_0.3s_ease-in-out_infinite]' : ''
          }`}
        >
          <img
            src={isExploded ? '/wm-explode.png' : '/wm.png'}
            alt={isExploded ? 'Exploded watermelon' : 'Watermelon'}
            className="w-full h-full object-contain"
          />
        </div>

        {/* Band count badge - hide when game is over */}
        {currentBands > 0 && !isExploded && !isGameOver && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black text-white text-sm font-bold px-4 py-1.5 rounded-full shadow-lg">
            {currentBands} bands
          </div>
        )}
      </div>

      {/* Score display when game ends */}
      {isGameOver && (
        <div className="text-center mb-4 -mt-14 relative z-10">
          <div className={`text-6xl font-black ${isExploded ? 'text-red-500' : 'text-green-500'}`}>
            {isExploded ? '0' : finalScore}
          </div>
          <div className="text-gray-400 text-sm mt-1">points</div>
        </div>
      )}

      {/* Threshold reveal */}
      {isGameOver && (
        <div className={`text-center text-sm mb-6 py-2 px-6 rounded-full ${isExploded ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {isExploded ? `Exploded at ${threshold} bands!` : `Threshold was ${threshold}`}
        </div>
      )}

      {/* Status */}
      {status && !isGameOver && (
        <div className="text-center text-sm text-gray-400 mb-4">
          {status}
        </div>
      )}

      {/* Controls */}
      <div className="w-full max-w-xs">
        {!gameId || isGameOver ? (
          <div className="space-y-3">
            <div className="flex justify-center items-center gap-4 text-sm text-gray-400">
              <span>Entry: {DEFAULT_ENTRY_FEE} MON</span>
            </div>
            <button
              onClick={isGameOver ? () => { resetGame(); startGame(); } : startGame}
              className="w-full py-3 bg-black text-white rounded-full font-medium hover:bg-gray-800 transition-colors"
            >
              {isGameOver ? 'Play Again' : 'Start Game'}
            </button>
          </div>
        ) : isGameActive ? (
          <div className="space-y-4">
            {/* Risk bar */}
            <div className="w-full">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Risk</span>
                <span>{dangerLevel}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
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

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={cashOut}
                disabled={currentBands === 0}
                className="py-3 bg-green-500 text-white rounded-full font-medium hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                Secure
              </button>
              <button
                onClick={addBand}
                className="py-3 bg-black text-white rounded-full font-medium hover:bg-gray-800 transition-colors"
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

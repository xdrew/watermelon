"use client";

import { useState } from "react";
import { ENTRY_FEE } from "@/lib/contract";

function getMultiplier(bands: number): number {
  return Math.pow(1.025, bands);
}

function calculateScore(bands: number, multiplier: number): number {
  return Math.floor(bands * multiplier * 100);
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

  const multiplier = getMultiplier(currentBands);
  const potentialScore = calculateScore(currentBands, multiplier);
  const dangerLevel = Math.min(100, currentBands * 2);
  const isGameActive = gameId !== null && !isExploded && !isScored;
  const isGameOver = isExploded || isScored;

  const startGame = () => {
    const newThreshold = Math.floor(Math.random() * 50) + 1;
    setGameId(Date.now());
    setThreshold(newThreshold);
    setCurrentBands(0);
    setIsExploded(false);
    setIsScored(false);
    setFinalScore(0);
    setStatus("");
    setPrizePool(prev => prev + ENTRY_FEE * 0.9);
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
    const score = potentialScore;
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
    <div className="max-w-md mx-auto px-4">
      {/* Demo badge */}
      <div className="text-center mb-6">
        <span className="text-xs text-gray-400 border border-gray-200 rounded-full px-3 py-1">
          Demo Mode
        </span>
      </div>

      {/* Season info */}
      <div className="flex justify-between items-center mb-8 text-sm">
        <div>
          <div className="text-gray-400 text-xs">Season 1</div>
          <div className="font-medium">{prizePool.toFixed(2)} MON pool</div>
        </div>
        <div className="text-right">
          <div className="text-gray-400 text-xs">Ends in</div>
          <div className="font-medium">23h 45m</div>
        </div>
      </div>

      {/* Main card */}
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">

        {/* Watermelon */}
        <div className="relative w-40 h-40 mx-auto mb-8">
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

        {/* Stats */}
        {(isGameActive || isGameOver) && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="text-center">
              <div className="text-gray-400 text-xs mb-1">Multiplier</div>
              <div className={`text-2xl font-bold ${isExploded ? 'text-red-500' : 'text-black'}`}>
                {multiplier.toFixed(2)}x
              </div>
            </div>
            <div className="text-center">
              <div className="text-gray-400 text-xs mb-1">Score</div>
              <div className={`text-2xl font-bold ${isExploded ? 'text-red-500' : 'text-black'}`}>
                {isExploded ? '0' : isScored ? finalScore : potentialScore}
              </div>
            </div>
          </div>
        )}

        {/* Threshold reveal */}
        {isGameOver && (
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
        {!gameId || isGameOver ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Entry fee</span>
              <span className="font-medium">{ENTRY_FEE} MON</span>
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

      {/* Bottom stats */}
      <div className="flex justify-between mt-6 text-sm text-gray-500">
        <div>
          <span className="text-gray-400">Best: </span>
          <span className="font-medium text-black">{bestScore} pts</span>
        </div>
        <div>
          <span className="text-gray-400">Max: </span>
          <span className="font-medium text-black">3.35x</span>
        </div>
      </div>
    </div>
  );
}

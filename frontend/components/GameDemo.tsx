"use client";

import { useState } from "react";
import { MIN_BET, MAX_BET, PROTOCOL_FEE_BPS, BASIS_POINTS } from "@/lib/contract";

// Simple hash function for demo VRF verification
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// Generate a verifiable random threshold using seed
function generateVerifiableThreshold(seed: string): { threshold: number; hash: string } {
  const hash = hashString(seed);
  // Use hash to deterministically generate threshold 1-50
  const threshold = (parseInt(hash.slice(0, 4), 16) % 50) + 1;
  return { threshold, hash };
}

export function GameDemo() {
  const [gameId, setGameId] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState("0.005");
  const [currentBands, setCurrentBands] = useState(0);
  const [threshold, setThreshold] = useState(0);
  const [status, setStatus] = useState("");
  const [isExploded, setIsExploded] = useState(false);
  const [isCashedOut, setIsCashedOut] = useState(false);
  const [houseBalance, setHouseBalance] = useState(0.1);
  const [bandsHistory, setBandsHistory] = useState<Array<{ band: number; multiplier: number; timestamp: number }>>([]);
  const [vrfSeed, setVrfSeed] = useState("");
  const [vrfHash, setVrfHash] = useState("");

  const bet = parseFloat(betAmount) || 0;
  const multiplier = Math.min(1.5, 1 + currentBands * 0.02);
  const grossPayout = bet * multiplier;
  const fee = grossPayout * (PROTOCOL_FEE_BPS / BASIS_POINTS);
  const netPayout = grossPayout - fee;
  const dangerLevel = Math.min(100, currentBands * 2);
  const isGameActive = gameId !== null && !isExploded && !isCashedOut;
  const isGameOver = isExploded || isCashedOut;

  const startGame = () => {
    if (bet < MIN_BET || bet > MAX_BET) {
      setStatus(`Bet must be between ${MIN_BET} and ${MAX_BET}`);
      return;
    }

    // Generate verifiable random seed
    const seed = `watermelon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { threshold: newThreshold, hash } = generateVerifiableThreshold(seed);

    setGameId(Date.now());
    setThreshold(newThreshold);
    setVrfSeed(seed);
    setVrfHash(hash);
    setCurrentBands(0);
    setIsExploded(false);
    setIsCashedOut(false);
    setStatus("");
    setBandsHistory([]);

  };

  const addBand = () => {
    const newBands = currentBands + 1;
    const newMultiplier = Math.min(1.5, 1 + newBands * 0.02);

    setCurrentBands(newBands);
    setBandsHistory(prev => [...prev, {
      band: newBands,
      multiplier: newMultiplier,
      timestamp: Date.now()
    }]);

    if (newBands >= threshold) {
      setIsExploded(true);
      setHouseBalance(prev => prev + bet);
      setStatus(`BOOM! Exploded at ${threshold} bands`);
    } else {
      setStatus("");
    }
  };

  const cashOut = () => {
    setIsCashedOut(true);
    const payout = netPayout;

    if (grossPayout > bet) {
      setHouseBalance(prev => prev - (grossPayout - bet));
    } else {
      setHouseBalance(prev => prev + (bet - grossPayout));
    }

    setStatus(`Won ${payout.toFixed(4)} MON!`);
  };

  const resetGame = () => {
    setGameId(null);
    setCurrentBands(0);
    setThreshold(0);
    setIsExploded(false);
    setIsCashedOut(false);
    setStatus("");
  };

  return (
    <div className="max-w-lg mx-auto">
      {/* Demo Badge */}
      <div className="text-center mb-4 space-y-1">
        <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-sm font-medium">
          Demo Mode - No Real Transactions
        </span>
        <div className="text-[10px] text-gray-500">
          Client-side only. Use Live Mode for true VRF security.
        </div>
      </div>

      {/* Glass Card Container */}
      <div className="bg-gradient-to-b from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-3xl p-8 border border-gray-700/50 shadow-2xl">

        {/* Watermelon Visual */}
        <div className="relative w-56 h-56 mx-auto mb-8">
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

          <div
            className={`relative w-full h-full rounded-full flex items-center justify-center text-7xl transition-all duration-300 ${
              isExploded ? 'scale-110' :
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
                : `0 10px 40px rgba(0,0,0,0.3), inset 0 -10px 30px rgba(0,0,0,0.2)`,
            }}
          >
            {isExploded ? '💥' : '🍉'}
          </div>

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

        {/* Game Stats */}
        {(isGameActive || isGameOver) && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-800/80 rounded-2xl p-4 text-center">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Multiplier</div>
              <div className={`text-3xl font-bold ${isExploded ? 'text-red-400' : 'text-green-400'}`}>
                {multiplier.toFixed(2)}x
              </div>
            </div>
            <div className="bg-gray-800/80 rounded-2xl p-4 text-center">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                {isExploded ? 'Lost' : isCashedOut ? 'Won' : 'Potential'}
              </div>
              <div className={`text-3xl font-bold ${isExploded ? 'text-red-400' : 'text-yellow-400'}`}>
                {isExploded ? `-${bet.toFixed(3)}` : netPayout.toFixed(3)}
              </div>
            </div>
          </div>
        )}

        {/* Bands History */}
        {bandsHistory.length > 0 && (
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-gray-400 text-xs uppercase tracking-wider">Band History</span>
              <span className="text-gray-500 text-xs">{bandsHistory.length} stretches</span>
            </div>
            <div className="bg-gray-800/50 rounded-xl p-3 max-h-32 overflow-y-auto">
              <div className="flex flex-wrap gap-1">
                {bandsHistory.map((entry, i) => (
                  <div
                    key={entry.timestamp}
                    className={`px-2 py-1 rounded text-xs font-mono ${
                      isExploded && i === bandsHistory.length - 1
                        ? 'bg-red-500/30 text-red-300'
                        : 'bg-gray-700/50 text-gray-300'
                    }`}
                    title={`Band #${entry.band} at ${entry.multiplier.toFixed(2)}x`}
                  >
                    #{entry.band} <span className="text-green-400">{entry.multiplier.toFixed(2)}x</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VRF Verification Panel */}
        {(isGameActive || isGameOver) && vrfHash && (
          <div className="mb-6 bg-gray-800/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-purple-400 text-xs uppercase tracking-wider font-medium">VRF Verification</span>
              <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-[10px]">Provably Fair</span>
            </div>

            {/* Commitment Hash - always shown */}
            <div className="mb-2">
              <span className="text-gray-500 text-xs">Commitment Hash:</span>
              <div className="font-mono text-sm text-purple-300 bg-gray-900/50 rounded px-2 py-1 mt-1 break-all">
                0x{vrfHash}
              </div>
            </div>

            {/* Seed - only revealed after game over */}
            {isGameOver ? (
              <>
                <div className="mb-2">
                  <span className="text-gray-500 text-xs">Revealed Seed:</span>
                  <div className="font-mono text-xs text-green-300 bg-gray-900/50 rounded px-2 py-1 mt-1 break-all">
                    {vrfSeed}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                  <span className="text-gray-400 text-xs">Threshold from seed:</span>
                  <span className={`font-bold ${isExploded ? 'text-red-400' : 'text-green-400'}`}>
                    {threshold} bands
                  </span>
                </div>
                <div className="mt-2 text-[10px] text-gray-500">
                  Verify: hash({vrfSeed.slice(0, 20)}...) % 50 + 1 = {threshold}
                </div>
              </>
            ) : (
              <div className="text-xs text-gray-500 italic">
                Seed hidden until game ends. Threshold is pre-committed.
              </div>
            )}
          </div>
        )}

        {/* Status Message */}
        {status && (
          <div className={`text-center mb-6 py-3 px-4 rounded-xl text-sm ${
            status.includes('BOOM') ? 'bg-red-500/20 text-red-300' :
            status.includes('Won') ? 'bg-green-500/20 text-green-300' :
            'bg-gray-700/50 text-gray-300'
          }`}>
            {status}
          </div>
        )}

        {/* Controls */}
        <div className="space-y-4">
          {!gameId || isGameOver ? (
            <>
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
              </div>

              <button
                onClick={isGameOver ? resetGame : startGame}
                className="w-full py-4 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 rounded-2xl text-xl font-bold transition-all shadow-lg shadow-green-500/25 hover:shadow-green-500/40"
              >
                {isGameOver ? '🔄 Play Again' : '🍉 Start Game'}
              </button>
            </>
          ) : isGameActive ? (
            <div className="space-y-3">
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

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={cashOut}
                  className="py-4 bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-400 hover:to-amber-400 rounded-2xl text-lg font-bold transition-all shadow-lg shadow-yellow-500/25"
                >
                  💰 Cash Out
                </button>
                <button
                  onClick={addBand}
                  className="py-4 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 rounded-2xl text-lg font-bold transition-all shadow-lg shadow-red-500/25"
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
          <div className="text-lg font-mono text-gray-300 mt-1">{houseBalance.toFixed(2)} MON</div>
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

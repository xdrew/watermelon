"use client";

import { useState, useRef, useEffect } from "react";

export function HowToPlay() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative ml-[43px]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 text-sm transition-all ${
          isOpen ? 'text-gray-600' : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        <span>How to Play</span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-100 p-4 z-[100]">
          <div className="space-y-3">
            {/* Step cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-3 text-center">
                <div className="text-2xl mb-1">🎲</div>
                <div className="text-xs font-medium text-green-800">Start</div>
                <div className="text-[10px] text-green-600 mt-1">Pay fee, get random threshold</div>
              </div>
              <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-xl p-3 text-center">
                <div className="text-2xl mb-1">🍉</div>
                <div className="text-xs font-medium text-yellow-800">Add Bands</div>
                <div className="text-[10px] text-yellow-600 mt-1">Push your luck or secure the score</div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-3 text-center">
                <div className="text-2xl mb-1">🏆</div>
                <div className="text-xs font-medium text-purple-800">Win</div>
                <div className="text-[10px] text-purple-600 mt-1">Top 10 split the pool</div>
              </div>
            </div>

            {/* Key info */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">💥</span>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-800">The Catch</div>
                  <div className="text-[11px] text-gray-500">Threshold is hidden (1-15). Hit it and you explode with 0 points!</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">🎲 Powered by Pyth VRF — provably fair & verifiable</div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">📊</span>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-800">Scoring Formula</div>
                  <div className="text-[11px] text-gray-500">
                    <span className="font-mono bg-gray-200 px-1 rounded">bands² + bands × (16 - threshold)</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">Lower threshold = harder game = bonus points</div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">🏆</span>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-800">Seasons & Prizes</div>
                  <div className="text-[11px] text-gray-500">90% of entry fees go to prize pool. Top 10 split it:</div>
                  <div className="text-[10px] text-gray-400 mt-0.5 font-mono">
                    40% · 25% · 15% · 8% · 5% · 1.4%×5
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">💡 Trigger payouts when season ends → earn 1% reward</div>
                </div>
              </div>
            </div>

            {/* Example scores */}
            <div className="flex justify-center gap-4 text-[10px] text-gray-400">
              <span>8 bands @ threshold 13 = <span className="text-gray-600 font-medium">88 pts</span></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

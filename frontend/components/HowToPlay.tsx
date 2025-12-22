"use client";

import { useState } from "react";

export function HowToPlay() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="max-w-sm mx-auto mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-center gap-2 py-2 text-sm transition-all ${
          isOpen ? 'text-gray-600' : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        <span>How to Play</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="mt-3 space-y-3">
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
              <div className="text-[10px] text-yellow-600 mt-1">Push your luck or cash out</div>
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
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-sm">📊</span>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-800">Scoring</div>
                <div className="text-[11px] text-gray-500">
                  More bands = higher score. Harder games give bonus points.
                </div>
              </div>
            </div>
          </div>

          {/* Example scores */}
          <div className="flex justify-center gap-4 text-[10px] text-gray-400">
            <span>14 bands easy = <span className="text-gray-600 font-medium">210 pts</span></span>
            <span>•</span>
            <span>5 bands hard = <span className="text-gray-600 font-medium">90 pts</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

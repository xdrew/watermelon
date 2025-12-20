"use client";

import { useState } from "react";
import Link from "next/link";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Game } from "@/components/Game";
import { GameDemo } from "@/components/GameDemo";
import { Leaderboard } from "@/components/Leaderboard";

export default function Home() {
  const [isDemo, setIsDemo] = useState(true);

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <span className="text-3xl md:text-4xl">🍉</span>
            <span>Watermelon Snap</span>
          </h1>
          <div className="flex items-center gap-4">
            {!isDemo && (
              <>
                <Link
                  href="/history"
                  className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                >
                  History
                </Link>
                <ConnectWallet />
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mode Toggle */}
      <div className="container mx-auto px-4 mb-4">
        <div className="flex flex-col items-center gap-2">
          <div className="inline-flex border border-gray-200 rounded-xl p-1 bg-white">
            <button
              onClick={() => setIsDemo(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isDemo
                  ? "bg-black text-white"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              Demo
            </button>
            <button
              onClick={() => setIsDemo(false)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                !isDemo
                  ? "bg-black text-white"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              Live
            </button>
          </div>
          <div className={`text-xs px-3 py-1 rounded-full ${
            isDemo
              ? "bg-yellow-100 text-yellow-700"
              : "bg-green-100 text-green-700"
          }`}>
            {isDemo ? "Practice mode - no real MON" : "Live on Monad Testnet"}
          </div>
        </div>
      </div>

      {/* Game + Leaderboard */}
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8 justify-center">
          <div className="flex-1 max-w-md">
            {isDemo ? <GameDemo /> : <Game />}
          </div>
          <div className="w-full lg:w-80">
            <Leaderboard />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 mt-auto">
        <div className="text-center text-sm space-y-2">
          <p className="flex items-center justify-center gap-2 flex-wrap">
            <span className="px-2 py-1 border border-gray-200 rounded text-gray-500 text-xs">Monad Testnet</span>
            <span className="text-gray-300">|</span>
            <a
              href="https://testnet.monadexplorer.com/address/0xC9b820C2437eFEa3CDE50Df75C3d8D9E6c5DBDf7"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-gray-600 transition-colors font-mono"
            >
              0xC9b8...BDf7
            </a>
          </p>
          <p className="text-gray-400">
            Daily prize pool. Top 10 scores win.
          </p>
        </div>
      </footer>
    </main>
  );
}

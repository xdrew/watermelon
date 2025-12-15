"use client";

import { useState } from "react";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Game } from "@/components/Game";
import { GameDemo } from "@/components/GameDemo";

export default function Home() {
  const [isDemo, setIsDemo] = useState(true);

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <span className="text-3xl md:text-4xl">🍉</span>
            <span className="bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent">
              Watermelon Snap
            </span>
          </h1>
          <div className="flex items-center gap-4">
            {!isDemo && <ConnectWallet />}
          </div>
        </div>
      </header>

      {/* Mode Toggle */}
      <div className="container mx-auto px-4 mb-4">
        <div className="flex justify-center">
          <div className="inline-flex bg-gray-800/50 rounded-xl p-1">
            <button
              onClick={() => setIsDemo(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isDemo
                  ? "bg-yellow-500 text-gray-900"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              🎮 Demo Mode
            </button>
            <button
              onClick={() => setIsDemo(false)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                !isDemo
                  ? "bg-green-500 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              ⛓️ Live Mode
            </button>
          </div>
        </div>
      </div>

      {/* Game */}
      <div className="container mx-auto px-4 py-8">
        {isDemo ? <GameDemo /> : <Game />}
      </div>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 mt-auto">
        <div className="text-center text-gray-500 text-sm space-y-2">
          <p className="flex items-center justify-center gap-2 flex-wrap">
            <span className="px-2 py-1 bg-purple-500/20 rounded text-purple-400 text-xs">Monad Testnet</span>
            <span className="text-gray-600">|</span>
            <a
              href="https://testnet.monadexplorer.com/address/0xC9b820C2437eFEa3CDE50Df75C3d8D9E6c5DBDf7"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-gray-300 transition-colors font-mono"
            >
              0xC9b8...BDf7
            </a>
          </p>
          <p className="text-gray-600">
            Add rubber bands until you cash out or explode. House edge: 5%
          </p>
        </div>
      </footer>
    </main>
  );
}

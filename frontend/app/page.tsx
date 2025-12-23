"use client";

import { useState } from "react";
import Link from "next/link";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Game } from "@/components/Game";
import { GameDemo } from "@/components/GameDemo";
import { HowToPlay } from "@/components/HowToPlay";
import { CONTRACT_ADDRESS } from "@/lib/contract";

export default function Home() {
  const [isDemo, setIsDemo] = useState(true);

  return (
    <main className="min-h-screen flex flex-col overflow-x-hidden">
      {/* Header */}
      <header className="container mx-auto px-4 py-3 relative z-50">
        {/* Mobile: stacked layout */}
        <div className="flex flex-col gap-2 sm:hidden">
          {/* Row 1: Logo + Toggle */}
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold flex items-center gap-1.5">
              <span className="text-xl">🍉</span>
              <span>Watermelon Snap</span>
            </h1>
            <div className="inline-flex border border-gray-200 rounded-full p-0.5">
              <button
                onClick={() => setIsDemo(true)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  isDemo ? "bg-black text-white" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Demo
              </button>
              <button
                onClick={() => setIsDemo(false)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  !isDemo ? "bg-black text-white" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Live
              </button>
            </div>
          </div>
          {/* Row 2: How to Play + Wallet */}
          <div className="flex items-center justify-between">
            <HowToPlay />
            {!isDemo && (
              <div className="flex items-center gap-2">
                <Link
                  href="/history"
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  History
                </Link>
                <ConnectWallet />
              </div>
            )}
          </div>
        </div>

        {/* Desktop: three-column grid layout */}
        <div className="hidden sm:grid grid-cols-3 items-start">
          {/* Left: Logo + How to Play */}
          <div className="flex flex-col">
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <span className="text-2xl">🍉</span>
              <span>Watermelon Snap</span>
            </h1>
            <HowToPlay />
          </div>

          {/* Center: Mode Toggle */}
          <div className="flex justify-center">
            <div className="inline-flex border border-gray-200 rounded-full p-0.5">
              <button
                onClick={() => setIsDemo(true)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  isDemo ? "bg-black text-white" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Demo
              </button>
              <button
                onClick={() => setIsDemo(false)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  !isDemo ? "bg-black text-white" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Live
              </button>
            </div>
          </div>

          {/* Right: History + Connect */}
          <div className="flex items-center justify-end gap-3">
            {!isDemo && (
              <>
                <Link
                  href="/history"
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  History
                </Link>
                <ConnectWallet />
              </>
            )}
          </div>
        </div>
      </header>

      {/* Game */}
      <div className="flex-1 flex justify-center px-4 pt-4">
        {isDemo ? <GameDemo /> : <Game />}
      </div>

      {/* Footer - minimal */}
      <footer className="container mx-auto px-4 py-4">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-gray-400">
          <span>Daily prizes</span>
          <span>•</span>
          <span>Top 10 win</span>
          <span>•</span>
          <a
            href={`https://testnet.monadexplorer.com/address/${CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-600 font-mono"
          >
            {CONTRACT_ADDRESS.slice(0, 6)}...{CONTRACT_ADDRESS.slice(-4)}
          </a>
        </div>
      </footer>
    </main>
  );
}

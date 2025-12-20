"use client";

import { ConnectWallet } from "@/components/ConnectWallet";
import { GameHistory } from "@/components/GameHistory";
import Link from "next/link";

export default function HistoryPage() {
  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center">
          <Link href="/" className="text-2xl md:text-3xl font-bold flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-3xl md:text-4xl">🍉</span>
            <span>Watermelon Snap</span>
          </Link>
          <ConnectWallet />
        </div>
      </header>

      {/* Navigation */}
      <div className="container mx-auto px-4 mb-6">
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="text-gray-500 hover:text-gray-900 transition-colors">
            Game
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">History</span>
        </nav>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <GameHistory />
        </div>
      </div>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 mt-auto">
        <div className="text-center text-sm text-gray-400">
          <Link href="/" className="hover:text-gray-600 transition-colors">
            Back to Game
          </Link>
        </div>
      </footer>
    </main>
  );
}

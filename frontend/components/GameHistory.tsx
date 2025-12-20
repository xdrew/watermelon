"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { CONTRACT_ADDRESS, CONTRACT_ABI, GameState, formatMultiplier } from "@/lib/contract";
import Link from "next/link";

interface GameData {
  gameId: bigint;
  player: string;
  currentBands: bigint;
  currentMultiplier: bigint;
  potentialScore: bigint;
  score: bigint;
  season: bigint;
  state: number;
  threshold: bigint;
  createdAt: bigint;
}

const GAMES_PER_PAGE = 10;

export function GameHistory() {
  const { address, isConnected } = useAccount();
  const [page, setPage] = useState(0);
  const [games, setGames] = useState<GameData[]>([]);

  // Fetch player's game IDs with pagination
  const { data: gamesPage, isLoading: isLoadingIds } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getPlayerGamesPage",
    args: address ? [address, BigInt(page * GAMES_PER_PAGE), BigInt(GAMES_PER_PAGE)] : undefined,
    query: { enabled: !!address },
  });

  const gameIds = gamesPage?.[0] ?? [];
  const totalGames = gamesPage?.[1] ?? 0n;
  const totalPages = Math.ceil(Number(totalGames) / GAMES_PER_PAGE);

  // Fetch game states for all game IDs
  const { data: gameStates, isLoading: isLoadingStates } = useReadContracts({
    contracts: gameIds.map((gameId) => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "getGameState",
      args: [gameId],
    })),
    query: { enabled: gameIds.length > 0 },
  });

  // Combine game IDs with their states
  useEffect(() => {
    if (gameStates && gameIds.length > 0) {
      const combined = gameIds.map((gameId, index) => {
        const result = gameStates[index];
        if (result.status === "success" && result.result) {
          const data = result.result as unknown as [string, bigint, bigint, bigint, bigint, bigint, number, bigint, bigint];
          return {
            gameId,
            player: data[0],
            currentBands: data[1],
            currentMultiplier: data[2],
            potentialScore: data[3],
            score: data[4],
            season: data[5],
            state: data[6],
            threshold: data[7],
            createdAt: data[8],
          };
        }
        return null;
      }).filter((g): g is GameData => g !== null);

      // Sort by gameId descending (newest first)
      combined.sort((a, b) => Number(b.gameId - a.gameId));
      setGames(combined);
    }
  }, [gameStates, gameIds]);

  const isLoading = isLoadingIds || isLoadingStates;

  const getStateLabel = (state: number): { text: string; color: string } => {
    switch (state) {
      case GameState.REQUESTING_VRF:
        return { text: "Pending", color: "text-yellow-600 bg-yellow-50" };
      case GameState.ACTIVE:
        return { text: "Active", color: "text-blue-600 bg-blue-50" };
      case GameState.SCORED:
        return { text: "Scored", color: "text-green-600 bg-green-50" };
      case GameState.EXPLODED:
        return { text: "Exploded", color: "text-red-600 bg-red-50" };
      case GameState.CANCELLED:
        return { text: "Cancelled", color: "text-gray-600 bg-gray-50" };
      default:
        return { text: "Unknown", color: "text-gray-600 bg-gray-50" };
    }
  };

  const formatDate = (timestamp: bigint): string => {
    const date = new Date(Number(timestamp) * 1000);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  if (!isConnected) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
        <p className="text-gray-500 mb-4">Connect your wallet to view game history</p>
        <Link href="/" className="text-blue-600 hover:underline">
          Back to Game
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Game History</h2>
          <span className="text-sm text-gray-500">
            {Number(totalGames)} game{Number(totalGames) !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Games List */}
      {isLoading ? (
        <div className="p-8 text-center text-gray-500">Loading...</div>
      ) : games.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No games yet. <Link href="/" className="text-blue-600 hover:underline">Play your first game!</Link>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {games.map((game) => {
            const stateInfo = getStateLabel(game.state);
            const isFinished = game.state === GameState.SCORED || game.state === GameState.EXPLODED;

            return (
              <div key={game.gameId.toString()} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      Game #{game.gameId.toString()}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stateInfo.color}`}>
                      {stateInfo.text}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {formatDate(game.createdAt)}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Bands</span>
                    <p className="font-medium">{game.currentBands.toString()}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Multiplier</span>
                    <p className="font-medium">{formatMultiplier(game.currentMultiplier)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Score</span>
                    <p className={`font-medium ${game.state === GameState.EXPLODED ? "text-red-600" : ""}`}>
                      {game.state === GameState.EXPLODED ? "0" : game.score.toString()}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Threshold</span>
                    <p className="font-medium">
                      {isFinished ? game.threshold.toString() : "???"}
                    </p>
                  </div>
                </div>

                <div className="mt-2 text-xs text-gray-400">
                  Season {game.season.toString()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-4 border-t border-gray-100 flex justify-between items-center">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 text-sm border border-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 text-sm border border-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

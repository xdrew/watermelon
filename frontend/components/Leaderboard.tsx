"use client";

import { useReadContract } from "wagmi";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contract";

type LeaderboardEntry = {
  player: string;
  score: bigint;
  gameId: bigint;
};

export function Leaderboard() {
  // Get current season
  const { data: seasonInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getSeasonInfo",
  });

  const season = seasonInfo ? seasonInfo[0] : BigInt(1);
  const seasonNumber = Number(season);

  // Fetch on-chain leaderboard directly
  const { data: leaderboard, isLoading } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getLeaderboard",
    args: [season],
    query: {
      enabled: !!season,
      refetchInterval: 30000, // Refresh every 30 seconds
    },
  });

  const entries: LeaderboardEntry[] = (leaderboard as LeaderboardEntry[] | undefined) || [];

  // Filter out empty entries (address(0))
  const validEntries = entries.filter(
    (entry) => entry.player !== "0x0000000000000000000000000000000000000000" && entry.score > 0n
  );

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-medium mb-4">Season {seasonNumber} Leaderboard</h3>
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (validEntries.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-medium mb-4">Season {seasonNumber} Leaderboard</h3>
        <p className="text-gray-400 text-sm text-center py-4">No scores yet</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <h3 className="font-medium mb-4">Season {seasonNumber} Leaderboard</h3>
      <div className="space-y-2">
        {validEntries.map((entry, index) => (
          <div
            key={`${entry.player}-${index}`}
            className={`flex items-center justify-between py-2 px-3 rounded-lg ${
              index === 0 ? "bg-yellow-50" : index < 3 ? "bg-gray-50" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-6 text-center font-medium ${
                index === 0 ? "text-yellow-600" : index < 3 ? "text-gray-600" : "text-gray-400"
              }`}>
                {index + 1}
              </span>
              <span className="font-mono text-sm">
                {entry.player.slice(0, 6)}...{entry.player.slice(-4)}
              </span>
            </div>
            <span className="font-medium">{entry.score.toString()} pts</span>
          </div>
        ))}
      </div>
    </div>
  );
}

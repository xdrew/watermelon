"use client";

import { useState, useEffect } from "react";
import { useReadContract } from "wagmi";
import { CONTRACT_ADDRESS, CONTRACT_ABI, formatTimeLeft } from "@/lib/contract";

type LeaderboardEntry = {
  player: string;
  score: bigint;
  gameId: bigint;
};

interface LeaderboardProps {
  refreshTrigger?: number;
}

export function Leaderboard({ refreshTrigger }: LeaderboardProps) {
  const [timeLeft, setTimeLeft] = useState("");

  // Get current season
  const { data: seasonInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getSeasonInfo",
  });

  const season = seasonInfo ? seasonInfo[0] : BigInt(1);
  const seasonNumber = Number(season);
  const endTime = seasonInfo ? Number(seasonInfo[3]) : 0;

  // Update countdown
  useEffect(() => {
    if (!endTime) return;

    const updateCountdown = () => {
      setTimeLeft(formatTimeLeft(endTime));
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000);

    return () => clearInterval(interval);
  }, [endTime]);

  // Fetch on-chain leaderboard directly
  const { data: leaderboard, isLoading, refetch: refetchLeaderboard } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getLeaderboard",
    args: [season],
    query: {
      enabled: !!season,
      refetchInterval: 60000, // Refresh every 60s to avoid rate limits
      staleTime: 30000, // Consider data fresh for 30s
    },
  });

  // Refetch when trigger changes (e.g., after game ends)
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      refetchLeaderboard();
    }
  }, [refreshTrigger, refetchLeaderboard]);

  const entries: LeaderboardEntry[] = (leaderboard as LeaderboardEntry[] | undefined) || [];

  // Filter out empty entries (address(0))
  const validEntries = entries.filter(
    (entry) => entry.player !== "0x0000000000000000000000000000000000000000" && entry.score > 0n
  );

  const title = (
    <div className="flex justify-between items-center mb-2">
      <h3 className="text-sm font-medium">Season {seasonNumber}</h3>
      {timeLeft && <span className="text-xs text-gray-400">{timeLeft}</span>}
    </div>
  );

  if (isLoading) {
    return (
      <div>
        {title}
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (validEntries.length === 0) {
    return (
      <div>
        {title}
        <p className="text-gray-400 text-xs">No scores yet</p>
      </div>
    );
  }

  return (
    <div>
      {title}
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

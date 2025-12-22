"use client";

import { useState, useEffect, useMemo } from "react";
import { useReadContract } from "wagmi";
import { formatEther } from "viem";
import { CONTRACT_ADDRESS, CONTRACT_ABI, formatTimeLeft } from "@/lib/contract";

type LeaderboardEntry = {
  player: string;
  score: bigint;
  gameId: bigint;
};

interface LeaderboardProps {
  refreshTrigger?: number;
  userAddress?: string;
}

// Prize distribution: 1st 40%, 2nd 25%, 3rd 15%, 4th 8%, 5th 5%, 6th-10th 1.4% each
// Note: 1% goes to caller who triggers distribution
// If fewer than 10 winners, last winner gets remaining shares
const PRIZE_SHARES_BPS = [4000, 2500, 1500, 800, 500, 140, 140, 140, 140, 140];
const CALLER_REWARD_BPS = 100; // 1%
const BASIS_POINTS = 10000;

// Calculate payouts based on actual number of winners (last winner gets remainder)
function calculatePayouts(prizePool: bigint, winnersCount: number): bigint[] {
  if (prizePool === BigInt(0) || winnersCount === 0) return [];

  // Deduct 1% caller reward first
  const distributablePool = (prizePool * BigInt(BASIS_POINTS - CALLER_REWARD_BPS)) / BigInt(BASIS_POINTS);

  const payouts: bigint[] = [];
  let usedShares = 0;

  for (let i = 0; i < winnersCount && i < 10; i++) {
    let share: number;
    if (i === winnersCount - 1 && winnersCount < 10) {
      // Last winner gets remaining shares
      share = BASIS_POINTS - usedShares;
    } else {
      share = PRIZE_SHARES_BPS[i];
    }
    usedShares += PRIZE_SHARES_BPS[i];
    payouts.push((distributablePool * BigInt(share)) / BigInt(BASIS_POINTS));
  }

  return payouts;
}

export function Leaderboard({ refreshTrigger, userAddress }: LeaderboardProps) {
  const [timeLeft, setTimeLeft] = useState("");

  // Get current season
  const { data: seasonInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getSeasonInfo",
  });

  const season = seasonInfo ? seasonInfo[0] : BigInt(1);
  const seasonNumber = Number(season);
  const prizePool = seasonInfo ? seasonInfo[1] : BigInt(0);
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

  // Calculate payouts based on actual number of winners
  const payouts = useMemo(
    () => calculatePayouts(prizePool, validEntries.length),
    [prizePool, validEntries.length]
  );

  // Format payout amount (e.g., "0.5 MON" or "1.23 MON")
  const formatPayout = (amount: bigint) => {
    const eth = formatEther(amount);
    const num = parseFloat(eth);
    if (num === 0) return "";
    if (num < 0.01) return "<0.01";
    return num.toFixed(num < 1 ? 2 : 1);
  };

  const title = (
    <div className="mb-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium">Season {seasonNumber}</h3>
        {timeLeft && <span className="text-xs text-gray-400">{timeLeft}</span>}
      </div>
      {prizePool > BigInt(0) && (
        <div className="text-xs text-gray-500 mt-1">
          Prize Pool: <span className="font-medium text-green-600">{parseFloat(formatEther(prizePool)).toFixed(2)} MON</span>
        </div>
      )}
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

  // Find user's position (if on leaderboard)
  const userRank = userAddress
    ? validEntries.findIndex(
        (entry) => entry.player.toLowerCase() === userAddress.toLowerCase()
      ) + 1
    : 0;
  const userEntry = userRank > 0 ? validEntries[userRank - 1] : null;
  const userPayout = userRank > 0 ? payouts[userRank - 1] : null;

  if (validEntries.length === 0) {
    return (
      <div>
        {title}
        <p className="text-gray-400 text-xs">No scores yet. Be the first!</p>
      </div>
    );
  }

  return (
    <div>
      {title}
      <div className="space-y-3">
        {/* Competition stats (hidden scores) */}
        <div className="text-xs text-gray-500">
          <span className="font-medium">{validEntries.length}</span> player{validEntries.length !== 1 ? "s" : ""} competing
        </div>

        {/* User's position */}
        {userEntry && userRank > 0 ? (
          <div className={`p-3 rounded-lg ${
            userRank === 1 ? "bg-yellow-50 border border-yellow-200" :
            userRank <= 3 ? "bg-gray-50 border border-gray-200" :
            userRank <= 10 ? "bg-green-50 border border-green-200" :
            "bg-gray-50"
          }`}>
            <div className="flex justify-between items-center">
              <div>
                <span className={`text-lg font-bold ${
                  userRank === 1 ? "text-yellow-600" :
                  userRank <= 3 ? "text-gray-700" :
                  "text-green-600"
                }`}>
                  #{userRank}
                </span>
                <span className="text-xs text-gray-500 ml-2">
                  {userRank === 1 ? "Leading!" :
                   userRank <= 3 ? "Podium position" :
                   userRank <= 10 ? "In the prizes" :
                   "Keep playing!"}
                </span>
              </div>
              <div className="text-right">
                <div className="font-medium">{userEntry.score.toString()} pts</div>
                {userPayout && (
                  <div className="text-xs text-green-600">
                    Est. payout: {formatPayout(userPayout)} MON
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : userAddress ? (
          <div className="p-3 bg-gray-50 rounded-lg text-center">
            <p className="text-sm text-gray-500">Not on leaderboard yet</p>
            <p className="text-xs text-gray-400 mt-1">Score points to compete for prizes!</p>
          </div>
        ) : null}

        {/* Prize tiers hint (no exact scores shown) */}
        <div className="text-xs text-gray-400 space-y-1">
          <div>Top 10 win prizes:</div>
          <div className="grid grid-cols-2 gap-1 pl-2">
            <span>1st: 40%</span>
            <span>2nd: 25%</span>
            <span>3rd: 15%</span>
            <span>4th-10th: share 20%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

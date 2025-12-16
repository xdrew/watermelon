"use client";

import { useState, useEffect } from "react";
import { createPublicClient, http, parseAbiItem } from "viem";
import { useReadContract } from "wagmi";
import { CONTRACT_ADDRESS, CONTRACT_ABI, MONAD_TESTNET } from "@/lib/contract";

type LeaderboardEntry = {
  address: string;
  score: bigint;
  gameId: bigint;
};

const client = createPublicClient({
  chain: {
    id: MONAD_TESTNET.id,
    name: MONAD_TESTNET.name,
    nativeCurrency: MONAD_TESTNET.nativeCurrency,
    rpcUrls: MONAD_TESTNET.rpcUrls,
  },
  transport: http(),
});

const BLOCK_RANGE = 99n;
const BLOCKS_TO_SCAN = 10000n; // ~2-3 hours on Monad testnet
const PARALLEL_REQUESTS = 10;

export function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const { data: seasonInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getSeasonInfo",
  });

  const season = seasonInfo ? Number(seasonInfo[0]) : 1;

  useEffect(() => {
    async function fetchLeaderboard() {
      setLoading(true);
      try {
        const currentBlock = await client.getBlockNumber();
        const startBlock = currentBlock > BLOCKS_TO_SCAN ? currentBlock - BLOCKS_TO_SCAN : 0n;

        // Build batch ranges
        const ranges: { from: bigint; to: bigint }[] = [];
        for (let from = startBlock; from <= currentBlock; from += BLOCK_RANGE + 1n) {
          const to = from + BLOCK_RANGE > currentBlock ? currentBlock : from + BLOCK_RANGE;
          ranges.push({ from, to });
        }

        // Fetch in parallel batches
        const playerScores = new Map<string, LeaderboardEntry>();

        for (let i = 0; i < ranges.length; i += PARALLEL_REQUESTS) {
          const batch = ranges.slice(i, i + PARALLEL_REQUESTS);
          const results = await Promise.allSettled(
            batch.map(({ from, to }) =>
              client.getLogs({
                address: CONTRACT_ADDRESS,
                event: parseAbiItem(
                  "event NewHighScore(uint256 indexed season, address indexed player, uint256 score, uint256 gameId)"
                ),
                args: { season: BigInt(season) },
                fromBlock: from,
                toBlock: to,
              })
            )
          );

          for (const result of results) {
            if (result.status === "fulfilled") {
              for (const log of result.value) {
                const player = log.args.player as string;
                const score = log.args.score as bigint;
                const gameId = log.args.gameId as bigint;

                const existing = playerScores.get(player.toLowerCase());
                if (!existing || score > existing.score) {
                  playerScores.set(player.toLowerCase(), { address: player, score, gameId });
                }
              }
            }
          }
        }

        const sorted = Array.from(playerScores.values())
          .sort((a, b) => (b.score > a.score ? 1 : -1))
          .slice(0, 10);

        setEntries(sorted);
      } catch (err) {
        console.error("Failed to fetch leaderboard:", err);
      } finally {
        setLoading(false);
      }
    }

    if (season) {
      fetchLeaderboard();
    }
  }, [season]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-medium mb-4">Season {season} Leaderboard</h3>
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-medium mb-4">Season {season} Leaderboard</h3>
        <p className="text-gray-400 text-sm text-center py-4">No scores yet</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <h3 className="font-medium mb-4">Season {season} Leaderboard</h3>
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div
            key={entry.address}
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
                {entry.address.slice(0, 6)}...{entry.address.slice(-4)}
              </span>
            </div>
            <span className="font-medium">{entry.score.toString()} pts</span>
          </div>
        ))}
      </div>
    </div>
  );
}

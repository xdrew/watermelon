import { ethers } from "hardhat";

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const SEASON = parseInt(process.env.SEASON || "1");
const EXECUTE = process.env.EXECUTE === "true";
const MAX_WINNERS = 10;

// Prize distribution for top 10 (basis points, totals 10000)
// 1st: 25%, 2nd: 18%, 3rd: 14%, 4th: 11%, 5th: 9%, 6th: 7%, 7th: 6%, 8th: 5%, 9th: 3%, 10th: 2%
const PRIZE_SPLITS = [2500, 1800, 1400, 1100, 900, 700, 600, 500, 300, 200];

function getAdjustedSplits(numWinners: number): number[] {
  const splits = PRIZE_SPLITS.slice(0, numWinners);
  const totalBps = splits.reduce((a, b) => a + b, 0);
  // Scale up to 100% if fewer winners
  return splits.map(s => Math.floor((s * 10000) / totalBps));
}

async function main() {
  if (!CONTRACT_ADDRESS) {
    console.error("Set CONTRACT_ADDRESS environment variable");
    process.exit(1);
  }

  const contract = await ethers.getContractAt("WatermelonSnapSolo", CONTRACT_ADDRESS);

  console.log(`\n=== Season ${SEASON} Prize Distribution ===\n`);

  // Check season info
  const [currentSeason, , , endTime, finalized] = await contract.getSeasonInfo();
  const now = Math.floor(Date.now() / 1000);

  if (SEASON === Number(currentSeason) && now < Number(endTime)) {
    console.error(`Season ${SEASON} not over yet. Ends at ${new Date(Number(endTime) * 1000)}`);
    process.exit(1);
  }

  if (await contract.seasonFinalized(SEASON)) {
    console.error(`Season ${SEASON} already finalized`);
    process.exit(1);
  }

  // Get season prize pool
  const seasonPool = await contract.seasonPrizePool(SEASON);
  console.log(`Prize Pool: ${ethers.formatEther(seasonPool)} MON`);

  // Fetch all SoloScored events for this season
  const filter = contract.filters.SoloScored(null, SEASON);
  const events = await contract.queryFilter(filter);

  if (events.length === 0) {
    console.log("No games played this season");
    process.exit(0);
  }

  // Build leaderboard (best score per player)
  const playerScores: Map<string, { score: bigint; gameId: bigint }> = new Map();

  for (const event of events) {
    const args = event.args;
    if (!args) continue;

    const player = args.player;
    const score = args.score;
    const gameId = args.gameId;

    const existing = playerScores.get(player);
    if (!existing || score > existing.score) {
      playerScores.set(player, { score, gameId });
    }
  }

  // Sort by score descending
  const leaderboard = Array.from(playerScores.entries())
    .map(([player, data]) => ({ player, score: data.score, gameId: data.gameId }))
    .sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : 0));

  const numWinners = Math.min(leaderboard.length, MAX_WINNERS);
  const adjustedSplits = getAdjustedSplits(numWinners);

  console.log(`\nLeaderboard (${leaderboard.length} players, rewarding top ${numWinners}):`);
  console.log("─".repeat(70));

  const winners: string[] = [];
  const amounts: bigint[] = [];

  for (let i = 0; i < numWinners; i++) {
    const entry = leaderboard[i];
    const splitBps = adjustedSplits[i];
    const prize = (seasonPool * BigInt(splitBps)) / 10000n;

    winners.push(entry.player);
    amounts.push(prize);

    console.log(
      `#${(i + 1).toString().padStart(2)} | ${entry.player.slice(0, 10)}... | ` +
      `Score: ${entry.score.toString().padStart(6)} | ` +
      `Prize: ${ethers.formatEther(prize).padStart(10)} MON (${(splitBps / 100).toFixed(1).padStart(5)}%)`
    );
  }

  // Show remaining players
  if (leaderboard.length > MAX_WINNERS) {
    console.log(`... and ${leaderboard.length - MAX_WINNERS} more players (no prize)`);
  }

  const totalDistribution = amounts.reduce((a, b) => a + b, 0n);
  console.log("─".repeat(60));
  console.log(`Total Distribution: ${ethers.formatEther(totalDistribution)} MON`);
  console.log(`Remaining in Pool: ${ethers.formatEther(seasonPool - totalDistribution)} MON`);

  // Confirm before sending
  console.log("\n⚠️  Review the distribution above");

  if (EXECUTE) {
    console.log("Executing distribution...\n");

    const tx = await contract.distributePrizes(SEASON, winners, amounts);
    console.log(`Transaction: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`✓ Confirmed in block ${receipt?.blockNumber}`);
    console.log(`  Gas used: ${receipt?.gasUsed.toString()}`);
  } else {
    console.log("Dry run complete. Run 'task distribute:execute' to send transaction.\n");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

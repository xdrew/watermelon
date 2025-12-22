import { ethers } from "hardhat";

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";

async function main() {
  if (!CONTRACT_ADDRESS) {
    console.error("Set CONTRACT_ADDRESS environment variable");
    process.exit(1);
  }

  const contract = await ethers.getContractAt("WatermelonSnapSolo", CONTRACT_ADDRESS);

  const [season, pool, startTime, endTime, finalized] = await contract.getSeasonInfo();
  const now = Math.floor(Date.now() / 1000);
  const timeLeft = Number(endTime) - now;

  console.log(`\n=== Season Info ===\n`);
  console.log(`Current Season: ${season}`);
  console.log(`Prize Pool:     ${ethers.formatEther(pool)} MON`);
  console.log(`Started:        ${new Date(Number(startTime) * 1000).toLocaleString()}`);
  console.log(`Ends:           ${new Date(Number(endTime) * 1000).toLocaleString()}`);

  if (timeLeft > 0) {
    const hours = Math.floor(timeLeft / 3600);
    const mins = Math.floor((timeLeft % 3600) / 60);
    console.log(`Time Left:      ${hours}h ${mins}m`);
  } else {
    console.log(`Status:         ENDED (ready for distribution)`);
  }

  console.log(`Finalized:      ${finalized ? "Yes" : "No"}`);
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

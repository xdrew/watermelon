import { ethers } from "hardhat";

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const amount = process.env.AMOUNT || "1"; // Default 1 MON

  if (!contractAddress) {
    console.error("Error: CONTRACT_ADDRESS environment variable is required");
    console.log("\nUsage:");
    console.log("  CONTRACT_ADDRESS=0x... AMOUNT=1 npx hardhat run scripts/sponsorPool.ts --network monadTestnet");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  console.log("Sponsoring prize pool with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MON");

  const contract = await ethers.getContractAt("WatermelonSnapSolo", contractAddress);

  // Get current prize pool
  const currentPool = await contract.prizePool();
  console.log("\nCurrent prize pool:", ethers.formatEther(currentPool), "MON");

  // Sponsor
  const sponsorAmount = ethers.parseEther(amount);
  console.log(`Sponsoring ${amount} MON...`);

  const tx = await contract.sponsorPrizePool({ value: sponsorAmount });
  console.log("Transaction hash:", tx.hash);
  await tx.wait();

  // Get new balance
  const newPool = await contract.prizePool();
  console.log("\nNew prize pool:", ethers.formatEther(newPool), "MON");
  console.log("Successfully sponsored!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

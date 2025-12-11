import { ethers } from "hardhat";

// Pyth Entropy addresses for Monad Testnet
const MONAD_TESTNET_ENTROPY = "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320";
const DEFAULT_ENTROPY_PROVIDER = "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying WatermelonSnapSolo with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Get addresses from env or use defaults
  const entropyAddress = process.env.ENTROPY_ADDRESS || MONAD_TESTNET_ENTROPY;
  const entropyProvider = process.env.ENTROPY_PROVIDER || DEFAULT_ENTROPY_PROVIDER;
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;

  console.log("\nDeployment parameters:");
  console.log("- Entropy:", entropyAddress);
  console.log("- Entropy Provider:", entropyProvider);
  console.log("- Treasury:", treasury);

  const WatermelonSnapSolo = await ethers.getContractFactory("WatermelonSnapSolo");
  const contract = await WatermelonSnapSolo.deploy(entropyAddress, entropyProvider, treasury);

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log("\nWatermelonSnapSolo deployed to:", contractAddress);

  // Fund house balance with some initial liquidity
  const initialHouseFunding = process.env.INITIAL_HOUSE_FUNDING || "0";
  if (parseFloat(initialHouseFunding) > 0) {
    console.log(`\nFunding house with ${initialHouseFunding} ETH...`);
    const tx = await contract.depositToHouse({ value: ethers.parseEther(initialHouseFunding) });
    await tx.wait();
    console.log("House funded successfully");
  }

  console.log("\nDeployment complete!");
  console.log("Contract address:", contractAddress);
  console.log("\nNext steps:");
  console.log("1. Fund the house balance: contract.depositToHouse({ value: ... })");
  console.log("2. Verify contract on block explorer");
  console.log("3. Update frontend with contract address");

  return contractAddress;
}

main()
  .then((address) => {
    console.log("\nDeployed at:", address);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

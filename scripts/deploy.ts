import { ethers } from "hardhat";

// Pyth Entropy address for Monad Testnet (v2 API)
// See: https://docs.pyth.network/entropy/contract-addresses
const MONAD_TESTNET_ENTROPY = "0x825c0390f379c631f3cf11a82a37d20bddf93c07";

// Default entry fees
const TESTNET_ENTRY_FEE = "0.01";  // 0.01 MON for testnet
const MAINNET_ENTRY_FEE = "10";     // 10 MON for mainnet

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying WatermelonSnapSolo with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Get entropy address from env or use default
  const entropyAddress = process.env.ENTROPY_ADDRESS || MONAD_TESTNET_ENTROPY;

  // Get entry fee from env or use network-appropriate default
  const network = await ethers.provider.getNetwork();
  const isTestnet = network.chainId === 10143n;
  const defaultEntryFee = isTestnet ? TESTNET_ENTRY_FEE : MAINNET_ENTRY_FEE;
  const entryFee = ethers.parseEther(process.env.ENTRY_FEE || defaultEntryFee);

  console.log("\nDeployment parameters:");
  console.log("- Network:", isTestnet ? "Monad Testnet" : "Monad Mainnet");
  console.log("- Entropy:", entropyAddress);
  console.log("- Entry Fee:", ethers.formatEther(entryFee), "MON");

  const WatermelonSnapSolo = await ethers.getContractFactory("WatermelonSnapSolo");
  const contract = await WatermelonSnapSolo.deploy(entropyAddress, entryFee);

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log("\nWatermelonSnapSolo deployed to:", contractAddress);

  // Fund prize pool with some initial liquidity (optional)
  const initialFunding = process.env.INITIAL_PRIZE_POOL || "0";
  if (parseFloat(initialFunding) > 0) {
    console.log(`\nFunding prize pool with ${initialFunding} MON...`);
    const tx = await deployer.sendTransaction({
      to: contractAddress,
      value: ethers.parseEther(initialFunding),
    });
    await tx.wait();
    console.log("Prize pool funded successfully");
  }

  console.log("\nDeployment complete!");
  console.log("Contract address:", contractAddress);
  console.log("\nNext steps:");
  console.log("1. (Optional) Fund prize pool by sending MON to contract");
  console.log("2. Verify contract on block explorer");
  console.log("3. Update frontend CONTRACT_ADDRESS in lib/contract.ts");

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

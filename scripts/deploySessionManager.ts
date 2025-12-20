import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying SessionKeyManager with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Deploy SessionKeyManager
  const SessionKeyManager = await ethers.getContractFactory("SessionKeyManager");
  const sessionManager = await SessionKeyManager.deploy();

  await sessionManager.waitForDeployment();
  const sessionManagerAddress = await sessionManager.getAddress();

  console.log("\nSessionKeyManager deployed to:", sessionManagerAddress);

  // Log configuration info
  console.log("\n=== Configuration ===");
  console.log("Add to frontend/.env.local:");
  console.log(`NEXT_PUBLIC_SESSION_MANAGER_ADDRESS=${sessionManagerAddress}`);

  console.log("\n=== Contract Settings ===");
  console.log("Min session duration:", await sessionManager.MIN_SESSION_DURATION(), "seconds (5 min)");
  console.log("Max session duration:", await sessionManager.MAX_SESSION_DURATION(), "seconds (24 hours)");

  console.log("\n=== EIP-7702 Usage ===");
  console.log("1. User signs authorization delegating their EOA to SessionKeyManager");
  console.log("2. User creates session with: createSession(sessionKey, duration, target, selectors, gameId)");
  console.log("3. Session key calls: execute(userAddress, target, calldata)");
  console.log("4. After game: revokeSession() or let it expire");

  console.log("\n=== Allowed Selectors for WatermelonSnapSolo ===");
  const addBandSelector = ethers.id("addBand(uint256)").slice(0, 10);
  const cashOutSelector = ethers.id("cashOut(uint256)").slice(0, 10);
  console.log("addBand(uint256):", addBandSelector);
  console.log("cashOut(uint256):", cashOutSelector);

  return sessionManagerAddress;
}

main()
  .then((address) => {
    console.log("\n✅ Deployed at:", address);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

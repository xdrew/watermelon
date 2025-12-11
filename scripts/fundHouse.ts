import { ethers } from "hardhat";
import "dotenv/config";

const CONTRACT_ADDRESS = "0x8b644AD5051D5a3De87eEde6BF8376Da36f674AF";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Funding house with account:", deployer.address);

  const contract = await ethers.getContractAt("WatermelonSnapSolo", CONTRACT_ADDRESS);

  const fundAmount = ethers.parseEther("1");
  console.log(`Depositing ${ethers.formatEther(fundAmount)} MON to house...`);

  const tx = await contract.depositToHouse({ value: fundAmount });
  await tx.wait();

  const houseBalance = await contract.houseBalance();
  console.log(`House balance: ${ethers.formatEther(houseBalance)} MON`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

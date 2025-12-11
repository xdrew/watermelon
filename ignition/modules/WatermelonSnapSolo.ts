import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Pyth Entropy addresses for Monad Testnet
const MONAD_TESTNET_ENTROPY = "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320";
const DEFAULT_ENTROPY_PROVIDER = "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344";

const WatermelonSnapSoloModule = buildModule("WatermelonSnapSolo", (m) => {
  // Parameters with defaults for Monad testnet
  const entropy = m.getParameter("entropy", MONAD_TESTNET_ENTROPY);
  const entropyProvider = m.getParameter("entropyProvider", DEFAULT_ENTROPY_PROVIDER);
  const treasury = m.getParameter("treasury", m.getAccount(0)); // Deployer as default treasury

  const watermelonSnapSolo = m.contract("WatermelonSnapSolo", [
    entropy,
    entropyProvider,
    treasury,
  ]);

  return { watermelonSnapSolo };
});

export default WatermelonSnapSoloModule;

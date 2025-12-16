import { http, createConfig } from "wagmi";
import { MONAD_TESTNET } from "./contract";

// Define chain for wagmi
export const monadTestnet = {
  id: MONAD_TESTNET.id,
  name: MONAD_TESTNET.name,
  nativeCurrency: MONAD_TESTNET.nativeCurrency,
  rpcUrls: MONAD_TESTNET.rpcUrls,
  blockExplorers: MONAD_TESTNET.blockExplorers,
} as const;

export const config = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(),
  },
});

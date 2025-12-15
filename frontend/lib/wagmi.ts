import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { MONAD_TESTNET } from "./contract";

// Define chain for wagmi
const monadTestnet = {
  id: MONAD_TESTNET.id,
  name: MONAD_TESTNET.name,
  nativeCurrency: MONAD_TESTNET.nativeCurrency,
  rpcUrls: MONAD_TESTNET.rpcUrls,
  blockExplorers: MONAD_TESTNET.blockExplorers,
};

export const config = createConfig({
  chains: [monadTestnet],
  multiInjectedProviderDiscovery: true,
  connectors: [injected()],
  transports: {
    [monadTestnet.id]: http(),
  },
});

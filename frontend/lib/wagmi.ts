import { http } from "wagmi";
import { defineChain } from "viem";
import { createConfig } from "@privy-io/wagmi";
import { MONAD_CHAIN } from "./contract";

// Define chain for wagmi using viem's defineChain for proper typing
export const monadChain = defineChain({
  id: MONAD_CHAIN.id,
  name: MONAD_CHAIN.name,
  nativeCurrency: MONAD_CHAIN.nativeCurrency,
  rpcUrls: MONAD_CHAIN.rpcUrls,
  blockExplorers: MONAD_CHAIN.blockExplorers,
});

export const config = createConfig({
  chains: [monadChain],
  transports: {
    [monadChain.id]: http(),
  },
} as any);

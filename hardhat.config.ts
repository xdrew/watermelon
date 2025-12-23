import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    monadTestnet: {
      url: process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 10143,
    },
    monad: {
      url: process.env.MONAD_RPC || "https://rpc.monad.xyz",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 143,
    },
  },
  etherscan: {
    apiKey: {
      monadTestnet: process.env.ETHERSCAN_API_KEY || "empty",
    },
    customChains: [
      {
        network: "monadTestnet",
        chainId: 10143,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=10143",
          browserURL: "https://testnet.monadscan.com",
        },
      },
    ],
  },
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify-api-monad.blockvision.org",
    browserUrl: "https://testnet.monadvision.com",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;

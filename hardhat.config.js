require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
const { loadEnvConfig } = require("@next/env");

// Same .env / .env.local files that Next.js reads.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const FUJI_RPC_URL = process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
const rawKey = (process.env.PRIVATE_KEY || "").trim();
const accounts = rawKey ? [rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`] : [];

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Avalanche C-Chain supports Cancun opcodes since the Etna upgrade (OpenZeppelin 5.x uses mcopy).
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      // Set HARDHAT_CHAIN_ID=43113 to rehearse the Fuji frontend against a local node.
      chainId: Number(process.env.HARDHAT_CHAIN_ID || 31337),
    },
    fuji: {
      url: FUJI_RPC_URL,
      chainId: 43113,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      avalancheFujiTestnet: process.env.SNOWTRACE_API_KEY || "snowtrace",
    },
    customChains: [
      {
        network: "avalancheFujiTestnet",
        chainId: 43113,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan",
          browserURL: "https://testnet.snowtrace.io",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

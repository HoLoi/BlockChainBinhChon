import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

const cronosTestnetRpc = process.env.CRONOS_TESTNET_RPC_URL ?? "https://evm-t3.cronos.org";
const cronosTestnetPrivateKey = process.env.CRONOS_TESTNET_PRIVATE_KEY;

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    cronosTestnet: {
      type: "http",
      chainType: "l1",
      url: cronosTestnetRpc,
      accounts: cronosTestnetPrivateKey ? [cronosTestnetPrivateKey] : [],
    },
  },
});

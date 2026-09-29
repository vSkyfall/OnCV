/**
 * Local demo chain: a Hardhat node that reports Avalanche Fuji's chain id (43113), so the dApp, wallets and
 * EIP-712 signatures behave exactly as on Fuji. Keep this terminal open, then run `npm run demo:setup`.
 *
 *   npm run demo:node
 */
const { spawn } = require("child_process");

const child = spawn("npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", "8545"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, HARDHAT_CHAIN_ID: "43113" },
});
child.on("exit", (code) => process.exit(code ?? 0));

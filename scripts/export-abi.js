/**
 * Regenerates config/abi.ts after changing the contract (no deployment).
 *
 *   npm run contracts:abi
 */
const hre = require("hardhat");
const { writeAbi } = require("./utils/frontend");

async function main() {
  await hre.run("compile");
  const target = await writeAbi(hre);
  console.log(`ABI written to ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Verifies (or un-verifies) an organizer wallet with its registered organization profile.
 * Must be run with an admin key (PRIVATE_KEY).
 *
 *   PowerShell:  $env:ORGANIZER="0xabc..."; $env:ORG_NAME="Blockchain ITU"; $env:ORG_DOMAIN="blockchainitu.com"; npm run organizer:add
 *   bash:        ORGANIZER=0xabc... ORG_NAME="Blockchain ITU" ORG_DOMAIN=blockchainitu.com npm run organizer:add
 *
 * Set REVOKE=true to call removeOrganizer instead.
 */
const hre = require("hardhat");
const deployment = require("../config/deployment.json");

async function main() {
  const { ethers } = hre;
  const contractAddress = process.env.NEXT_PUBLIC_PROOFSKILL_ADDRESS || deployment.address;
  const organizer = (process.env.ORGANIZER || "").trim();
  const name = (process.env.ORG_NAME || "").trim();
  const domain = (process.env.ORG_DOMAIN || "").trim();
  const revoke = process.env.REVOKE === "true";

  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    throw new Error("No contract address. Deploy first (npm run deploy:fuji) or set NEXT_PUBLIC_PROOFSKILL_ADDRESS.");
  }
  if (!ethers.isAddress(organizer)) {
    throw new Error("Set ORGANIZER to the wallet address that should be verified.");
  }
  if (!revoke && !name) {
    throw new Error("Set ORG_NAME to the organization's registered display name.");
  }

  const contract = await ethers.getContractAt("ProofSkill", contractAddress);
  const tx = revoke ? await contract.removeOrganizer(organizer) : await contract.addOrganizer(organizer, name, domain);
  console.log(`Tx sent: ${tx.hash}`);
  await tx.wait();
  console.log(
    revoke
      ? `${organizer} is no longer a verified organizer on ${contractAddress}`
      : `${organizer} is now verified as "${name}"${domain ? ` (${domain})` : ""} on ${contractAddress}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

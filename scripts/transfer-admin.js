/**
 * Two-step admin handover (AccessControlDefaultAdminRules), e.g. from the deployer key to a Safe multisig.
 *
 *   Step 1 (current admin):  $env:NEW_ADMIN="0xSafe..."; npm run admin:transfer
 *   Step 2 (after the delay, new admin):  $env:ACCEPT="true"; npm run admin:transfer
 *   Cancel (current admin):  $env:CANCEL="true"; npm run admin:transfer
 *
 * The ProjectRegistry reads the admin from ProofSkill, so one handover covers every contract.
 * Accepting from a Safe: submit acceptDefaultAdminTransfer() on ProofSkill through the Safe UI instead.
 */
const hre = require("hardhat");
const deployment = require("../config/deployment.json");

async function main() {
  const { ethers } = hre;
  const contractAddress = process.env.NEXT_PUBLIC_PROOFSKILL_ADDRESS || deployment.address;
  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    throw new Error("No contract address. Deploy first (npm run deploy:fuji) or set NEXT_PUBLIC_PROOFSKILL_ADDRESS.");
  }
  const contract = await ethers.getContractAt("ProofSkill", contractAddress);
  const [signer] = await ethers.getSigners();

  if (process.env.CANCEL === "true") {
    await (await contract.cancelDefaultAdminTransfer()).wait();
    console.log("Pending admin transfer cancelled.");
    return;
  }

  if (process.env.ACCEPT === "true") {
    const [pending, schedule] = await contract.pendingDefaultAdmin();
    if (pending.toLowerCase() !== signer.address.toLowerCase()) {
      throw new Error(`The pending admin is ${pending}, not ${signer.address}.`);
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (schedule > now) {
      throw new Error(`Transfer can be accepted after ${new Date(Number(schedule) * 1000).toISOString()}.`);
    }
    await (await contract.acceptDefaultAdminTransfer()).wait();
    console.log(`${signer.address} is now the onCV admin.`);
    return;
  }

  const newAdmin = (process.env.NEW_ADMIN || "").trim();
  if (!ethers.isAddress(newAdmin)) throw new Error("Set NEW_ADMIN to the new admin address (e.g. a Safe).");
  await (await contract.beginDefaultAdminTransfer(newAdmin)).wait();
  const [, schedule] = await contract.pendingDefaultAdmin();
  console.log(`Transfer to ${newAdmin} started. It can be accepted after ${new Date(Number(schedule) * 1000).toISOString()}.`);
  console.log("Note: the new admin is not a verified organizer automatically; add it with npm run organizer:add if needed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

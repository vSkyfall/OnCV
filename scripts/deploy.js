/**
 * Deploys the onCV contracts to Avalanche Fuji and wires the frontend to them.
 *
 *   npm run deploy:fuji
 *   (= npx hardhat run scripts/deploy.js --network fuji)
 *
 * Required env (.env or .env.local):  PRIVATE_KEY
 * Optional env:
 *   FUJI_RPC_URL
 *   ADMIN_ORG_NAME / ADMIN_ORG_DOMAIN     Profile of the deployer (default "onCV" / "oncv.xyz")
 *   ADMIN_TRANSFER_DELAY_SECONDS          Delay of the two-step admin transfer (default 1 day; see
 *                                         scripts/transfer-admin.js to hand the admin role to a Safe)
 *   ORGANIZER_ADDRESSES=0xabc...,0xdef... Extra organizers verified at deploy (named "Pilot Organizer")
 *   CHECKPOINT_INTERVAL_SECONDS           Project tracking checkpoint spacing (default 90 days; use e.g.
 *                                         120 for a live demo of the 3rd / 6th month checkpoints)
 *
 * Wiring is one-time and irreversible: after this script the admin cannot redirect minting or points.
 *
 * Contracts:
 *   ProofSkill       attendance registry, verified organizers, gasless check-in, revocation
 *   ProjectRegistry  post-event project tracking (3rd / 6th month checkpoints, attestations)
 *   OnCVCredential   soulbound ERC-1155 credentials with on-chain dynamic metadata
 */
const hre = require("hardhat");
const { writeAbi, writeDeployment } = require("./utils/frontend");

const FUJI_CHAIN_ID = 43113n;
const FAUCET_URL = "https://core.app/tools/testnet-faucet/?subnet=c&token=c";
const EXPLORER_URL = "https://testnet.snowtrace.io";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { ethers, network } = hre;
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No deployer account. Set PRIVATE_KEY in .env (see .env.example).");
  }
  const deployer = signers[0];
  const { chainId } = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);
  const isLive = chainId === FUJI_CHAIN_ID && network.name !== "hardhat" && network.name !== "localhost";
  const confirmations = isLive ? 2 : 1;

  console.log("\n  onCV deployment");
  console.log("  ---------------");
  console.log(`  Network   : ${network.name} (chainId ${chainId})`);
  console.log(`  Deployer  : ${deployer.address}`);
  console.log(`  Balance   : ${ethers.formatEther(balance)} AVAX`);

  if (balance === 0n) {
    throw new Error(`Deployer has no AVAX on ${network.name}. Get test AVAX: ${FAUCET_URL}`);
  }

  const orgName = process.env.ADMIN_ORG_NAME || "onCV";
  const orgDomain = process.env.ADMIN_ORG_DOMAIN || "oncv.xyz";
  const checkpointInterval = BigInt(process.env.CHECKPOINT_INTERVAL_SECONDS || String(90 * 24 * 3600));
  const adminDelay = BigInt(process.env.ADMIN_TRANSFER_DELAY_SECONDS || String(24 * 3600));
  const proofSkillArgs = [deployer.address, adminDelay, orgName, orgDomain];

  // 1. ProofSkill
  const proofSkill = await (await ethers.getContractFactory("ProofSkill")).deploy(...proofSkillArgs);
  const deployTx = proofSkill.deploymentTransaction();
  const receipt = await deployTx.wait(confirmations);
  const address = await proofSkill.getAddress();
  console.log(`  Registry  : ${address} (block ${receipt.blockNumber})`);

  // 2. ProjectRegistry
  const registry = await (await ethers.getContractFactory("ProjectRegistry")).deploy(address, checkpointInterval);
  await registry.deploymentTransaction().wait(confirmations);
  const registryAddress = await registry.getAddress();
  console.log(`  Projects  : ${registryAddress} (checkpoint every ${checkpointInterval}s)`);

  // 3. OnCVCredential
  const credential = await (await ethers.getContractFactory("OnCVCredential")).deploy(address);
  await credential.deploymentTransaction().wait(confirmations);
  const credentialAddress = await credential.getAddress();
  console.log(`  Tokens    : ${credentialAddress}`);

  // 4. One-time wiring
  const steps = [
    ["ProofSkill -> Token + ProjectRegistry", () => proofSkill.wireSatellites(credentialAddress, registryAddress)],
    ["Token -> ProjectRegistry", () => credential.setProjectRegistry(registryAddress)],
    ["ProjectRegistry -> Token", () => registry.setCredentialToken(credentialAddress)],
  ];
  for (const [label, send] of steps) {
    await (await send()).wait(confirmations);
    console.log(`  Wired     : ${label}`);
  }

  const organizers = (process.env.ORGANIZER_ADDRESSES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const organizer of organizers) {
    if (!ethers.isAddress(organizer)) {
      console.warn(`  ! Skipping invalid organizer address: ${organizer}`);
      continue;
    }
    await (await proofSkill.addOrganizer(organizer, "Pilot Organizer", "")).wait(confirmations);
    console.log(`  Organizer : ${organizer} verified (rename it from the admin panel)`);
  }

  const abiPath = await writeAbi(hre);
  console.log(`  ABI       : ${abiPath}`);

  if (chainId === FUJI_CHAIN_ID) {
    const deploymentPath = writeDeployment({
      chainId: Number(chainId),
      address,
      projectRegistry: registryAddress,
      credential: credentialAddress,
      checkpointInterval: Number(checkpointInterval),
      blockNumber: receipt.blockNumber,
      txHash: deployTx.hash,
      deployer: deployer.address,
      deployedAt: new Date().toISOString(),
    });
    console.log(`  Frontend  : ${deploymentPath}`);
  } else {
    console.log(`  Frontend  : not updated (the dApp targets chainId ${FUJI_CHAIN_ID})`);
  }

  if (isLive) {
    console.log(`\n  SnowTrace : ${EXPLORER_URL}/address/${address}`);
    console.log("  Verifying source on SnowTrace (Routescan)...");
    await sleep(15_000);
    const targets = [
      { address, constructorArguments: proofSkillArgs.map(String) },
      { address: registryAddress, constructorArguments: [address, checkpointInterval.toString()] },
      { address: credentialAddress, constructorArguments: [address] },
    ];
    for (const target of targets) {
      try {
        await hre.run("verify:verify", target);
        console.log(`  Verified ${target.address}.`);
      } catch (error) {
        const message = String(error && error.message ? error.message : error);
        if (/already verified/i.test(message)) {
          console.log(`  Already verified ${target.address}.`);
        } else {
          console.warn(`  Verification skipped: ${message.split("\n")[0]}`);
        }
      }
    }
  }

  console.log("\n  Done. Restart `npm run dev` so Next.js picks up config/deployment.json.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

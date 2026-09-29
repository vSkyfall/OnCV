const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { encodePacked, keccak256 } = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");

const ROTATION = 10n;
const ADMIN_DELAY = 3600n;
const Category = { Workshop: 0, Hackathon: 1, Conference: 2, Meetup: 3, Bootcamp: 4 };

// Mirrors lib/checkin-code.ts so the frontend signing scheme is covered by these tests.
function messageHash(chainId, contractAddress, eventId, codeWindow) {
  return keccak256(
    encodePacked(
      ["string", "uint256", "address", "uint256", "uint256"],
      ["ProofSkill:check-in", BigInt(chainId), contractAddress, BigInt(eventId), BigInt(codeWindow)],
    ),
  );
}

async function signCode(account, chainId, contractAddress, eventId, codeWindow) {
  return account.signMessage({ message: { raw: messageHash(chainId, contractAddress, eventId, codeWindow) } });
}

async function currentWindow() {
  return BigInt(await time.latest()) / ROTATION;
}

// ethers v6 Contract has a built-in getEvent() helper that shadows the Solidity function.
function getEventById(contract, id) {
  return contract.getFunction("getEvent")(id);
}

/** EventInput struct (organizer name comes from the on-chain profile). */
function eventInput(overrides = {}) {
  return {
    name: "Event",
    location: "Istanbul",
    startTime: 0,
    durationHours: 4,
    lat: 0,
    long: 0,
    category: 0,
    skillTags: "",
    checkInSigner: ethers.ZeroAddress,
    maxAttendees: 0,
    isOnline: false,
    ...overrides,
  };
}

function eip712Domain(ctx) {
  return { name: "onCV", version: "1", chainId: ctx.chainId, verifyingContract: ctx.address };
}

const CHECKIN_TYPES = {
  CheckIn: [
    { name: "attendee", type: "address" },
    { name: "eventId", type: "uint256" },
    { name: "codeWindow", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
const KIOSK_CONSENT_TYPES = {
  KioskConsent: [
    { name: "attendee", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
};
const KIOSK_ATTEST_TYPES = {
  KioskAttest: [
    { name: "eventId", type: "uint256" },
    { name: "attendee", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
};

/** Deploys ProofSkill + ProjectRegistry + OnCVCredential exactly like scripts/deploy.js (one-time wiring). */
async function deploySystem({ interval = 90n * 24n * 3600n } = {}) {
  const signers = await ethers.getSigners();
  const [admin] = signers;
  const proofSkill = await (await ethers.getContractFactory("ProofSkill")).deploy(admin.address, ADMIN_DELAY, "onCV", "oncv.xyz");
  const address = await proofSkill.getAddress();
  const registry = await (await ethers.getContractFactory("ProjectRegistry")).deploy(address, interval);
  const registryAddress = await registry.getAddress();
  const token = await (await ethers.getContractFactory("OnCVCredential")).deploy(address);
  const tokenAddress = await token.getAddress();

  await proofSkill.wireSatellites(tokenAddress, registryAddress);
  await token.setProjectRegistry(registryAddress);
  await registry.setCredentialToken(tokenAddress);

  const { chainId } = await ethers.provider.getNetwork();
  const qrSigner = privateKeyToAccount(generatePrivateKey());
  return { signers, proofSkill, address, registry, registryAddress, token, tokenAddress, chainId, qrSigner };
}

/** Self-scan check-in with a fresh code signed by `qr`. */
async function checkIn(ctx, signer, eventId, qr = ctx.qrSigner) {
  const codeWindow = await currentWindow();
  const signature = await signCode(qr, ctx.chainId, ctx.address, eventId, codeWindow);
  return ctx.proofSkill.connect(signer).checkIn(eventId, codeWindow, signature);
}

function newAccount() {
  return privateKeyToAccount(generatePrivateKey());
}

module.exports = {
  ROTATION,
  ADMIN_DELAY,
  Category,
  messageHash,
  signCode,
  currentWindow,
  getEventById,
  eventInput,
  eip712Domain,
  CHECKIN_TYPES,
  KIOSK_CONSENT_TYPES,
  KIOSK_ATTEST_TYPES,
  deploySystem,
  checkIn,
  newAccount,
};

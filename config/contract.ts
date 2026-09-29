import { isAddress, type Address, type ContractFunctionReturnType, type Hash } from "viem";
import { credentialAbi, projectRegistryAbi, proofSkillAbi } from "./abi";
import { BRAND } from "./brand";
import deploymentJson from "./deployment.json";
import { fuji } from "./chain";

type Deployment = {
  chainId: number;
  address: string | null;
  projectRegistry?: string | null;
  credential?: string | null;
  checkpointInterval?: number | null;
  blockNumber: number | null;
  txHash: string | null;
  deployer: string | null;
  deployedAt: string | null;
};

const deployment = deploymentJson as Deployment;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function resolveAddress(envValue: string | undefined, fallback: string | null | undefined): Address | undefined {
  const candidate = envValue?.trim() || fallback || "";
  return isAddress(candidate, { strict: false }) ? (candidate as Address) : undefined;
}

/** Resolved from NEXT_PUBLIC_* env vars, falling back to config/deployment.json (written by deploy.js). */
export const PROOFSKILL_ADDRESS = resolveAddress(process.env.NEXT_PUBLIC_PROOFSKILL_ADDRESS, deployment.address);
export const PROJECT_REGISTRY_ADDRESS = resolveAddress(
  process.env.NEXT_PUBLIC_PROJECT_REGISTRY_ADDRESS,
  deployment.projectRegistry,
);
export const CREDENTIAL_ADDRESS = resolveAddress(process.env.NEXT_PUBLIC_CREDENTIAL_ADDRESS, deployment.credential);

export const isContractConfigured = PROOFSKILL_ADDRESS !== undefined;
export const isRegistryConfigured = PROJECT_REGISTRY_ADDRESS !== undefined;
export const isCredentialConfigured = CREDENTIAL_ADDRESS !== undefined;

/** Gasless check-in through the /api/relay/check-in relayer (requires RELAYER_PRIVATE_KEY on the server). */
export const GASLESS_CHECKIN = process.env.NEXT_PUBLIC_GASLESS_CHECKIN === "true";

export const proofSkill = {
  address: PROOFSKILL_ADDRESS ?? ZERO,
  abi: proofSkillAbi,
  chainId: fuji.id,
} as const;

export const projectRegistry = {
  address: PROJECT_REGISTRY_ADDRESS ?? ZERO,
  abi: projectRegistryAbi,
  chainId: fuji.id,
} as const;

export const credentialToken = {
  address: CREDENTIAL_ADDRESS ?? ZERO,
  abi: credentialAbi,
  chainId: fuji.id,
} as const;

export type ProofEvent = ContractFunctionReturnType<typeof proofSkillAbi, "view", "getEvent">;
export type AttendanceRecord = ContractFunctionReturnType<
  typeof proofSkillAbi,
  "view",
  "getUserCredentials"
>[1][number];
export type Project = ContractFunctionReturnType<typeof projectRegistryAbi, "view", "getProject">;
export type ProjectUpdate = ContractFunctionReturnType<typeof projectRegistryAbi, "view", "getUpdates">[number];

// Mirrors of the on-chain constants in contracts/*.sol.
export const POINTS_PER_CHECKIN = 25;
export const QR_ROTATION_SECONDS = 10;
export const QR_CODE_TTL_SECONDS = 120;
export const CHECKIN_OPENS_BEFORE_SECONDS = 3600;
export const REGISTRATION_WINDOW_SECONDS = 7 * 24 * 3600;
export const COORDINATE_SCALE = 1_000_000;
export const MAX_TEAM_SIZE = 5;
export const PROJECT_ID_OFFSET = 1n << 128n;
export const CREDENTIAL_PAGE_SIZE = 100n;

/** EIP-712 domain of ProofSkill.checkInWithSig. */
export const CHECKIN_TYPES = {
  CheckIn: [
    { name: "attendee", type: "address" },
    { name: "eventId", type: "uint256" },
    { name: "codeWindow", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const checkInDomain = () =>
  ({ name: "onCV", version: "1", chainId: fuji.id, verifyingContract: proofSkill.address }) as const;

/** Kiosk mode: the attendee's consent (personal QR) and the event QR key's attestation of the scan. */
export const KIOSK_CONSENT_TYPES = {
  KioskConsent: [
    { name: "attendee", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const KIOSK_ATTEST_TYPES = {
  KioskAttest: [
    { name: "eventId", type: "uint256" },
    { name: "attendee", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Validity of a personal kiosk QR. The contract caps it at 15 minutes (MAX_KIOSK_VALIDITY) measured from
 * the block time; 5 minutes leaves room for device clock drift and for a quiet chain whose latest block
 * (used by pre-flight simulations) is several minutes old.
 */
export const KIOSK_PASS_SECONDS = 300;

/** Geofence radius enforced by the dApp before a check-in transaction is sent. */
export const GEOFENCE_RADIUS_KM = 1;

export const EXPLORER_URL = "https://testnet.snowtrace.io";
export const FAUCET_URL = "https://core.app/tools/testnet-faucet/?subnet=c&token=c";

export const explorerTxUrl = (hash: Hash) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddressUrl = (address: Address) => `${EXPLORER_URL}/address/${address}`;
export const explorerTokenUrl = (tokenId: bigint) =>
  `${EXPLORER_URL}/token/${CREDENTIAL_ADDRESS ?? ZERO}/instance/${tokenId.toString()}`;

/** Public base URL used in QR codes and share links. Falls back to the current origin. */
export function getAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return BRAND.url;
}

import { encodePacked, isAddress, isHex, keccak256, recoverMessageAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KIOSK_ATTEST_TYPES, QR_CODE_TTL_SECONDS, QR_ROTATION_SECONDS } from "@/config/contract";

/** Must match ProofSkill.checkInMessageHash(). */
const CHECKIN_DOMAIN = "ProofSkill:check-in";

type CodeParams = {
  chainId: number;
  contract: Address;
  eventId: bigint;
  codeWindow: bigint;
};

export function currentCodeWindow(nowMs = Date.now()): bigint {
  return BigInt(Math.floor(nowMs / 1000 / QR_ROTATION_SECONDS));
}

export function checkInMessageHash({ chainId, contract, eventId, codeWindow }: CodeParams): Hex {
  return keccak256(
    encodePacked(
      ["string", "uint256", "address", "uint256", "uint256"],
      [CHECKIN_DOMAIN, BigInt(chainId), contract, eventId, codeWindow],
    ),
  );
}

/** Signs a rotating QR code with the organizer screen's ephemeral key (EIP-191 personal_sign over the hash). */
export async function signCheckInCode(privateKey: Hex, params: CodeParams): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signMessage({ message: { raw: checkInMessageHash(params) } });
}

export async function recoverCodeSigner(params: CodeParams, signature: Hex): Promise<Address | null> {
  try {
    return await recoverMessageAddress({ message: { raw: checkInMessageHash(params) }, signature });
  } catch {
    return null;
  }
}

/** Unix seconds after which the contract rejects the code (mirrors the CodeExpired check). */
export function codeExpiresAt(codeWindow: bigint): number {
  const ttlWindows = BigInt(QR_CODE_TTL_SECONDS / QR_ROTATION_SECONDS);
  return Number((codeWindow + ttlWindows + 1n) * BigInt(QR_ROTATION_SECONDS));
}

export function buildCheckInUrl(baseUrl: string, eventId: bigint, codeWindow: bigint, signature: Hex): string {
  const url = new URL("/check-in", baseUrl);
  url.searchParams.set("eventId", eventId.toString());
  url.searchParams.set("w", codeWindow.toString());
  url.searchParams.set("sig", signature);
  return url.toString();
}

export type CheckInParams = {
  eventId: bigint | null;
  codeWindow: bigint | null;
  signature: Hex | null;
};

function parseUint(value: string | null): bigint | null {
  if (!value || !/^\d{1,30}$/.test(value)) return null;
  return BigInt(value);
}

export function parseCheckInParams(params: URLSearchParams): CheckInParams {
  const sig = params.get("sig");
  return {
    eventId: parseUint(params.get("eventId")),
    codeWindow: parseUint(params.get("w")),
    signature: sig && isHex(sig) && sig.length === 132 ? sig : null,
  };
}

// ---------------------------------------------------------------------------
// Kiosk mode: attendee shows a personal QR, the organizer device scans and co-signs it
// ---------------------------------------------------------------------------

const KIOSK_PREFIX = "oncv-kiosk:";

/** An attendee's signed KioskConsent, shown as a personal QR code. */
export type KioskPass = { attendee: Address; deadline: bigint; signature: Hex };

export function encodeKioskPass(pass: KioskPass): string {
  return `${KIOSK_PREFIX}${pass.attendee}:${pass.deadline.toString()}:${pass.signature}`;
}

export function parseKioskPass(scanned: string): KioskPass | null {
  if (!scanned.startsWith(KIOSK_PREFIX)) return null;
  const [attendee, deadline, signature] = scanned.slice(KIOSK_PREFIX.length).split(":");
  if (!attendee || !isAddress(attendee, { strict: false })) return null;
  if (!deadline || !/^\d{1,20}$/.test(deadline)) return null;
  if (!signature || !isHex(signature) || signature.length < 132 || signature.length > 4000) return null;
  return { attendee: attendee as Address, deadline: BigInt(deadline), signature };
}

/** The organizer screen's QR key attests that it scanned `attendee` for `eventId` (EIP-712 KioskAttest). */
export async function signKioskAttest(
  privateKey: Hex,
  params: { chainId: number; contract: Address; eventId: bigint; attendee: Address; deadline: bigint },
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData({
    domain: { name: "onCV", version: "1", chainId: params.chainId, verifyingContract: params.contract },
    types: KIOSK_ATTEST_TYPES,
    primaryType: "KioskAttest",
    message: { eventId: params.eventId, attendee: params.attendee, deadline: params.deadline },
  });
}

/** Accepts a scanned QR payload (full URL) and returns the check-in query string if it is one of ours. */
export function extractCheckInQuery(scanned: string): string | null {
  try {
    const url = new URL(scanned);
    if (!url.pathname.endsWith("/check-in")) return null;
    const parsed = parseCheckInParams(url.searchParams);
    if (parsed.eventId === null || parsed.codeWindow === null || !parsed.signature) return null;
    return url.search;
  } catch {
    return null;
  }
}

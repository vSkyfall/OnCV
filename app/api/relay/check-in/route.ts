import { NextResponse, type NextRequest } from "next/server";
import { BaseError, ContractFunctionRevertedError, isAddress, isHex, type Address, type Hash, type Hex } from "viem";
import { proofSkill } from "@/config/contract";
import { clientIp, increment, peek, rateLimited, refund } from "@/lib/server/rate-limit";
import { RELAYER_LIMITS, getRelayer, relayerBalance, relayerHealth, sendSerialized } from "@/lib/server/relayer";

/**
 * Check-in relayer. Pays the gas for two flows:
 * - mode "self"  (default): the attendee scanned the organizer's QR and signed an EIP-712 CheckIn intent;
 *   submits ProofSkill.checkInWithSig.
 * - mode "kiosk": the organizer device scanned the attendee's personal QR (KioskConsent) and co-signed it
 *   with the event's QR key (KioskAttest); submits ProofSkill.checkInViaKiosk.
 *
 * Every call is simulated first (reverting requests never cost gas) and is rate limited per IP, attendee and
 * event. Responses with `fallback: true` (relayer disabled, low balance, budget exhausted, RPC failure) tell
 * the client to send the check-in as a normal transaction instead.
 *
 * GET returns the relayer health (enabled, balance, limits) for the organizer console.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Attendees at a venue usually share one public IP (Wi-Fi NAT), so the per-IP limits are generous; the real
// protection is the per-attendee limit, the mandatory valid QR / kiosk signature (simulated before any gas
// is spent) and the per-event / daily budgets.
const ipLimit = Number.parseInt(process.env.RELAYER_IP_LIMIT_PER_MIN ?? "", 10);
const LIMITS = {
  selfPerIp: Number.isFinite(ipLimit) && ipLimit > 0 ? ipLimit : 120,
  kioskPerIp: 240,
  anyPerIp: 300,
  perAttendee: 3,
  kioskPerEvent: 60,
};

function parseUint(value: unknown): bigint | null {
  return typeof value === "string" && /^\d{1,30}$/.test(value) ? BigInt(value) : null;
}

function parseSignature(value: unknown): Hex | null {
  return typeof value === "string" && isHex(value) && value.length >= 132 && value.length <= 20_000 ? value : null;
}

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const tooMany = () => json({ error: "Çok fazla istek. Bir dakika sonra tekrar deneyin." }, 429);
const fallback = (error: string) => json({ error, fallback: true }, 503);

/** Health; with ?eventId= also the relayed transactions already spent from that event's budget. */
export async function GET(request: NextRequest) {
  const eventId = parseUint(request.nextUrl.searchParams.get("eventId"));
  const health = await relayerHealth();
  const eventTxUsed = eventId === null ? undefined : await peek(eventBudgetKey(eventId));
  return NextResponse.json({ ...health, eventTxUsed }, { headers: { "Cache-Control": "no-store" } });
}

const eventBudgetKey = (eventId: bigint) => `relay:budget:event:${eventId}`;

export async function POST(request: NextRequest) {
  const relayer = getRelayer();
  if (!relayer) return fallback("Gassız check-in bu sunucuda etkin değil.");

  const ip = clientIp(request);
  if (await rateLimited(`relay:ip:${ip}`, LIMITS.anyPerIp)) return tooMany();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const kiosk = body.mode === "kiosk";

  const attendee = typeof body.attendee === "string" && isAddress(body.attendee) ? (body.attendee as Address) : null;
  const eventId = parseUint(body.eventId);
  const deadline = parseUint(body.deadline);
  const attendeeSignature = parseSignature(body.attendeeSignature);
  const codeWindow = kiosk ? 0n : parseUint(body.codeWindow);
  const codeSignature = parseSignature(kiosk ? body.kioskSignature : body.qrSignature);
  if (!attendee || eventId === null || deadline === null || codeWindow === null || !attendeeSignature || !codeSignature) {
    return json({ error: "Eksik veya geçersiz alanlar." }, 400);
  }

  if (await rateLimited(`relay:${kiosk ? "kiosk" : "self"}:ip:${ip}`, kiosk ? LIMITS.kioskPerIp : LIMITS.selfPerIp)) {
    return tooMany();
  }
  if (await rateLimited(`relay:attendee:${attendee.toLowerCase()}`, LIMITS.perAttendee)) return tooMany();
  if (kiosk && (await rateLimited(`relay:kiosk:event:${eventId}`, LIMITS.kioskPerEvent))) return tooMany();

  const { account, publicClient, walletClient } = relayer;

  try {
    if ((await relayerBalance(relayer)) < RELAYER_LIMITS.minBalanceWei) {
      return fallback("Relayer bakiyesi düşük; check-in normal işlemle gönderilecek.");
    }
  } catch {
    return fallback("Relayer ağa ulaşamıyor; check-in normal işlemle gönderilecek.");
  }

  // Simulate before spending budget or gas: reverts are answered with the contract's error name.
  let send: () => Promise<Hash>;
  try {
    if (kiosk) {
      const { request: tx } = await publicClient.simulateContract({
        address: proofSkill.address,
        abi: proofSkill.abi,
        functionName: "checkInViaKiosk",
        args: [eventId, attendee, deadline, attendeeSignature, codeSignature],
        account,
      });
      send = () => walletClient.writeContract(tx);
    } else {
      const { request: tx } = await publicClient.simulateContract({
        address: proofSkill.address,
        abi: proofSkill.abi,
        functionName: "checkInWithSig",
        args: [attendee, eventId, codeWindow, codeSignature, deadline, attendeeSignature],
        account,
      });
      send = () => walletClient.writeContract(tx);
    }
  } catch (error) {
    const reverted = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    const errorName = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
    if (errorName) return json({ error: errorName, errorName }, 400);
    return fallback("Relayer işlemi doğrulayamadı; check-in normal işlemle gönderilecek.");
  }

  const eventKey = eventBudgetKey(eventId);
  const dailyKey = "relay:budget:daily";
  const [eventSpent, dailySpent] = await Promise.all([
    increment(eventKey, RELAYER_LIMITS.eventBudgetWindowMs),
    increment(dailyKey, RELAYER_LIMITS.dailyWindowMs),
  ]);
  const refundBudget = () => Promise.all([refund(eventKey), refund(dailyKey)]);
  if (eventSpent > RELAYER_LIMITS.maxTxPerEvent || dailySpent > RELAYER_LIMITS.dailyTxLimit) {
    await refundBudget();
    return fallback("Gassız check-in kotası doldu; check-in normal işlemle gönderilecek.");
  }

  try {
    const hash = await sendSerialized(relayer, send);
    return json({ hash }, 200);
  } catch (error) {
    await refundBudget();
    const message = error instanceof BaseError ? `${error.shortMessage} ${error.details ?? ""}` : String(error);
    console.error(`[relay] send failed (event ${eventId}): ${message.slice(0, 300)}`);
    return fallback("Relayer işlemi gönderemedi; check-in normal işlemle gönderilecek.");
  }
}

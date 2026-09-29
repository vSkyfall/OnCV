import {
  BaseError,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  nonceManager,
  parseEther,
  type Hash,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fuji } from "@/config/chain";
import { isContractConfigured } from "@/config/contract";
import { SERVER_RPC_URL } from "./chain";
import { acquireSharedLock, sharedLimiter } from "./rate-limit";

/**
 * Server-side relayer wallet (RELAYER_PRIVATE_KEY) that pays gas for gasless and kiosk check-ins.
 *
 * - One account instance per process with viem's nonceManager, so concurrent check-ins get distinct nonces
 *   (without it, parallel requests reuse the same pending nonce and all but one fail).
 * - RELAYER_MIN_BALANCE_AVAX: below this balance the route answers 503 and clients fall back to a normal
 *   transaction instead of failing at the door.
 * - RELAYER_MAX_TX_PER_EVENT / RELAYER_DAILY_TX_LIMIT: spending caps, so one event (or an attacker holding a
 *   valid QR key) cannot drain the wallet.
 */

export const RELAYER_LIMITS = {
  maxTxPerEvent: positiveInt(process.env.RELAYER_MAX_TX_PER_EVENT, 500),
  dailyTxLimit: positiveInt(process.env.RELAYER_DAILY_TX_LIMIT, 2_000),
  minBalanceWei: parseEther(process.env.RELAYER_MIN_BALANCE_AVAX?.trim() || "0.02"),
  eventBudgetWindowMs: 31 * 24 * 3600 * 1000,
  dailyWindowMs: 24 * 3600 * 1000,
};

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createRelayer(account: PrivateKeyAccount) {
  return {
    account,
    publicClient: createPublicClient({ chain: fuji, transport: http(SERVER_RPC_URL, { timeout: 10_000, retryCount: 2 }) }),
    // No automatic retries for sends: re-broadcasting a signed transaction reports "already known" even
    // though the first attempt went through.
    walletClient: createWalletClient({ chain: fuji, transport: http(SERVER_RPC_URL, { timeout: 15_000, retryCount: 0 }), account }),
  };
}

export type Relayer = ReturnType<typeof createRelayer>;

let cached: Relayer | null | undefined;

/** The process-wide relayer, or null when RELAYER_PRIVATE_KEY / the contract address is missing or invalid. */
export function getRelayer(): Relayer | null {
  if (cached !== undefined) return cached;
  const raw = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (!raw || !isContractConfigured) return (cached = null);
  try {
    const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
    cached = createRelayer(privateKeyToAccount(key, { nonceManager }));
  } catch {
    cached = null;
  }
  return cached;
}

/** Drops the locally tracked nonce, e.g. after a "nonce too low" error or a dropped transaction. */
export function resetNonce(relayer: Relayer) {
  nonceManager.reset({ address: relayer.account.address, chainId: fuji.id });
}

const NONCE_ERROR = /nonce|replacement transaction underpriced|already known/i;

function errorText(error: unknown): string {
  return error instanceof BaseError ? `${error.shortMessage} ${error.details ?? ""}` : String(error);
}

let sendQueue: Promise<unknown> = Promise.resolve();

/**
 * Broadcasts relayer transactions strictly one at a time, in nonce order.
 *
 * Concurrent sends from one key reach the RPC out of order; a node then either rejects the "future" nonces
 * or, worse, parks them behind a gap left by a failed send, stalling every later check-in. Serializing only
 * the sign-and-broadcast step (receipts are awaited by the client) keeps nonces gap-free at a few hundred ms
 * per transaction. With Upstash configured a shared lock extends this across serverless instances, and the
 * nonce is re-read from the chain because another instance may have used it. On a nonce error the nonce is
 * refreshed and the send retried once.
 */
export function sendSerialized(relayer: Relayer, send: () => Promise<Hash>): Promise<Hash> {
  const task = async () => {
    const release = await acquireSharedLock("relayer-send");
    try {
      if (release) resetNonce(relayer);
      try {
        return await send();
      } catch (error) {
        resetNonce(relayer);
        if (NONCE_ERROR.test(errorText(error))) return await send();
        throw error;
      }
    } finally {
      await release?.();
    }
  };
  const run = sendQueue.then(task, task);
  sendQueue = run.catch(() => undefined);
  return run;
}

let balanceCache: { value: bigint; at: number } | null = null;

/** Relayer balance, cached for 30 s so health checks and requests do not hit the RPC every time. */
export async function relayerBalance(relayer: Relayer): Promise<bigint> {
  const now = Date.now();
  if (balanceCache && now - balanceCache.at < 30_000) return balanceCache.value;
  const value = await relayer.publicClient.getBalance({ address: relayer.account.address });
  balanceCache = { value, at: now };
  return value;
}

export type RelayerHealth = {
  enabled: boolean;
  address?: string;
  balance?: string;
  lowBalance?: boolean;
  rpcOk?: boolean;
  sharedLimiter: boolean;
  limits: { maxTxPerEvent: number; dailyTxLimit: number; minBalance: string };
};

export async function relayerHealth(): Promise<RelayerHealth> {
  const limits = {
    maxTxPerEvent: RELAYER_LIMITS.maxTxPerEvent,
    dailyTxLimit: RELAYER_LIMITS.dailyTxLimit,
    minBalance: formatEther(RELAYER_LIMITS.minBalanceWei),
  };
  const relayer = getRelayer();
  if (!relayer) return { enabled: false, sharedLimiter, limits };
  try {
    const balance = await relayerBalance(relayer);
    return {
      enabled: true,
      address: relayer.account.address,
      balance: formatEther(balance),
      lowBalance: balance < RELAYER_LIMITS.minBalanceWei,
      rpcOk: true,
      sharedLimiter,
      limits,
    };
  } catch {
    return { enabled: true, address: relayer.account.address, rpcOk: false, sharedLimiter, limits };
  }
}

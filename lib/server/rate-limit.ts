import type { NextRequest } from "next/server";

/**
 * Fixed-window counters shared by the API routes (relayer, RPC proxy).
 *
 * - With UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN the counters live in Redis, so limits and relayer
 *   budgets hold across serverless instances and restarts.
 * - Otherwise they live in this process's memory (fine for a single server or a demo; each serverless
 *   instance then has its own counters). Expired windows are swept so the map cannot grow without bound.
 */

type Bucket = { count: number; resetAt: number };

const MAX_MEMORY_KEYS = 50_000;
const memory = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 30_000 && memory.size < MAX_MEMORY_KEYS) return;
  lastSweep = now;
  for (const [key, bucket] of memory) {
    if (bucket.resetAt <= now) memory.delete(key);
  }
  // Still too large (e.g. a flood of distinct keys inside one window): drop the oldest entries.
  if (memory.size >= MAX_MEMORY_KEYS) {
    const excess = memory.size - MAX_MEMORY_KEYS / 2;
    let i = 0;
    for (const key of memory.keys()) {
      if (i++ >= excess) break;
      memory.delete(key);
    }
  }
}

function memoryIncrement(key: string, windowMs: number, amount: number): number {
  const now = Date.now();
  sweep(now);
  const bucket = memory.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memory.set(key, { count: amount, resetAt: now + windowMs });
    return amount;
  }
  bucket.count += amount;
  return bucket.count;
}

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, "");
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

async function upstashIncrement(key: string, windowMs: number, amount: number): Promise<number> {
  const response = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCRBY", `oncv:${key}`, String(amount)],
      ["PEXPIRE", `oncv:${key}`, String(windowMs), "NX"],
    ]),
    cache: "no-store",
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`Upstash ${response.status}`);
  const [incr] = (await response.json()) as [{ result?: number; error?: string }];
  if (typeof incr?.result !== "number") throw new Error(incr?.error ?? "Upstash: bad response");
  return incr.result;
}

/** Adds `amount` to the counter of `key` in the current window and returns the new total. */
export async function increment(key: string, windowMs: number, amount = 1): Promise<number> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      return await upstashIncrement(key, windowMs, amount);
    } catch {
      // Redis unavailable: degrade to per-instance limits rather than failing every request.
    }
  }
  return memoryIncrement(key, windowMs, amount);
}

/** Current counter value of `key` without changing it (0 when the window has expired). */
export async function peek(key: string): Promise<number> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      const value = await upstash(["GET", `oncv:${key}`]);
      return Number(value ?? 0) || 0;
    } catch {
      // fall through to the in-memory view
    }
  }
  const bucket = memory.get(key);
  return bucket && bucket.resetAt > Date.now() ? bucket.count : 0;
}

/** True when this request pushes `key` over `max` hits per window. */
export async function rateLimited(key: string, max: number, windowMs = 60_000): Promise<boolean> {
  return (await increment(key, windowMs)) > max;
}

const REFUND_SCRIPT = 'if redis.call("exists",KEYS[1])==1 then return redis.call("decr",KEYS[1]) end return 0';

/**
 * Gives a counted unit back (e.g. a relayed transaction that was never sent). A no-op once the window has
 * expired: decrementing a missing counter would open the next window at -1 and grant an extra unit.
 */
export async function refund(key: string): Promise<void> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await upstash(["EVAL", REFUND_SCRIPT, "1", `oncv:${key}`]);
      return;
    } catch {
      // fall through to the in-memory counter
    }
  }
  const bucket = memory.get(key);
  if (bucket && bucket.resetAt > Date.now()) bucket.count -= 1;
}

export const sharedLimiter = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

async function upstash(command: string[]): Promise<unknown> {
  const response = await fetch(UPSTASH_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`Upstash ${response.status}`);
  return ((await response.json()) as { result?: unknown }).result;
}

const RELEASE_SCRIPT = 'if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';

/**
 * Cross-instance mutex (Upstash only). Returns a release function, or null when no shared store is
 * configured (callers then rely on in-process serialization). Throws when the lock stays busy for `waitMs`.
 */
export async function acquireSharedLock(
  name: string,
  ttlMs = 15_000,
  waitMs = 10_000,
): Promise<(() => Promise<void>) | null> {
  if (!sharedLimiter) return null;
  const key = `oncv:lock:${name}`;
  const token = crypto.randomUUID();
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    try {
      if ((await upstash(["SET", key, token, "NX", "PX", String(ttlMs)])) === "OK") {
        return async () => {
          await upstash(["EVAL", RELEASE_SCRIPT, "1", key, token]).catch(() => undefined);
        };
      }
    } catch {
      return null; // Redis unavailable: degrade to in-process serialization.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Lock ${name} busy`);
}

/**
 * Client IP for rate limiting, using only headers a trusted proxy sets:
 * - Vercel sets x-real-ip itself (clients cannot spoof it there).
 * - TRUSTED_IP_HEADER names another proxy's header (e.g. cf-connecting-ip behind Cloudflare).
 * - Otherwise the right-most x-forwarded-for entry, i.e. the one appended by the nearest proxy; the
 *   left-most entries are client-controlled and are never trusted.
 */
export function clientIp(request: NextRequest): string {
  const custom = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (custom) {
    const value = request.headers.get(custom)?.trim();
    if (value) return value;
  }
  if (process.env.VERCEL) {
    const real = request.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  const chain = request.headers.get("x-forwarded-for");
  if (chain) {
    const hops = chain.split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "direct";
}

import { getAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Ephemeral QR signing keys for the organizer screen.
 *
 * These keys hold no funds and can only produce check-in codes (and kiosk attestations) for events whose
 * `checkInSigner` points at them. They stay on the organizer's device; losing one only means rotating it
 * on-chain via setCheckInSigner(). Each key gets an expiry (event end + 1 day) and expired keys are pruned,
 * so a shared or borrowed device does not accumulate signing keys of past events.
 */
const STORAGE_KEY = "proofskill:qr-signers:v1";
const GRACE_SECONDS = 24 * 3600;

type Entry = { key: Hex; expiresAt?: number };
/** v1 stored the key string directly; both shapes are read. */
type SignerStore = Record<string, Hex | Entry>;

function readStore(): SignerStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SignerStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: SignerStore): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

const entryOf = (value: Hex | Entry | undefined): Entry | null =>
  !value ? null : typeof value === "string" ? { key: value } : value;

export function createSessionSigner(expiresAt?: number): { address: Address; privateKey: Hex; persisted: boolean } {
  const privateKey = generatePrivateKey();
  const { address } = privateKeyToAccount(privateKey);
  const store = readStore();
  store[address.toLowerCase()] = { key: privateKey, expiresAt };
  const persisted = writeStore(store);
  return { address, privateKey, persisted };
}

export function getSessionSignerKey(address: Address): Hex | null {
  const entry = entryOf(readStore()[getAddress(address).toLowerCase()]);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now() / 1000) return null;
  return entry.key;
}

/** Sets a key's expiry to the event end plus a grace day (keys created before the event was known). */
export function setSessionSignerExpiry(address: Address, eventEnd: number): void {
  const store = readStore();
  const id = getAddress(address).toLowerCase();
  const entry = entryOf(store[id]);
  if (!entry) return;
  const expiresAt = eventEnd + GRACE_SECONDS;
  if (entry.expiresAt === expiresAt) return;
  store[id] = { key: entry.key, expiresAt };
  writeStore(store);
}

/** Removes keys whose event is long over. */
export function pruneSessionSigners(): void {
  const store = readStore();
  const now = Date.now() / 1000;
  let changed = false;
  for (const [id, value] of Object.entries(store)) {
    const entry = entryOf(value);
    if (entry?.expiresAt && entry.expiresAt < now) {
      delete store[id];
      changed = true;
    }
  }
  if (changed) writeStore(store);
}

export function forgetSessionSigner(address: Address): void {
  const store = readStore();
  delete store[getAddress(address).toLowerCase()];
  writeStore(store);
}

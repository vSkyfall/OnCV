import { createPublicClient, http } from "viem";
import { FUJI_RPC_URL, fuji } from "@/config/chain";

/** Server-side RPC: a private endpoint (RPC_UPSTREAM_URL) when configured, never exposed to the browser. */
export const SERVER_RPC_URL = process.env.RPC_UPSTREAM_URL?.trim() || FUJI_RPC_URL;

/** Read-only client for server code (metadata, share images, API routes). */
export const serverClient = createPublicClient({
  chain: fuji,
  transport: http(SERVER_RPC_URL, { timeout: 8_000, retryCount: 1 }),
});

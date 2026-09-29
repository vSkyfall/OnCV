import { avalancheFuji } from "viem/chains";

/**
 * Avalanche Fuji C-Chain (chainId 43113, native token AVAX, explorer testnet.snowtrace.io).
 * Kept free of wallet/RainbowKit imports so server components can use it.
 */
export const fuji = avalancheFuji;

/** RPC used for reads. Wallets keep using the chain's public RPC when adding the network. */
export const FUJI_RPC_URL =
  process.env.NEXT_PUBLIC_FUJI_RPC_URL?.trim() || "https://api.avax-test.network/ext/bc/C/rpc";

/** Browser reads go through /api/rpc (which holds RPC_UPSTREAM_URL) when NEXT_PUBLIC_RPC_PROXY=true. */
export const USE_RPC_PROXY = process.env.NEXT_PUBLIC_RPC_PROXY === "true";

/** Read RPC for the current runtime: the same-origin proxy in the browser when enabled, else FUJI_RPC_URL. */
export function browserRpcUrl(): string {
  if (USE_RPC_PROXY && typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
  return FUJI_RPC_URL;
}

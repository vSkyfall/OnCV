import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimited } from "@/lib/server/rate-limit";
import { SERVER_RPC_URL } from "@/lib/server/chain";

/**
 * Read-only JSON-RPC proxy for the browser (enabled with NEXT_PUBLIC_RPC_PROXY=true).
 * Keeps a private / paid RPC endpoint (RPC_UPSTREAM_URL) off the client and rate limits reads per IP.
 * Only read methods are forwarded: transactions always go through the user's wallet (or the relayer).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "net_version",
]);

const MAX_BATCH = 25;
const MAX_BODY_BYTES = 64 * 1024;
const REQUESTS_PER_MINUTE = 600;

type RpcRequest = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function POST(request: NextRequest) {
  if (await rateLimited(`rpc:ip:${clientIp(request)}`, REQUESTS_PER_MINUTE)) {
    return NextResponse.json(rpcError(null, -32005, "Rate limit exceeded"), { status: 429 });
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json(rpcError(null, -32600, "Request too large"), { status: 413 });
  }

  let payload: RpcRequest | RpcRequest[];
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const calls = Array.isArray(payload) ? payload : [payload];
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return NextResponse.json(rpcError(null, -32600, "Invalid batch size"), { status: 400 });
  }
  const rejected = calls.find((call) => typeof call?.method !== "string" || !ALLOWED_METHODS.has(call.method));
  if (rejected) {
    return NextResponse.json(rpcError(rejected?.id, -32601, "Method not allowed"), { status: 403 });
  }

  try {
    const upstream = await fetch(SERVER_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(rpcError(null, -32603, "Upstream RPC unavailable"), { status: 502 });
  }
}

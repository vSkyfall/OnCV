import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimited } from "@/lib/server/rate-limit";

/**
 * Receives Content-Security-Policy-Report-Only violations (see next.config.mjs) and logs a compact line per
 * report to the server log, where the blocked origins can be collected before the policy is enforced.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LegacyReport = { "csp-report"?: Record<string, unknown> };

export async function POST(request: NextRequest) {
  if (await rateLimited(`csp:ip:${clientIp(request)}`, 30)) return new NextResponse(null, { status: 204 });
  try {
    const text = await request.text();
    if (text.length > 16_384) return new NextResponse(null, { status: 204 });
    const parsed = JSON.parse(text) as LegacyReport | Array<{ body?: Record<string, unknown> }>;
    const reports = Array.isArray(parsed) ? parsed.map((r) => r.body ?? {}) : [parsed["csp-report"] ?? {}];
    for (const report of reports.slice(0, 10)) {
      const directive = report["violated-directive"] ?? report.effectiveDirective ?? report["effective-directive"];
      const blocked = report["blocked-uri"] ?? report.blockedURL;
      const page = report["document-uri"] ?? report.documentURL;
      console.warn(`[csp-report-only] ${String(directive)} blocked=${String(blocked)} page=${String(page)}`);
    }
  } catch {
    // Malformed reports are ignored.
  }
  return new NextResponse(null, { status: 204 });
}

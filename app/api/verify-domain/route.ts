import { promises as dns } from "node:dns";
import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";

/**
 * Organizer domain verification: the organization proves it controls its domain by publishing a DNS TXT
 * record `oncv-verify=<wallet address>` on the domain itself or on `_oncv.<domain>`. Admins check this
 * before calling addOrganizer, and the UI shows a "domain verified" mark next to the blue tick.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

async function txtRecords(host: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(host);
    return records.map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const domain = (request.nextUrl.searchParams.get("domain") ?? "").trim().toLowerCase();
  const address = (request.nextUrl.searchParams.get("address") ?? "").trim();

  if (!DOMAIN.test(domain)) {
    return NextResponse.json({ error: "Geçersiz domain." }, { status: 400 });
  }
  if (!isAddress(address, { strict: false })) {
    return NextResponse.json({ error: "Geçersiz cüzdan adresi." }, { status: 400 });
  }

  const expected = `oncv-verify=${address.toLowerCase()}`;
  const [root, sub] = await Promise.all([txtRecords(domain), txtRecords(`_oncv.${domain}`)]);
  const found = [...root, ...sub].filter((record) => record.toLowerCase().startsWith("oncv-verify="));
  const verified = found.some((record) => record.toLowerCase() === expected);

  return NextResponse.json(
    { domain, verified, expected, found },
    { headers: { "Cache-Control": "public, s-maxage=60" } },
  );
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getAddress, isAddress, type Address } from "viem";
import { BRAND } from "@/config/brand";
import {
  isContractConfigured,
  isRegistryConfigured,
  projectRegistry,
  proofSkill,
} from "@/config/contract";
import { getTier } from "@/lib/credentials";
import { CHECKPOINT_LABELS, CHECKPOINT_NAMES, parseCheckpoint, stageMeta } from "@/lib/projects";
import { serverClient } from "@/lib/server/chain";

/**
 * Link-preview (Open Graph) images for shared Web3 CVs and project pages, rendered server-side from
 * live chain data so a recruiter or investor sees the verified numbers before clicking.
 * Labels are ASCII-safe because the default OG font has no guaranteed Turkish glyph coverage.
 */
export const OG_SIZE = { width: 1200, height: 630 };

const client = serverClient;

const ascii = (value: string) =>
  value
    .replace(/[ğĞ]/g, (c) => (c === "ğ" ? "g" : "G"))
    .replace(/[şŞ]/g, (c) => (c === "ş" ? "s" : "S"))
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/[çÇ]/g, (c) => (c === "ç" ? "c" : "C"))
    .replace(/[öÖ]/g, (c) => (c === "ö" ? "o" : "O"))
    .replace(/[üÜ]/g, (c) => (c === "ü" ? "u" : "U"));

/** Brand accent (logo red), see the brand scale in tailwind.config.ts. */
const BRAND_RED = "#DD3136";

let markPromise: Promise<string | null> | null = null;

/** The red panda mark as a data URL, read once per server instance; null falls back to a text-only card. */
function brandMark(): Promise<string | null> {
  markPromise ??= readFile(join(process.cwd(), "public", "brand", "oncv-mark.png"))
    .then((buffer) => `data:image/png;base64,${buffer.toString("base64")}`)
    .catch(() => null);
  return markPromise;
}

function Wordmark({ mark, size }: { mark: string | null; size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img elements */}
      {mark && <img src={mark} width={size} height={size} alt="" />}
      <div style={{ display: "flex", fontSize: 30, fontWeight: 600 }}>
        <span style={{ color: "#A1A1AA" }}>on</span>
        <span>CV</span>
      </div>
    </div>
  );
}

const FRAME_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  background: "#09090B",
  color: "#FAFAFA",
  padding: 64,
  fontFamily: "sans-serif",
  borderTop: `8px solid ${BRAND_RED}`,
} as const;

function Footer() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 22, color: "#71717A" }}>
      <div style={{ display: "flex", width: 10, height: 10, borderRadius: 999, background: BRAND_RED }} />
      Verified on Avalanche · oncv.xyz
    </div>
  );
}

function Frame({
  eyebrow,
  title,
  mark,
  children,
}: {
  eyebrow: string;
  title: string;
  mark: string | null;
  children: React.ReactNode;
}) {
  return (
    <div style={{ ...FRAME_STYLE, flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Wordmark mark={mark} size={64} />
        <div style={{ display: "flex", marginLeft: "auto", fontSize: 22, color: "#71717A" }}>{eyebrow}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", fontSize: 60, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1 }}>
          {ascii(title)}
        </div>
        {children}
      </div>
      <Footer />
    </div>
  );
}

/** Default share card for every page without its own (landing, check-in, projects list...). */
export async function renderHomeOg() {
  const mark = await brandMark();
  return new ImageResponse(
    (
      <div style={{ ...FRAME_STYLE, alignItems: "center", gap: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", flex: 1 }}>
          <Wordmark mark={null} size={0} />
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", fontSize: 56, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1 }}>
              {BRAND.tagline}
            </div>
            <div style={{ display: "flex", fontSize: 26, color: "#A1A1AA", lineHeight: 1.4 }}>
              Proof of attendance, a shareable Web3 CV and post-hackathon project tracking on Avalanche.
            </div>
          </div>
          <Footer />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img elements */}
        {mark && <img src={mark} width={400} height={400} alt="" />}
      </div>
    ),
    OG_SIZE,
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid #27272A",
        borderRadius: 16,
        padding: "18px 24px",
        minWidth: 200,
      }}
    >
      <div style={{ display: "flex", fontSize: 22, color: "#A1A1AA" }}>{label}</div>
      <div style={{ display: "flex", fontSize: 34, fontWeight: 700, marginTop: 6 }}>{ascii(value)}</div>
    </div>
  );
}

export async function renderProfileOg(rawAddress: string) {
  const user: Address | null = isAddress(rawAddress, { strict: false }) ? getAddress(rawAddress) : null;
  const short = user ? `${user.slice(0, 6)}...${user.slice(-4)}` : "Web3 CV";
  let score = 0;
  let events = 0;
  if (isContractConfigured && user) {
    try {
      const [s, count] = await Promise.all([
        client.readContract({ ...proofSkill, functionName: "getUserProofScore", args: [user] }),
        // Valid (non-revoked) credentials only; getUserEventCount also counts revoked records.
        client.readContract({ ...proofSkill, functionName: "validCredentialCount", args: [user] }),
      ]);
      score = Number(s);
      events = Number(count);
    } catch {
      // Render the card without numbers if the RPC is unreachable.
    }
  }
  const tier = getTier(score).current.title;
  const mark = await brandMark();
  return new ImageResponse(
    (
      <Frame eyebrow="Web3 CV" title={short} mark={mark}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
          <Metric label="Proof Score" value={String(score)} />
          <Metric label="Verified events" value={String(events)} />
          <Metric label="Tier" value={tier} />
        </div>
      </Frame>
    ),
    OG_SIZE,
  );
}

const STAGE_EN = ["Registered", "Still active", "First customer", "Funded", "Shut down"];
const CHECKPOINT_EN: Record<string, string> = {
  Upcoming: "Upcoming",
  Open: "Update due",
  Completed: "Completed",
  Missed: "Missed",
};

export async function renderProjectOg(rawId: string) {
  let title = "onCV Project";
  let stage = "Registered";
  let verification = "";
  let checkpoints: string[] = [];
  if (isRegistryConfigured && /^\d{1,20}$/.test(rawId)) {
    try {
      const id = BigInt(rawId);
      const [project, c1, c2] = await Promise.all([
        client.readContract({ ...projectRegistry, functionName: "getProject", args: [id] }),
        client.readContract({ ...projectRegistry, functionName: "getCheckpoint", args: [id, 1n] }),
        client.readContract({ ...projectRegistry, functionName: "getCheckpoint", args: [id, 2n] }),
      ]);
      // Moderated projects keep their page but the share card does not repeat their content.
      title = project.hidden ? "onCV Project" : project.title;
      stage = STAGE_EN[project.stage] ?? stageMeta(project.stage).label;
      verification = project.stage === 0 ? "" : project.stageAttested ? "Attested" : "Self-reported";
      checkpoints = [c1, c2].map(
        (raw, i) =>
          `${CHECKPOINT_NAMES[i].replace(". ay", "M")}: ${CHECKPOINT_EN[parseCheckpoint(raw).status] ?? CHECKPOINT_LABELS.Upcoming}`,
      );
    } catch {
      // Fall back to a generic card.
    }
  }
  const mark = await brandMark();
  return new ImageResponse(
    (
      <Frame eyebrow="Project tracking" title={title} mark={mark}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
          <Metric label="Stage" value={verification ? `${stage} · ${verification}` : stage} />
          {checkpoints.map((c) => (
            <Metric key={c} label={c.split(":")[0]} value={c.split(": ")[1] ?? ""} />
          ))}
        </div>
      </Frame>
    ),
    OG_SIZE,
  );
}

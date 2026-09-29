import type { Project } from "@/config/contract";

// ---------------------------------------------------------------------------
// Stages & checkpoints (must match enums in contracts/ProjectRegistry.sol)
// ---------------------------------------------------------------------------

export const STAGES = [
  { value: 0, key: "registered", label: "Kaydedildi" },
  { value: 1, key: "active", label: "Hâlâ aktif" },
  { value: 2, key: "customer", label: "İlk müşteri" },
  { value: 3, key: "funded", label: "Yatırım aldı" },
  { value: 4, key: "closed", label: "Kapandı" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export function stageMeta(value: number) {
  return STAGES.find((s) => s.value === value) ?? STAGES[0];
}

/** Stages a team can report in a progress update (Registered is set automatically). */
export const REPORTABLE_STAGES = STAGES.filter((s) => s.value !== 0);

/**
 * Cumulative milestone points per member (ProjectRegistry.cumulativePoints). An attestation pays only the
 * difference to the highest stage already rewarded, so cycling stages earns nothing.
 */
export const STAGE_POINTS: Record<number, number> = { 1: 10, 2: 35, 3: 85 };

/** Points each member receives if an update with `stage` is attested now. */
export function pointsForAttest(stage: number, highestRewarded: number): number {
  if (stage === 4) return 0;
  return Math.max(0, (STAGE_POINTS[stage] ?? 0) - (STAGE_POINTS[highestRewarded] ?? 0));
}

/** Who may attest a stage (ProjectRegistry.canAttestStage). */
export const ATTESTER_RULES =
  "\"Yatırım aldı\" yalnızca doğrulanmış bir yatırımcı veya onCV admini tarafından; diğer durumlar etkinliğin doğrulanmış organizatörü tarafından da onaylanabilir. Takım üyeleri kendi projesini onaylayamaz.";

export const CHECKPOINT_STATUS = ["Upcoming", "Open", "Completed", "Missed"] as const;
export type CheckpointStatus = (typeof CHECKPOINT_STATUS)[number];

export const CHECKPOINT_LABELS: Record<CheckpointStatus, string> = {
  Upcoming: "Yaklaşıyor",
  Open: "Güncelleme bekleniyor",
  Completed: "Güncellendi",
  Missed: "Kaçırıldı",
};

export const CHECKPOINT_NAMES = ["3. ay", "6. ay"] as const;

export type CheckpointInfo = {
  status: CheckpointStatus;
  dueAt: number;
  windowStart: number;
  windowEnd: number;
  updateIndex: number | null;
};

/**
 * "Completed" always comes from the chain. Otherwise the status is re-evaluated against the wall clock:
 * the contract evaluates it at the latest block's timestamp, and Avalanche produces no empty blocks, so on a
 * quiet network an unmet checkpoint could still read "Open" after its window has closed.
 */
export function parseCheckpoint(
  raw: readonly [number, bigint, bigint, bigint, bigint],
  nowSeconds: number = Math.floor(Date.now() / 1000),
): CheckpointInfo {
  const [status, dueAt, windowStart, windowEnd, updateIndex] = raw;
  const onChain = CHECKPOINT_STATUS[status] ?? "Upcoming";
  const start = Number(windowStart);
  const end = Number(windowEnd);
  const effective: CheckpointStatus =
    onChain === "Completed" ? "Completed" : nowSeconds >= end ? "Missed" : nowSeconds >= start ? "Open" : "Upcoming";
  return {
    status: effective,
    dueAt: Number(dueAt),
    windowStart: start,
    windowEnd: end,
    updateIndex: updateIndex > 0n ? Number(updateIndex) - 1 : null,
  };
}

/**
 * Survival signal for investors: a formally closed project is honest, a missed checkpoint on an open
 * project is the "abandoned" signal.
 */
export type Health = "thriving" | "alive" | "new" | "silent" | "closed";

export function projectHealth(project: Pick<Project, "stage" | "stageAttested">, checkpoints: CheckpointInfo[]): Health {
  if (project.stage === 4) return "closed";
  if (checkpoints.some((c) => c.status === "Missed")) return "silent";
  // "Growing" is an investor-facing claim: it needs an attested first customer / funding, not a self-report.
  if ((project.stage === 2 || project.stage === 3) && project.stageAttested) return "thriving";
  if (project.stage >= 1) return "alive";
  return "new";
}

export const HEALTH_LABELS: Record<Health, string> = {
  thriving: "Büyüyor",
  alive: "Yaşıyor",
  new: "Yeni",
  silent: "Sessiz",
  closed: "Kapandı",
};

export function isHttpUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function formatRelative(unixSeconds: number, nowSeconds: number): string {
  const diff = unixSeconds - nowSeconds;
  const abs = Math.abs(diff);
  // Block timestamps can run slightly ahead of the device clock; treat small skew as "now".
  if (abs < 60 || (diff > 0 && diff < 300)) return "az önce";
  const suffix = diff >= 0 ? "sonra" : "önce";
  if (abs < 3600) return `${Math.max(1, Math.round(abs / 60))} dk ${suffix}`;
  if (abs < 86400) return `${Math.round(abs / 3600)} sa ${suffix}`;
  return `${Math.round(abs / 86400)} gün ${suffix}`;
}

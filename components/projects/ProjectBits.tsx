import {
  Activity,
  Archive,
  CircleDashed,
  CircleDot,
  CircleX,
  FileCheck2,
  Handshake,
  Landmark,
  ShieldCheck,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import {
  CHECKPOINT_LABELS,
  CHECKPOINT_NAMES,
  HEALTH_LABELS,
  stageMeta,
  type CheckpointInfo,
  type Health,
} from "@/lib/projects";
import { cn, formatDate } from "@/lib/utils";

const STAGE_ICONS: Record<number, LucideIcon> = {
  0: FileCheck2,
  1: Activity,
  2: Handshake,
  3: Landmark,
  4: Archive,
};

export function stageIcon(stage: number): LucideIcon {
  return STAGE_ICONS[stage] ?? FileCheck2;
}

/** The project's current stage: the dynamic part of the project credential. */
export function StageBadge({
  stage,
  attested,
  className,
}: {
  stage: number;
  attested: boolean;
  className?: string;
}) {
  const Icon = stageIcon(stage);
  const meta = stageMeta(stage);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        stage === 4 ? "border-zinc-800 text-zinc-500" : "border-zinc-700 text-zinc-100",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
      {stage !== 0 && (
        <span
          className={cn(
            "ml-0.5 inline-flex items-center gap-0.5 font-normal",
            attested ? "text-emerald-400" : "text-zinc-500",
          )}
          title={attested ? "Organizatör / admin onaylı" : "Takım beyanı, henüz onaylanmadı"}
        >
          {attested ? <ShieldCheck className="h-3 w-3" /> : null}
          {attested ? "Onaylı" : "Beyan"}
        </span>
      )}
    </span>
  );
}

const HEALTH_STYLES: Record<Health, string> = {
  thriving: "text-emerald-400",
  alive: "text-zinc-200",
  new: "text-zinc-400",
  silent: "text-brand-400",
  closed: "text-zinc-600",
};

export function HealthBadge({ health }: { health: Health }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs", HEALTH_STYLES[health])}>
      <CircleDot className="h-3 w-3" /> {HEALTH_LABELS[health]}
    </span>
  );
}

const CHECKPOINT_ICONS = {
  Upcoming: CircleDashed,
  Open: CircleDot,
  Completed: CheckCircle2,
  Missed: CircleX,
} as const;

const CHECKPOINT_STYLES = {
  Upcoming: "text-zinc-500",
  Open: "text-amber-300",
  Completed: "text-emerald-400",
  Missed: "text-brand-400",
} as const;

/** Compact 3rd / 6th month checkpoint indicators. */
export function CheckpointPills({ checkpoints }: { checkpoints: CheckpointInfo[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {checkpoints.map((c, i) => {
        const Icon = CHECKPOINT_ICONS[c.status];
        return (
          <span
            key={i}
            className={cn("inline-flex items-center gap-1 rounded-md border border-zinc-800 px-1.5 py-0.5 text-[11px]", CHECKPOINT_STYLES[c.status])}
            title={`${CHECKPOINT_NAMES[i]}: ${CHECKPOINT_LABELS[c.status]} (hedef ${formatDate(c.dueAt)})`}
          >
            <Icon className="h-3 w-3" /> {CHECKPOINT_NAMES[i]}
          </span>
        );
      })}
    </div>
  );
}

/** Full timeline: registration -> 3rd month -> 6th month. */
export function CheckpointTimeline({
  registeredAt,
  checkpoints,
}: {
  registeredAt: number;
  checkpoints: CheckpointInfo[];
}) {
  const steps = [
    { label: "Kayıt", detail: formatDate(registeredAt), status: "Completed" as const },
    ...checkpoints.map((c, i) => ({
      label: CHECKPOINT_NAMES[i],
      detail: `${CHECKPOINT_LABELS[c.status]} · ${formatDate(c.dueAt)}`,
      status: c.status,
    })),
  ];
  return (
    <ol className="grid gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
      {steps.map((step) => {
        const Icon = CHECKPOINT_ICONS[step.status];
        return (
          <li key={step.label} className="bg-background p-4">
            <div className={cn("flex items-center gap-2 text-sm font-medium", CHECKPOINT_STYLES[step.status])}>
              <Icon className="h-4 w-4" /> <span className="text-zinc-100">{step.label}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">{step.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

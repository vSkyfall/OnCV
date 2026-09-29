"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, FolderKanban, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { CheckpointPills, HealthBadge, StageBadge } from "@/components/projects/ProjectBits";
import { Spinner } from "@/components/ui/primitives";
import { SetupNotice } from "@/components/ui/SetupNotice";
import { OrganizerName } from "@/components/ui/VerifiedBadge";
import { fuji } from "@/config/chain";
import { isRegistryConfigured, projectRegistry, proofSkill, type Project } from "@/config/contract";
import { HEALTH_LABELS, parseCheckpoint, projectHealth, type CheckpointInfo, type Health } from "@/lib/projects";
import { cn, formatDate } from "@/lib/utils";

const PAGE_SIZE = 50n;
const FILTERS: Array<{ key: Health | "all"; label: string }> = [
  { key: "all", label: "Tümü" },
  { key: "thriving", label: HEALTH_LABELS.thriving },
  { key: "alive", label: HEALTH_LABELS.alive },
  { key: "new", label: HEALTH_LABELS.new },
  { key: "silent", label: HEALTH_LABELS.silent },
  { key: "closed", label: HEALTH_LABELS.closed },
];

type Row = { project: Project; checkpoints: CheckpointInfo[]; health: Health };

export default function ProjectsPage() {
  const [filter, setFilter] = useState<Health | "all">("all");
  const [pages, setPages] = useState(1);

  const countQuery = useReadContract({
    ...projectRegistry,
    chainId: fuji.id,
    functionName: "projectCount",
    query: { enabled: isRegistryConfigured, refetchInterval: 30_000 },
  });
  const total = countQuery.data ?? 0n;
  // getProjects pages newest first and caps each call at MAX_PAGE_SIZE (50).
  const listQuery = useReadContracts({
    contracts: Array.from({ length: pages }, (_, k) => ({
      ...projectRegistry,
      chainId: fuji.id,
      functionName: "getProjects" as const,
      args: [BigInt(k) * PAGE_SIZE, PAGE_SIZE] as const,
    })),
    allowFailure: false,
    query: { enabled: isRegistryConfigured && total > 0n, refetchInterval: 30_000, placeholderData: (previous) => previous },
  });
  const loaded = useMemo(() => (listQuery.data ?? []).flat(), [listQuery.data]);
  // Moderated projects stay on-chain (and on their own page) but are left out of the public listing.
  const projects = useMemo(() => loaded.filter((p) => !p.hidden), [loaded]);
  const hiddenCount = loaded.length - projects.length;
  const hasMore = total > BigInt(pages) * PAGE_SIZE;

  const checkpointQuery = useReadContracts({
    contracts: projects.flatMap((p) => [
      { ...projectRegistry, chainId: fuji.id, functionName: "getCheckpoint" as const, args: [p.id, 1n] as const },
      { ...projectRegistry, chainId: fuji.id, functionName: "getCheckpoint" as const, args: [p.id, 2n] as const },
    ]),
    allowFailure: false,
    query: { enabled: projects.length > 0 },
  });
  const eventChunks = useMemo(() => {
    const ids = [...new Set(projects.map((p) => p.eventId))];
    const chunks: bigint[][] = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100)); // getEvents: max 100 ids
    return chunks;
  }, [projects]);
  const eventsQuery = useReadContracts({
    contracts: eventChunks.map((ids) => ({ ...proofSkill, chainId: fuji.id, functionName: "getEvents" as const, args: [ids] as const })),
    allowFailure: false,
    query: { enabled: eventChunks.length > 0 },
  });
  const eventsById = useMemo(
    () => new Map((eventsQuery.data ?? []).flat().map((e) => [e.id.toString(), e])),
    [eventsQuery.data],
  );

  const rows = useMemo<Row[]>(() => {
    const raw = checkpointQuery.data;
    return projects.map((project, i) => {
      const checkpoints =
        raw && raw[i * 2] && raw[i * 2 + 1] ? [parseCheckpoint(raw[i * 2]), parseCheckpoint(raw[i * 2 + 1])] : [];
      return { project, checkpoints, health: projectHealth(project, checkpoints) };
    });
  }, [projects, checkpointQuery.data]);

  // Survival: among projects whose 3rd-month checkpoint is decided, how many reported in time.
  const decided = rows.filter((r) => r.checkpoints[0] && ["Completed", "Missed"].includes(r.checkpoints[0].status));
  const survived = decided.filter((r) => r.checkpoints[0].status === "Completed" && r.project.stage !== 4);
  const survivalRate = decided.length ? Math.round((survived.length / decided.length) * 100) : null;
  const funded = rows.filter((r) => r.project.stage === 3 && r.project.stageAttested).length;

  const visible = filter === "all" ? rows : rows.filter((r) => r.health === filter);

  if (!isRegistryConfigured) {
    return (
      <div className="page-shell py-12">
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="page-shell py-12">
      <div className="mb-8">
        <div className="eyebrow">
          <FolderKanban className="h-3.5 w-3.5" /> Post-event tracking
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">Hackathon sonrası yaşayan projeler</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Projelerin çoğu birkaç hafta içinde terk edilir. Burada her proje 3. ve 6. ayda durumunu zincire yazar; organizatör
          ve yatırımcı onaylı ilerleme ile kaçırılan kontrol noktaları herkes tarafından doğrulanabilir.
        </p>
      </div>

      <div className="card mb-8 grid grid-cols-2 md:grid-cols-4 md:divide-x md:divide-zinc-800">
        <Stat label="Kayıtlı proje" value={total.toString()} hint={hasMore ? `en yeni ${loaded.length} yüklendi` : undefined} />
        <Stat label="3. ay hayatta kalma" value={survivalRate === null ? "—" : `%${survivalRate}`} hint={`${decided.length} proje ölçüldü`} />
        <Stat label="Onaylı yatırım" value={funded.toString()} />
        <Stat label="Sessiz / kapanan" value={rows.filter((r) => r.health === "silent" || r.health === "closed").length.toString()} />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              filter === f.key ? "border-zinc-600 bg-zinc-800 text-zinc-50" : "border-zinc-800 text-zinc-400 hover:text-zinc-200",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {countQuery.isLoading || listQuery.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-5 w-5 text-zinc-500" />
        </div>
      ) : visible.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-zinc-500">
          {projects.length === 0
            ? "Henüz kayıtlı proje yok. Katılımcılar check-in sonrası projelerini kaydedebilir."
            : "Bu filtreye uyan proje yok."}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map(({ project, checkpoints, health }, i) => {
            const event = eventsById.get(project.eventId.toString());
            return (
              <motion.div
                key={project.id.toString()}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.03 }}
              >
                <Link href={`/projects/${project.id}`} className="card card-hover block p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-zinc-500">{event ? event.name : `Etkinlik #${project.eventId}`}</div>
                      <h2 className="mt-1 truncate text-base font-semibold text-zinc-50">{project.title}</h2>
                      {event && <OrganizerName name={event.organizer} verified={event.organizerVerified} className="text-xs text-zinc-500" />}
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-600" />
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-zinc-400">{project.pitch}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StageBadge stage={project.stage} attested={project.stageAttested} />
                      <HealthBadge health={health} />
                    </div>
                    <CheckpointPills checkpoints={checkpoints} />
                  </div>
                  <div className="mt-3 flex items-center gap-3 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {project.team.length} kişi
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="h-3.5 w-3.5" /> Kayıt {formatDate(project.registeredAt)}
                    </span>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
      {hasMore && (
        <button type="button" className="btn-secondary mt-4 w-full" onClick={() => setPages((p) => p + 1)} disabled={listQuery.isFetching}>
          {listQuery.isFetching ? <Spinner className="h-4 w-4" /> : null} Daha eski projeler
        </button>
      )}
      {hiddenCount > 0 && (
        <p className="mt-4 text-center text-xs text-zinc-600">{hiddenCount} proje moderasyon nedeniyle listede gösterilmiyor.</p>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="p-5">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold text-zinc-50">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-600">{hint}</div>}
    </div>
  );
}

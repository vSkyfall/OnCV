"use client";

import { ArrowUpRight, EyeOff, FolderKanban, Mail } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { CheckpointPills, HealthBadge, StageBadge } from "@/components/projects/ProjectBits";
import { SectionHeader } from "@/components/ui/primitives";
import { fuji } from "@/config/chain";
import { projectRegistry } from "@/config/contract";
import { parseCheckpoint, projectHealth } from "@/lib/projects";
import { formatDate } from "@/lib/utils";

/** Web3 CV section: projects the holder built, with their live (dynamic) stage and checkpoint status. */
export function ProfileProjects({ address }: { address: Address }) {
  const { address: connected } = useAccount();
  const isOwn = connected?.toLowerCase() === address.toLowerCase();
  const idsQuery = useReadContract({
    ...projectRegistry,
    chainId: fuji.id,
    functionName: "getMemberProjects",
    args: [address],
  });
  const invitesQuery = useReadContract({
    ...projectRegistry,
    chainId: fuji.id,
    functionName: "getInvites",
    args: [address],
    query: { enabled: isOwn },
  });
  const inviteIds = invitesQuery.data ?? [];
  const invitedQuery = useReadContracts({
    contracts: inviteIds.map((id) => ({ ...projectRegistry, chainId: fuji.id, functionName: "getProject" as const, args: [id] as const })),
    allowFailure: false,
    query: { enabled: isOwn && inviteIds.length > 0 },
  });
  const allIds = idsQuery.data ?? [];
  const ids = useMemo(() => (idsQuery.data ?? []).slice(-20), [idsQuery.data]);

  const detailsQuery = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...projectRegistry, chainId: fuji.id, functionName: "getProject" as const, args: [id] as const },
      { ...projectRegistry, chainId: fuji.id, functionName: "getCheckpoint" as const, args: [id, 1n] as const },
      { ...projectRegistry, chainId: fuji.id, functionName: "getCheckpoint" as const, args: [id, 2n] as const },
    ]),
    allowFailure: false,
    query: { enabled: ids.length > 0 },
  });

  const rows = useMemo(() => {
    const data = detailsQuery.data;
    if (!data) return [];
    return ids
      .map((_, i) => {
        const project = data[i * 3] as Extract<(typeof data)[number], { team: readonly unknown[] }>;
        const checkpoints = [
          parseCheckpoint(data[i * 3 + 1] as readonly [number, bigint, bigint, bigint, bigint]),
          parseCheckpoint(data[i * 3 + 2] as readonly [number, bigint, bigint, bigint, bigint]),
        ];
        return { project, checkpoints, health: projectHealth(project, checkpoints) };
      })
      .reverse();
  }, [ids, detailsQuery.data]);

  const invites = invitedQuery.data ?? [];
  if (allIds.length === 0 && invites.length === 0) return null;

  return (
    <section>
      <SectionHeader
        eyebrow={
          <>
            <FolderKanban className="h-3.5 w-3.5" /> Projects
          </>
        }
        title="Projeler ve hackathon sonrası takip"
        description="Durum ve 3. / 6. ay kontrol noktaları zincirden okunur; her takım üyesinin proje kredansiyeli bu duruma göre güncellenir."
      />
      {invites.length > 0 && (
        <div className="mb-3 space-y-2">
          {invites.map((p) => (
            <Link
              key={p.id.toString()}
              href={`/projects/${p.id}`}
              className="card card-hover flex items-center justify-between gap-3 border-zinc-700 p-4"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-200">
                <Mail className="h-4 w-4 shrink-0 text-zinc-400" />
                <span className="truncate">
                  <span className="font-medium text-zinc-50">{p.title}</span> projesine davet edildiniz
                </span>
              </span>
              <span className="btn-secondary btn-sm shrink-0">Yanıtla</span>
            </Link>
          ))}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map(({ project, checkpoints, health }) => (
          <Link key={project.id.toString()} href={`/projects/${project.id}`} className="card card-hover block p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 truncate text-base font-semibold text-zinc-50">
                  {project.title}
                  {project.hidden && <EyeOff className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-label="Moderasyon nedeniyle gizlendi" />}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{project.pitch}</p>
              </div>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-600" />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StageBadge stage={project.stage} attested={project.stageAttested} />
                <HealthBadge health={health} />
              </div>
              <CheckpointPills checkpoints={checkpoints} />
            </div>
            <div className="mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
              Kayıt {formatDate(project.registeredAt)} · {project.team.length} kişilik takım
            </div>
          </Link>
        ))}
      </div>
      {allIds.length > ids.length && (
        <p className="mt-3 text-center text-xs text-zinc-500">
          En yeni {ids.length} proje gösteriliyor ({allIds.length} toplam) ·{" "}
          <Link href="/projects" className="underline">
            tüm projeler
          </Link>
        </p>
      )}
    </section>
  );
}

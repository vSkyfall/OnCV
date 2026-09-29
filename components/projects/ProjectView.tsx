"use client";

import { motion } from "framer-motion";
import {
  Check,
  EyeOff,
  ExternalLink,
  FileText,
  FolderKanban,
  History,
  Link2,
  Mail,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { CheckpointTimeline, HealthBadge, StageBadge } from "@/components/projects/ProjectBits";
import { Identicon } from "@/components/ui/Identicon";
import { CopyButton, IconTile, Notice, SectionHeader, Spinner } from "@/components/ui/primitives";
import { SetupNotice } from "@/components/ui/SetupNotice";
import { OrganizerName } from "@/components/ui/VerifiedBadge";
import { fuji } from "@/config/chain";
import {
  MAX_TEAM_SIZE,
  PROJECT_ID_OFFSET,
  REGISTRATION_WINDOW_SECONDS,
  credentialToken,
  explorerTokenUrl,
  isCredentialConfigured,
  isRegistryConfigured,
  projectRegistry,
  proofSkill,
  type Project,
  type ProjectUpdate,
} from "@/config/contract";
import { parseWeb3Error } from "@/lib/errors";
import { useAppUrl, useNow } from "@/lib/hooks";
import {
  ATTESTER_RULES,
  CHECKPOINT_LABELS,
  CHECKPOINT_NAMES,
  REPORTABLE_STAGES,
  STAGE_POINTS,
  formatRelative,
  isHttpUrl,
  parseCheckpoint,
  pointsForAttest,
  projectHealth,
  stageMeta,
  type CheckpointInfo,
} from "@/lib/projects";
import { useContractTx } from "@/lib/use-tx";
import { formatDate, formatDateTime, shortenAddress } from "@/lib/utils";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** Decodes the on-chain rendered token metadata (data:application/json;base64,...) into its SVG image. */
function tokenImage(uri: string | undefined): string | null {
  if (!uri?.startsWith("data:application/json;base64,")) return null;
  try {
    const json = JSON.parse(atob(uri.slice("data:application/json;base64,".length))) as { image?: string };
    return json.image ?? null;
  } catch {
    return null;
  }
}

export function ProjectView({ projectId }: { projectId: bigint }) {
  const { address } = useAccount();
  const appUrl = useAppUrl();
  const now = useNow(60_000);
  const tokenId = PROJECT_ID_OFFSET + projectId;
  const viewer = address ?? ZERO;

  const coreQuery = useReadContracts({
    contracts: [
      { ...projectRegistry, chainId: fuji.id, functionName: "getProject", args: [projectId] },
      { ...projectRegistry, chainId: fuji.id, functionName: "getUpdates", args: [projectId] },
      { ...projectRegistry, chainId: fuji.id, functionName: "getCheckpoint", args: [projectId, 1n] },
      { ...projectRegistry, chainId: fuji.id, functionName: "getCheckpoint", args: [projectId, 2n] },
    ],
    allowFailure: false,
    query: { enabled: isRegistryConfigured, refetchInterval: 20_000 },
  });
  const [project, updates, rawC1, rawC2] = coreQuery.data ?? [];

  // What the connected wallet may do here (attester rules differ per stage).
  const viewerQuery = useReadContracts({
    contracts: [
      { ...projectRegistry, chainId: fuji.id, functionName: "isInvited", args: [projectId, viewer] },
      { ...proofSkill, chainId: fuji.id, functionName: "isAdmin", args: [viewer] },
      { ...projectRegistry, chainId: fuji.id, functionName: "canAttestStage", args: [projectId, viewer, 1] },
      { ...projectRegistry, chainId: fuji.id, functionName: "canAttestStage", args: [projectId, viewer, 2] },
      { ...projectRegistry, chainId: fuji.id, functionName: "canAttestStage", args: [projectId, viewer, 3] },
      { ...projectRegistry, chainId: fuji.id, functionName: "canAttestStage", args: [projectId, viewer, 4] },
    ],
    allowFailure: false,
    query: { enabled: isRegistryConfigured && !!address && !!project },
  });
  const [isInvited, isAdmin, ...attestByStage] = (viewerQuery.data ?? []) as boolean[];
  const canAttestStage = (stage: number) => attestByStage[stage - 1] === true;

  const eventQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "getEvent",
    args: [project?.eventId ?? 0n],
    query: { enabled: !!project },
  });
  const uriQuery = useReadContract({
    ...credentialToken,
    chainId: fuji.id,
    functionName: "uri",
    args: [tokenId],
    query: { enabled: isCredentialConfigured && !!project, refetchInterval: 20_000 },
  });

  const attesters = useMemo(
    () => [...new Set((updates ?? []).filter((u) => u.attested).map((u) => u.attester.toLowerCase()))] as Address[],
    [updates],
  );
  const attesterQuery = useReadContracts({
    contracts: attesters.flatMap((a) => [
      { ...projectRegistry, chainId: fuji.id, functionName: "investors", args: [a] } as const,
      { ...proofSkill, chainId: fuji.id, functionName: "isAdmin", args: [a] } as const,
    ]),
    allowFailure: false,
    query: { enabled: attesters.length > 0 },
  });

  const checkpoints = useMemo<CheckpointInfo[]>(
    () => (rawC1 && rawC2 ? [parseCheckpoint(rawC1), parseCheckpoint(rawC2)] : []),
    [rawC1, rawC2],
  );
  const image = tokenImage(uriQuery.data);

  if (!isRegistryConfigured) {
    return (
      <div className="page-shell py-12">
        <SetupNotice />
      </div>
    );
  }
  if (coreQuery.isLoading) {
    return (
      <div className="flex justify-center py-32">
        <Spinner className="h-5 w-5 text-zinc-500" />
      </div>
    );
  }
  if (!project || !updates) {
    return (
      <div className="page-shell py-16">
        <Notice tone="danger" title="Proje bulunamadı">
          {coreQuery.error ? parseWeb3Error(coreQuery.error) : `#${projectId} numaralı proje yok.`}
        </Notice>
      </div>
    );
  }

  const isOwner = !!address && address.toLowerCase() === project.owner.toLowerCase();
  const isMember = !!address && project.team.some((m) => m.toLowerCase() === address.toLowerCase());
  const health = projectHealth(project, checkpoints);
  const event = eventQuery.data;
  const shareUrl = appUrl ? `${appUrl}/projects/${projectId}` : "";
  const registrationClosesAt = Number(project.anchorAt) + REGISTRATION_WINDOW_SECONDS;
  const registrationOpen = now === null || now / 1000 <= registrationClosesAt;

  function attesterLabel(attester: Address): string {
    const i = attesters.indexOf(attester.toLowerCase() as Address);
    const data = attesterQuery.data;
    if (i >= 0 && data) {
      const investor = data[i * 2] as readonly [string, string, boolean];
      const admin = data[i * 2 + 1] as boolean;
      if (investor[2]) return `Yatırımcı · ${investor[0]}`;
      if (event && attester.toLowerCase() === event.creator.toLowerCase()) return `Organizatör · ${event.organizer}`;
      if (admin) return "onCV admin";
    }
    return shortenAddress(attester);
  }

  return (
    <div className="page-shell space-y-8 py-10 sm:py-14">
      {project.hidden && (
        <Notice tone="warning" title="Bu proje moderasyon nedeniyle gizlendi">
          Proje herkese açık listelerde gösterilmez. Kayıtlar zincirde durmaya devam eder.
        </Notice>
      )}
      {isInvited && <InviteCard projectId={projectId} registrationOpen={registrationOpen} closesAt={registrationClosesAt} />}

      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card overflow-hidden">
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr]">
          <div className="min-w-0">
            <div className="eyebrow">
              <FolderKanban className="h-3.5 w-3.5" /> Proje #{projectId.toString()}
              {event && (
                <>
                  <span className="text-zinc-700">/</span> {event.name}
                </>
              )}
            </div>
            <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{project.title}</h1>
            {event && (
              <OrganizerName name={event.organizer} verified={event.organizerVerified} className="mt-1 text-sm text-zinc-400" />
            )}
            <p className="mt-4 max-w-2xl break-words text-sm leading-relaxed text-zinc-300">{project.pitch}</p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <StageBadge stage={project.stage} attested={project.stageAttested} />
              <HealthBadge health={health} />
              <span className="text-xs text-zinc-500">
                Son güncelleme: {now ? formatRelative(Number(project.lastUpdateAt), now / 1000) : formatDate(project.lastUpdateAt)}
              </span>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {project.url && isHttpUrl(project.url) && (
                <a href={project.url} target="_blank" rel="noreferrer noopener nofollow" className="btn-secondary btn-sm">
                  <Link2 className="h-3.5 w-3.5" /> Proje linki <ExternalLink className="h-3 w-3 text-zinc-500" />
                </a>
              )}
              {shareUrl && <CopyButton value={shareUrl} label="Takip linkini kopyala" className="btn-sm" />}
            </div>

            <div className="mt-6">
              <div className="label flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Takım
              </div>
              {project.team.length === 0 ? (
                <p className="text-xs text-zinc-500">Takımda doğrulanmış üye kalmadı.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {project.team.map((member) => (
                    <Link
                      key={member}
                      href={`/${member}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 py-1 pl-1 pr-2.5 text-xs text-zinc-300 transition-colors hover:border-zinc-700"
                    >
                      <Identicon address={member} size={20} />
                      <span className="font-mono">{shortenAddress(member)}</span>
                      {member.toLowerCase() === project.owner.toLowerCase() && <span className="text-zinc-600">sahip</span>}
                    </Link>
                  ))}
                </div>
              )}
              {project.pendingInvites.length > 0 && (
                <p className="mt-2 text-xs text-zinc-500">
                  Bekleyen davet: {project.pendingInvites.map((a) => shortenAddress(a)).join(", ")}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Dinamik kredansiyel</span>
              <span className="chip">ERC-1155 · Soulbound</span>
            </div>
            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt={`${project.title} credential`} className="block aspect-square w-full" />
              ) : (
                <div className="flex aspect-square items-center justify-center text-xs text-zinc-600">
                  {isCredentialConfigured ? <Spinner className="h-4 w-4" /> : "Token kontratı yapılandırılmadı"}
                </div>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              Görsel ve özellikler zincirde üretilir; durum ve kontrol noktaları değiştikçe tüm takım üyelerinin
              token&apos;ı kendiliğinden güncellenir.
            </p>
            {isCredentialConfigured && (
              <a href={explorerTokenUrl(tokenId)} target="_blank" rel="noreferrer" className="btn-ghost btn-sm mt-2">
                SnowTrace&apos;te token <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </motion.section>

      <section>
        <SectionHeader
          eyebrow={
            <>
              <History className="h-3.5 w-3.5" /> Tracking
            </>
          }
          title="3. ve 6. ay kontrol noktaları"
          description={`Kontrol noktaları etkinliğin bitişinden (${formatDate(project.anchorAt)}) itibaren sayılır. Her biri hedef tarihin yarım periyot öncesi ile sonrası arasında girilen bir güncellemeyle tamamlanır; kaçırılan kontrol noktası zincirde kalıcı olarak görünür.`}
        />
        <CheckpointTimeline registeredAt={Number(project.registeredAt)} checkpoints={checkpoints} />
        {checkpoints.map((c, i) =>
          c.status === "Open" ? (
            <Notice key={i} tone="warning" className="mt-3">
              {CHECKPOINT_NAMES[i]} güncelleme penceresi açık: {formatDateTime(c.windowStart)} – {formatDateTime(c.windowEnd)}
              {isOwner ? " · Aşağıdan durumunuzu girin." : ""}
            </Notice>
          ) : null,
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <SectionHeader title="Güncellemeler" description="Takım beyanları ve bağımsız onaylar." />
          <UpdatesList
            projectId={projectId}
            project={project}
            updates={updates}
            canAttestStage={canAttestStage}
            checkpoints={checkpoints}
            attesterLabel={attesterLabel}
          />
        </div>
        <div className="space-y-6">
          {isOwner && project.stage !== 4 ? (
            <UpdateForm projectId={projectId} highestRewarded={project.highestRewarded} />
          ) : (
            <div className="card p-5 text-sm text-zinc-500">
              <ShieldCheck className="mb-2 h-4 w-4 text-zinc-400" />
              Güncellemeleri proje sahibi girer. {ATTESTER_RULES} Onaylanan &quot;Hâlâ aktif&quot;, &quot;İlk müşteri&quot; ve
              &quot;Yatırım aldı&quot; durumları takımın her üyesine toplamda sırasıyla {STAGE_POINTS[1]}, {STAGE_POINTS[2]} ve{" "}
              {STAGE_POINTS[3]} Proof Score kazandırır; her aşama yalnızca bir kez ödüllendirilir.
            </div>
          )}
          {isOwner && (
            <TeamManager project={project} projectId={projectId} registrationOpen={registrationOpen} closesAt={registrationClosesAt} />
          )}
          {isMember && !isOwner && (
            <p className="text-xs text-zinc-500">Bu projenin takım üyesisiniz. Güncellemeleri proje sahibi girer.</p>
          )}
          {isAdmin && <ModerationCard projectId={projectId} hidden={project.hidden} />}
        </div>
      </section>
    </div>
  );
}

function InviteCard({ projectId, registrationOpen, closesAt }: { projectId: bigint; registrationOpen: boolean; closesAt: number }) {
  const { writeContractAsync } = useWriteContract();
  const tx = useContractTx();
  return (
    <div className="card flex flex-col gap-4 border-zinc-700 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <IconTile>
          <Mail className="h-4 w-4" />
        </IconTile>
        <div>
          <div className="text-sm font-medium text-zinc-100">Bu projeye davet edildiniz</div>
          <div className="text-xs text-zinc-500">
            {registrationOpen
              ? `Kabul ederseniz takıma katılır ve proje kredansiyelini alırsınız. Son tarih: ${formatDateTime(closesAt)}`
              : "Kayıt penceresi kapandığı için davet artık kabul edilemez."}
          </div>
          {tx.error && <p className="mt-1 text-xs text-brand-400">{tx.error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={tx.busy}
          onClick={() =>
            tx.run("decline", () => writeContractAsync({ ...projectRegistry, chainId: fuji.id, functionName: "declineInvite", args: [projectId] }))
          }
        >
          {tx.pending === "decline" ? <Spinner className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} Reddet
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={tx.busy || !registrationOpen}
          onClick={() =>
            tx.run("accept", () => writeContractAsync({ ...projectRegistry, chainId: fuji.id, functionName: "acceptInvite", args: [projectId] }))
          }
        >
          {tx.pending === "accept" ? <Spinner className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />} Kabul et
        </button>
      </div>
    </div>
  );
}

function TeamManager({
  project,
  projectId,
  registrationOpen,
  closesAt,
}: {
  project: Project;
  projectId: bigint;
  registrationOpen: boolean;
  closesAt: number;
}) {
  const { writeContractAsync } = useWriteContract();
  const tx = useContractTx();
  const [invitee, setInvitee] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const others = project.team.filter((m) => m.toLowerCase() !== project.owner.toLowerCase());
  const seats = MAX_TEAM_SIZE - project.team.length - project.pendingInvites.length;

  async function invite(e: FormEvent) {
    e.preventDefault();
    const value = invitee.trim();
    if (!isAddress(value, { strict: false })) {
      tx.setError("Geçerli bir cüzdan adresi girin.");
      return;
    }
    const receipt = await tx.run("invite", () =>
      writeContractAsync({ ...projectRegistry, chainId: fuji.id, functionName: "inviteMember", args: [projectId, value as Address] }),
    );
    if (receipt) setInvitee("");
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center gap-3">
        <IconTile>
          <UserPlus className="h-4 w-4" />
        </IconTile>
        <div>
          <h3 className="text-sm font-semibold text-zinc-50">Takım yönetimi</h3>
          <p className="text-xs text-zinc-500">
            {registrationOpen ? `Davetler ${formatDateTime(closesAt)} tarihine kadar açık.` : "Kayıt penceresi kapandı; yeni davet gönderilemez."}
          </p>
        </div>
      </div>

      {project.pendingInvites.length > 0 && (
        <ul className="space-y-1.5">
          {project.pendingInvites.map((a) => (
            <li key={a} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs">
              <span className="font-mono text-zinc-300">{shortenAddress(a)}</span>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={tx.busy}
                onClick={() =>
                  tx.run(`cancel-${a}`, () =>
                    writeContractAsync({ ...projectRegistry, chainId: fuji.id, functionName: "cancelInvite", args: [projectId, a] }),
                  )
                }
              >
                {tx.pending === `cancel-${a}` ? <Spinner className="h-3 w-3" /> : <X className="h-3 w-3" />} Daveti iptal et
              </button>
            </li>
          ))}
        </ul>
      )}

      {registrationOpen && seats > 0 && project.stage !== 4 && (
        <form onSubmit={invite} className="flex gap-2">
          <input
            className="input font-mono"
            placeholder="0x… (etkinliğe katılmış olmalı)"
            value={invitee}
            onChange={(e) => setInvitee(e.target.value)}
            disabled={tx.busy}
            aria-label="Davet edilecek adres"
          />
          <button type="submit" className="btn-secondary shrink-0" disabled={tx.busy}>
            {tx.pending === "invite" ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />} Davet et
          </button>
        </form>
      )}

      {others.length > 0 && (
        <div className="flex gap-2">
          <select className="input" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} disabled={tx.busy} aria-label="Yeni sahip">
            <option value="">Sahipliği devret…</option>
            {others.map((m) => (
              <option key={m} value={m}>
                {shortenAddress(m)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary shrink-0"
            disabled={tx.busy || !newOwner}
            onClick={() => {
              if (!window.confirm("Proje sahipliği seçilen üyeye devredilecek. Güncellemeleri artık o girer. Devam edilsin mi?")) return;
              tx.run("transfer", () =>
                writeContractAsync({
                  ...projectRegistry,
                  chainId: fuji.id,
                  functionName: "transferProjectOwnership",
                  args: [projectId, newOwner as Address],
                }),
              );
            }}
          >
            {tx.pending === "transfer" ? <Spinner className="h-4 w-4" /> : null} Devret
          </button>
        </div>
      )}
      {tx.error && <Notice tone="danger">{tx.error}</Notice>}
    </div>
  );
}

function ModerationCard({ projectId, hidden }: { projectId: bigint; hidden: boolean }) {
  const { writeContractAsync } = useWriteContract();
  const tx = useContractTx();
  return (
    <div className="card space-y-3 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-50">
        <EyeOff className="h-4 w-4 text-zinc-400" /> Moderasyon (admin)
      </div>
      <p className="text-xs text-zinc-500">
        Kötüye kullanım içeren projeleri herkese açık listelerden gizler; zincirdeki kayıtlar silinmez.
      </p>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={tx.busy}
        onClick={() =>
          tx.run("hide", () =>
            writeContractAsync({ ...projectRegistry, chainId: fuji.id, functionName: "setProjectHidden", args: [projectId, !hidden] }),
          )
        }
      >
        {tx.busy ? <Spinner className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} {hidden ? "Görünür yap" : "Projeyi gizle"}
      </button>
      {tx.error && <Notice tone="danger">{tx.error}</Notice>}
    </div>
  );
}

function UpdatesList({
  projectId,
  project,
  updates,
  canAttestStage,
  checkpoints,
  attesterLabel,
}: {
  projectId: bigint;
  project: Project;
  updates: readonly ProjectUpdate[];
  canAttestStage: (stage: number) => boolean;
  checkpoints: CheckpointInfo[];
  attesterLabel: (attester: Address) => string;
}) {
  const { writeContractAsync } = useWriteContract();
  const tx = useContractTx();

  if (updates.length === 0) {
    return <div className="card p-6 text-sm text-zinc-500">Henüz güncelleme yok. İlk kontrol noktası 3. ayda.</div>;
  }

  const checkpointOf = (index: number) => checkpoints.findIndex((c) => c.updateIndex === index);

  return (
    <div className="space-y-3">
      {[...updates.entries()].reverse().map(([index, update]) => {
        const cp = checkpointOf(index);
        const reward = pointsForAttest(update.stage, project.highestRewarded);
        return (
          <div key={index} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StageBadge stage={update.stage} attested={update.attested} />
                {cp >= 0 && (
                  <span className="chip">
                    {CHECKPOINT_NAMES[cp]} · {CHECKPOINT_LABELS.Completed}
                  </span>
                )}
              </div>
              <span className="font-mono text-xs text-zinc-500">{formatDateTime(update.timestamp)}</span>
            </div>
            {update.note && <p className="mt-2 break-words text-sm text-zinc-300">{update.note}</p>}
            {update.evidence && isHttpUrl(update.evidence) && (
              <a
                href={update.evidence}
                target="_blank"
                rel="noreferrer noopener nofollow"
                className="mt-2 inline-flex max-w-full items-center gap-1 truncate text-xs text-zinc-400 hover:text-zinc-200"
              >
                <FileText className="h-3 w-3 shrink-0" /> Kanıt: <span className="truncate">{update.evidence}</span>
              </a>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
              {update.attested ? (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" /> Onaylayan: {attesterLabel(update.attester)}
                </span>
              ) : (
                <span>Takım beyanı · bağımsız onay bekliyor</span>
              )}
              {canAttestStage(update.stage) && !update.attested && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={tx.busy}
                  onClick={() =>
                    tx.run(`attest-${index}`, () =>
                      writeContractAsync({
                        ...projectRegistry,
                        chainId: fuji.id,
                        functionName: "attestUpdate",
                        args: [projectId, BigInt(index)],
                      }),
                    )
                  }
                >
                  {tx.pending === `attest-${index}` ? <Spinner className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />} Onayla
                  {reward > 0 ? ` (üye başı +${reward} PS)` : ""}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {tx.error && <Notice tone="danger">{tx.error}</Notice>}
    </div>
  );
}

function UpdateForm({ projectId, highestRewarded }: { projectId: bigint; highestRewarded: number }) {
  const { writeContractAsync } = useWriteContract();
  const tx = useContractTx();
  const [stage, setStage] = useState<number>(1);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (byteLength(note) > 200) {
      tx.setError("Not en fazla 200 karakter olabilir.");
      return;
    }
    const proof = evidence.trim();
    if (!isHttpUrl(proof) || byteLength(proof) > 200) {
      tx.setError("Kanıt linki http(s) ile başlamalı ve en fazla 200 karakter olmalı.");
      return;
    }
    if (stage === 4 && !window.confirm("Proje 'Kapandı' olarak işaretlenecek. Bu kalıcıdır. Devam edilsin mi?")) return;
    const receipt = await tx.run("update", () =>
      writeContractAsync({
        ...projectRegistry,
        chainId: fuji.id,
        functionName: "postUpdate",
        args: [projectId, stage, note.trim(), proof],
      }),
    );
    if (receipt) {
      setNote("");
      setEvidence("");
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div className="flex items-center gap-3">
        <IconTile>
          <Send className="h-4 w-4" />
        </IconTile>
        <div>
          <h3 className="text-sm font-semibold text-zinc-50">Durum güncelle</h3>
          <p className="text-xs text-zinc-500">Kontrol noktası penceresinde girilen güncelleme o noktayı tamamlar.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {REPORTABLE_STAGES.map((s) => {
          const reward = pointsForAttest(s.value, highestRewarded);
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setStage(s.value)}
              className={
                stage === s.value
                  ? "rounded-lg border border-zinc-500 bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-50"
                  : "rounded-lg border border-zinc-800 px-3 py-2 text-left text-sm text-zinc-400 hover:border-zinc-700"
              }
            >
              {stageMeta(s.value).label}
              {reward > 0 ? <span className="ml-1 font-mono text-[11px] text-zinc-500">+{reward}</span> : null}
            </button>
          );
        })}
      </div>
      <label className="block">
        <span className="label">Not (herkese açık · opsiyonel)</span>
        <textarea
          className="input h-20 resize-none py-2"
          maxLength={200}
          placeholder="örn. 3 pilot müşteri, 1.200 aktif kullanıcı"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="label">Kanıt linki (opsiyonel · onaylayan kişinin kontrol etmesi için)</span>
        <input
          className="input font-mono"
          placeholder="https://… (haber, fatura özeti, demo, repo)"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      {tx.error && <Notice tone="danger">{tx.error}</Notice>}
      <button type="submit" className="btn-primary w-full" disabled={tx.busy}>
        {tx.busy ? <Spinner /> : <Send className="h-4 w-4" />} Güncellemeyi zincire yaz
      </button>
      <p className="text-xs text-zinc-500">
        Puanlar yalnızca bağımsız onaydan sonra verilir. {ATTESTER_RULES} &quot;Kapandı&quot; kalıcıdır ve dürüst bir sinyaldir;
        sessiz kalmak ise kaçırılmış kontrol noktası olarak görünür.
      </p>
    </form>
  );
}

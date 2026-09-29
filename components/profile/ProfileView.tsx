"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Ban,
  Blocks,
  CalendarDays,
  ExternalLink,
  Fingerprint,
  FolderKanban,
  MapPin,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Address, Hash } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { AvalancheLogo, LinkedInIcon, XIcon } from "@/components/brand/Logos";
import { badgeIcon, categoryIcon, tierIcon } from "@/components/credentials/icons";
import { ProfileProjects } from "@/components/profile/ProfileProjects";
import { Identicon } from "@/components/ui/Identicon";
import { AnimatedNumber, CopyButton, IconTile, Notice, SectionHeader, Spinner } from "@/components/ui/primitives";
import { SetupNotice } from "@/components/ui/SetupNotice";
import { OrganizerName } from "@/components/ui/VerifiedBadge";
import { BRAND } from "@/config/brand";
import { fuji } from "@/config/chain";
import {
  CREDENTIAL_PAGE_SIZE,
  POINTS_PER_CHECKIN,
  explorerAddressUrl,
  explorerTokenUrl,
  explorerTxUrl,
  isContractConfigured,
  isCredentialConfigured,
  isRegistryConfigured,
  proofSkill,
  type AttendanceRecord,
  type ProofEvent,
} from "@/config/contract";
import { categoryMeta, deriveBadges, deriveSkills, getTier, parseSkillTags } from "@/lib/credentials";
import { parseWeb3Error } from "@/lib/errors";
import { useAppUrl } from "@/lib/hooks";
import { cn, formatDate, shortenAddress, shortenHash } from "@/lib/utils";

type Credential = { event: ProofEvent; record: AttendanceRecord };

const EASE = [0.16, 1, 0.3, 1] as const;

export function ProfileView({ address }: { address: Address }) {
  const { address: connectedAddress } = useAccount();
  const isOwnProfile = connectedAddress?.toLowerCase() === address.toLowerCase();
  const publicClient = usePublicClient({ chainId: fuji.id });
  const appUrl = useAppUrl();

  // Newest first: page k covers [count - (k+1)*PAGE, count - k*PAGE). getUserCredentials pages oldest first.
  const [pagesShown, setPagesShown] = useState(1);
  const countQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "getUserEventCount",
    args: [address],
    query: { enabled: isContractConfigured },
  });
  const total = countQuery.data ?? 0n;
  const pageCalls = useMemo(() => {
    const calls: { offset: bigint; limit: bigint }[] = [];
    for (let k = 0n; k < BigInt(pagesShown); k++) {
      const end = total - k * CREDENTIAL_PAGE_SIZE;
      if (end <= 0n) break;
      const offset = end > CREDENTIAL_PAGE_SIZE ? end - CREDENTIAL_PAGE_SIZE : 0n;
      calls.push({ offset, limit: end - offset });
    }
    return calls;
  }, [total, pagesShown]);
  const credentialsQuery = useReadContracts({
    contracts: pageCalls.map(({ offset, limit }) => ({
      ...proofSkill,
      chainId: fuji.id,
      functionName: "getUserCredentials" as const,
      args: [address, offset, limit] as const,
    })),
    allowFailure: false,
    query: { enabled: isContractConfigured && pageCalls.length > 0, placeholderData: (previous) => previous },
  });
  const hasOlder = total > BigInt(pagesShown) * CREDENTIAL_PAGE_SIZE;
  const scoreQuery = useReadContracts({
    contracts: [
      { ...proofSkill, chainId: fuji.id, functionName: "getUserProofScore", args: [address] },
      { ...proofSkill, chainId: fuji.id, functionName: "validCredentialCount", args: [address] },
    ],
    allowFailure: false,
    query: { enabled: isContractConfigured },
  });
  const [rawScore, rawValidCount] = scoreQuery.data ?? [];

  const credentials = useMemo<Credential[]>(() => {
    if (!credentialsQuery.data) return [];
    return credentialsQuery.data
      .flatMap(([events, records]) => events.map((event, i) => ({ event, record: records[i] })))
      .sort((a, b) => Number(b.record.timestamp) - Number(a.record.timestamp));
  }, [credentialsQuery.data]);

  // The contract stores the block of every check-in, so each tx hash is a single-block log lookup.
  const txKey = credentials.map((c) => `${c.event.id}:${c.record.blockNumber}`).join(",");
  const txHashesQuery = useQuery({
    queryKey: ["attendance-tx-hashes", address, txKey],
    enabled: Boolean(publicClient) && credentials.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const entries = await Promise.all(
        credentials.map(async ({ event, record }) => {
          try {
            const logs = await publicClient!.getContractEvents({
              address: proofSkill.address,
              abi: proofSkill.abi,
              eventName: "AttendanceRecorded",
              args: { user: address, eventId: event.id },
              fromBlock: record.blockNumber,
              toBlock: record.blockNumber,
            });
            return [event.id.toString(), logs[0]?.transactionHash ?? null] as const;
          } catch {
            return [event.id.toString(), null] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, Hash | null>;
    },
  });

  // Revoked credentials stay visible (transparency) but never count toward skills, badges or stats.
  const validCredentials = useMemo(() => credentials.filter((c) => !c.record.revoked), [credentials]);
  const events = useMemo(() => validCredentials.map((c) => c.event), [validCredentials]);
  const skills = useMemo(() => deriveSkills(events), [events]);
  const badges = useMemo(() => deriveBadges(events), [events]);

  // Live issuer status: a blue tick is shown only while the issuing organizer is still verified.
  const creators = useMemo(() => [...new Set(credentials.map((c) => c.event.creator))], [credentials]);
  const issuerQuery = useReadContracts({
    contracts: creators.map((creator) => ({
      ...proofSkill,
      chainId: fuji.id,
      functionName: "isVerifiedOrganizer" as const,
      args: [creator] as const,
    })),
    allowFailure: false,
    query: { enabled: creators.length > 0 },
  });
  const issuerVerified = useMemo(() => {
    const map = new Map<string, boolean>();
    creators.forEach((creator, i) => map.set(creator.toLowerCase(), issuerQuery.data?.[i] ?? true));
    return map;
  }, [creators, issuerQuery.data]);

  if (!isContractConfigured) {
    return (
      <div className="page-shell py-12">
        <SetupNotice />
      </div>
    );
  }

  const score = Number(rawScore ?? 0n);
  const validCount = Number(rawValidCount ?? 0n);
  // Score = 25 per valid attendance + attested project milestones (both written only by the contracts).
  const attendancePoints = validCount * POINTS_PER_CHECKIN;
  const milestonePoints = Math.max(0, score - attendancePoints);
  const tier = getTier(score);
  const TierIcon = tierIcon(tier.current.id);
  const shareUrl = appUrl ? `${appUrl}/${address}` : null;
  const shareDisplay = appUrl ? `${new URL(appUrl).host}/${shortenAddress(address, 4)}` : "";
  const memberSince = credentials.length && !hasOlder ? credentials[credentials.length - 1].record.timestamp : null;
  const isLoading = countQuery.isLoading || credentialsQuery.isLoading || scoreQuery.isLoading;
  const verifiedIssuers = new Set(
    events.filter((e) => e.organizerVerified && issuerVerified.get(e.creator.toLowerCase())).map((e) => e.creator),
  ).size;

  return (
    <div className="page-shell space-y-10 py-10 sm:py-14">
      {/* ------------------------------------------------------------------ Identity */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="card overflow-hidden"
      >
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.35fr_1fr]">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="relative shrink-0 self-start">
              <div className="rounded-2xl border border-zinc-800 p-1">
                <Identicon address={address} size={84} className="block" />
              </div>
              <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border-[3px] border-background bg-zinc-50 text-zinc-950">
                <ShieldCheck className="h-3.5 w-3.5" />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="eyebrow">
                <Fingerprint className="h-3.5 w-3.5" /> Web3 CV
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <h1 className="font-mono text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[28px]">
                  {shortenAddress(address, 6)}
                </h1>
                <CopyButton value={address} iconOnly label="Adresi kopyala" />
                <a
                  href={explorerAddressUrl(address)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost h-8 w-8 !px-0"
                  title="SnowTrace'te görüntüle"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="chip border-zinc-700 text-zinc-100">
                  <TierIcon className="h-3.5 w-3.5" /> {tier.current.title}
                </span>
                <span className="chip">
                  <AvalancheLogo className="h-3.5 w-3.5" /> Verified on Avalanche
                </span>
                {isOwnProfile && <span className="chip">Sizin profiliniz</span>}
              </div>

              <dl className="mt-6 grid grid-cols-3 divide-x divide-zinc-800 rounded-lg border border-zinc-800 sm:max-w-md">
                <Stat label="Etkinlik" value={isLoading ? null : validCount} />
                <Stat label="Beceri" value={isLoading ? null : skills.length} />
                <Stat label="Doğrulanmış kurum" value={isLoading ? null : verifiedIssuers} />
              </dl>
              {memberSince && <p className="mt-3 text-xs text-zinc-500">İlk kanıt: {formatDate(memberSince)}</p>}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Proof Score</span>
              <Sparkles className="h-4 w-4 text-zinc-500" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              {scoreQuery.isLoading ? (
                <div className="skeleton h-12 w-28" />
              ) : (
                <AnimatedNumber value={score} className="text-5xl font-semibold tracking-tight text-zinc-50" />
              )}
              <span className="text-sm text-zinc-500">puan</span>
            </div>
            <div className="mt-5">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>{tier.current.title}</span>
                <span>{tier.next ? `${tier.next.title} · ${tier.next.min}` : "En üst seviye"}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <motion.div
                  className="h-full rounded-full bg-zinc-100"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round(tier.progress * 100)}%` }}
                  transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
                />
              </div>
              {!scoreQuery.isLoading && (
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-zinc-800 px-2.5 py-2">
                    <dt className="text-zinc-500">Katılım</dt>
                    <dd className="mt-0.5 font-mono text-zinc-200">
                      {attendancePoints} <span className="text-zinc-600">({validCount} × {POINTS_PER_CHECKIN})</span>
                    </dd>
                  </div>
                  <div className="rounded-md border border-zinc-800 px-2.5 py-2">
                    <dt className="text-zinc-500">Onaylı proje ilerlemesi</dt>
                    <dd className="mt-0.5 font-mono text-zinc-200">{milestonePoints}</dd>
                  </div>
                </dl>
              )}
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                Her doğrulanmış katılım +{POINTS_PER_CHECKIN} puan; bağımsız olarak onaylanan proje ilerlemesi (hâlâ aktif,
                ilk müşteri, yatırım) takım üyelerine ek puan kazandırır. Puanlar yalnızca kontratlar tarafından yazılabilir;
                iptal edilen kayıtların puanı geri alınır.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-zinc-800 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="eyebrow shrink-0">Share</span>
            <code className="truncate font-mono text-sm text-zinc-300">{shareDisplay || "…"}</code>
          </div>
          {shareUrl && (
            <div className="flex flex-wrap gap-2">
              <CopyButton value={shareUrl} label="Linki kopyala" className="btn-sm" />
              <a
                className="btn-secondary btn-sm"
                target="_blank"
                rel="noreferrer"
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                  `${BRAND.name} üzerinde doğrulanmış Web3 CV'm: ${score} Proof Score · ${tier.current.title}`,
                )}&url=${encodeURIComponent(shareUrl)}`}
              >
                <XIcon className="h-3.5 w-3.5" /> Paylaş
              </a>
              <a
                className="btn-secondary btn-sm"
                target="_blank"
                rel="noreferrer"
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
              >
                <LinkedInIcon className="h-3.5 w-3.5" /> LinkedIn
              </a>
            </div>
          )}
        </div>
      </motion.section>

      {credentialsQuery.error && (
        <Notice tone="danger" title="Zincir verisi okunamadı">
          {parseWeb3Error(credentialsQuery.error)}{" "}
          <button className="underline" onClick={() => credentialsQuery.refetch()}>
            Tekrar dene
          </button>
        </Notice>
      )}

      {/* ------------------------------------------------------------------ Verified activities */}
      <section>
        <SectionHeader
          eyebrow={
            <>
              <ShieldCheck className="h-3.5 w-3.5" /> Verified Activities
            </>
          }
          title="Doğrulanmış Etkinlikler"
          description="Her kayıt Avalanche Fuji üzerindeki onCV kontratından canlı okunur ve bir transaction ile kanıtlanır."
          action={
            <button className="btn-ghost btn-sm" onClick={() => credentialsQuery.refetch()}>
              <RefreshCw className={cn("h-3.5 w-3.5", credentialsQuery.isFetching && "animate-spin")} /> Yenile
            </button>
          }
        />

        {isLoading ? (
          <div className="grid gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="card h-36 p-5">
                <div className="skeleton h-3 w-28" />
                <div className="skeleton mt-4 h-5 w-2/3" />
                <div className="skeleton mt-3 h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : credentials.length === 0 ? (
          <EmptyState isOwnProfile={isOwnProfile} />
        ) : (
          <div className="grid gap-3">
            {credentials.map((credential, index) => (
              <CredentialCard
                key={credential.event.id.toString()}
                credential={credential}
                index={index}
                txHash={txHashesQuery.data?.[credential.event.id.toString()]}
                txLoading={txHashesQuery.isLoading}
                shareUrl={shareUrl}
                issuerVerified={issuerVerified.get(credential.event.creator.toLowerCase()) ?? true}
                isOwnProfile={isOwnProfile}
              />
            ))}
            {hasOlder && (
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => setPagesShown((p) => p + 1)}
                disabled={credentialsQuery.isFetching}
              >
                {credentialsQuery.isFetching ? <Spinner className="h-4 w-4" /> : null} Daha eski kayıtlar (
                {(total - BigInt(credentials.length)).toString()})
              </button>
            )}
          </div>
        )}
      </section>

      {isRegistryConfigured && <ProfileProjects address={address} />}

      {/* ------------------------------------------------------------------ Skills & badges */}
      {validCredentials.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card p-6">
            <SectionHeader
              eyebrow={
                <>
                  <Blocks className="h-3.5 w-3.5" /> Skills
                </>
              }
              title="Beceri alanları"
              description="Doğrulanmış katılımların etiketlerinden türetilir. Bir alandaki katılım yoğunluğunu gösterir; yetkinlik ölçümü değildir."
            />
            <ul className="space-y-4">
              {skills.map((skill, i) => (
                <li key={skill.label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-zinc-100">{skill.label}</span>
                    <span className="font-mono text-xs text-zinc-500" title={skill.events.join(" · ")}>
                      {skill.level} · {skill.count} etkinlik
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
                    <motion.div
                      className="h-full rounded-full bg-zinc-300"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${Math.min(100, (skill.count / 3) * 100)}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.7, delay: i * 0.04 }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-6">
            <SectionHeader
              eyebrow={
                <>
                  <Sparkles className="h-3.5 w-3.5" /> Badges
                </>
              }
              title="Rozetler"
              description="Etkinlik türlerine ve katılım geçmişine göre kazanılır."
            />
            <div className="grid gap-2 sm:grid-cols-2">
              {badges.map((badge, i) => {
                const Icon = badgeIcon(badge);
                return (
                  <motion.div
                    key={badge.id}
                    initial={{ opacity: 0, y: 6 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"
                  >
                    <IconTile className={badge.kind === "milestone" ? "text-brand-400" : undefined}>
                      <Icon className="h-4 w-4" />
                    </IconTile>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-100">
                        {badge.title}
                        {badge.count && badge.count > 1 ? (
                          <span className="ml-1 font-mono text-xs text-zinc-500">×{badge.count}</span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-zinc-500">{badge.description}</div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="text-[11px] text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg font-semibold text-zinc-50">
        {value === null ? <span className="skeleton inline-block h-5 w-6 align-middle" /> : value}
      </dd>
    </div>
  );
}

function CredentialCard({
  credential,
  index,
  txHash,
  txLoading,
  shareUrl,
  issuerVerified,
  isOwnProfile,
}: {
  credential: Credential;
  index: number;
  txHash: Hash | null | undefined;
  txLoading: boolean;
  shareUrl: string | null;
  issuerVerified: boolean;
  isOwnProfile: boolean;
}) {
  const { event, record } = credential;
  const revoked = record.revoked;
  const meta = categoryMeta(event.category);
  const Icon = categoryIcon(event.category);
  const tags = parseSkillTags(event.skillTags);
  const issued = new Date(Number(record.timestamp) * 1000);

  const linkedInUrl = `https://www.linkedin.com/profile/add?${new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: `${event.name} · Proof of Attendance`,
    organizationName: event.organizer || BRAND.name,
    issueYear: String(issued.getFullYear()),
    issueMonth: String(issued.getMonth() + 1),
    certUrl: txHash ? explorerTxUrl(txHash) : (shareUrl ?? ""),
    certId: txHash ?? `oncv-${event.id}`,
  }).toString()}`;

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: EASE }}
      className={cn("card card-hover", revoked && "opacity-60")}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <IconTile className="h-10 w-10">
              <Icon className="h-4 w-4" />
            </IconTile>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-zinc-500">
                <span>{meta.label}</span>
                <span className="text-zinc-700">/</span>
                {revoked ? (
                  <span className="inline-flex items-center gap-1 text-brand-400">
                    <Ban className="h-3.5 w-3.5" /> İptal edildi
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" /> Verified attendance
                  </span>
                )}
                {!issuerVerified && <span className="text-amber-300">· Kurum doğrulaması kaldırıldı</span>}
              </div>
              <h3 className="mt-1 text-base font-semibold leading-snug text-zinc-50">{event.name}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
                <OrganizerName name={event.organizer} verified={event.organizerVerified && issuerVerified} />
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-zinc-500" /> {formatDate(event.timestamp)}
                </span>
                {event.location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-zinc-500" /> {event.isOnline ? `Online · ${event.location}` : event.location}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className="self-start rounded-md border border-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300">
            {revoked ? "0 PS" : `+${POINTS_PER_CHECKIN} PS`}
          </span>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 sm:pl-14">
            {tags.map((tag) => (
              <span key={tag} className="chip">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-zinc-500">
            <span>
              tx{" "}
              {txHash ? <span className="text-zinc-300">{shortenHash(txHash)}</span> : txLoading ? "…" : "—"}
            </span>
            <span>block #{record.blockNumber.toLocaleString("tr-TR")}</span>
            {isCredentialConfigured && !revoked && (
              <a href={explorerTokenUrl(event.id)} target="_blank" rel="noreferrer" className="hover:text-zinc-300">
                SBT #{event.id.toString()}
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {isOwnProfile && isRegistryConfigured && !revoked && (
              <Link href={`/projects/new?eventId=${event.id}`} className="btn-ghost btn-sm">
                <FolderKanban className="h-3.5 w-3.5" /> Proje kaydet
              </Link>
            )}
            <a
              href={linkedInUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary btn-sm"
              title="LinkedIn profiline sertifika olarak ekle"
            >
              <LinkedInIcon className="h-3.5 w-3.5" /> LinkedIn&apos;e ekle
            </a>
            {txHash ? (
              <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                <AvalancheLogo className="h-3.5 w-3.5" /> View on SnowTrace <ExternalLink className="h-3 w-3 text-zinc-500" />
              </a>
            ) : (
              <span className="btn-secondary btn-sm pointer-events-none opacity-50">
                {txLoading ? <Spinner className="h-3.5 w-3.5" /> : <AvalancheLogo className="h-3.5 w-3.5" />} View on
                SnowTrace
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function EmptyState({ isOwnProfile }: { isOwnProfile: boolean }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <IconTile className="h-11 w-11">
        <ScanLine className="h-5 w-5" />
      </IconTile>
      <h3 className="mt-4 text-base font-semibold text-zinc-50">Henüz doğrulanmış etkinlik yok</h3>
      <p className="mt-1.5 max-w-md text-sm text-zinc-500">
        {isOwnProfile
          ? "Bir etkinlikte organizatör ekranındaki dinamik QR kodu okutun; katılımınız Avalanche'a yazılır ve burada görünür."
          : "Bu adres henüz bir onCV etkinliğine check-in yapmamış."}
      </p>
      {isOwnProfile && (
        <Link href="/check-in" className="btn-primary mt-6">
          <ScanLine className="h-4 w-4" /> Etkinlik Check-In
        </Link>
      )}
    </div>
  );
}

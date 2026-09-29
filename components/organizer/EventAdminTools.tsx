"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Download, EyeOff, FolderKanban, Users, UserX } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { StageBadge } from "@/components/projects/ProjectBits";
import { CopyButton, IconTile, Notice, Spinner } from "@/components/ui/primitives";
import { fuji } from "@/config/chain";
import { isRegistryConfigured, projectRegistry, proofSkill } from "@/config/contract";
import { parseWeb3Error } from "@/lib/errors";
import { useAppUrl } from "@/lib/hooks";
import { formatDateTime, shortenAddress } from "@/lib/utils";

/**
 * Per-event tools for the organizer: attendee list (with CSV export), project registration link, tracked
 * projects and credential revocation.
 */
export function EventAdminTools({ eventId }: { eventId: bigint }) {
  const [revokeTarget, setRevokeTarget] = useState("");
  return (
    <div className="space-y-4">
      <EventAttendees eventId={eventId} onRevoke={setRevokeTarget} />
      {isRegistryConfigured && <EventProjects eventId={eventId} />}
      <RevokeCredential eventId={eventId} target={revokeTarget} setTarget={setRevokeTarget} />
    </div>
  );
}

const ATTENDEE_PAGE = 25n;

function EventAttendees({ eventId, onRevoke }: { eventId: bigint; onRevoke: (address: string) => void }) {
  const publicClient = usePublicClient({ chainId: fuji.id });
  const [page, setPage] = useState(0n);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const countQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "getEventAttendeeCount",
    args: [eventId],
    query: { refetchInterval: 10_000 },
  });
  const total = countQuery.data ?? 0n;
  const pages = total === 0n ? 1n : (total + ATTENDEE_PAGE - 1n) / ATTENDEE_PAGE;
  const listQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "getEventAttendees",
    args: [eventId, page * ATTENDEE_PAGE, ATTENDEE_PAGE],
    query: { enabled: total > 0n, refetchInterval: 10_000, placeholderData: (previous) => previous },
  });
  const [attendees, records] = listQuery.data ?? [[], []];

  async function exportCsv() {
    if (!publicClient) return;
    setExporting(true);
    setExportError(null);
    try {
      const rows = ["address,checked_in_at_utc,block,status"];
      for (let offset = 0n; offset < total; offset += 100n) {
        const [list, recs] = await publicClient.readContract({
          ...proofSkill,
          functionName: "getEventAttendees",
          args: [eventId, offset, 100n],
        });
        list.forEach((address, i) => {
          const r = recs[i];
          rows.push(
            [address, new Date(Number(r.timestamp) * 1000).toISOString(), r.blockNumber.toString(), r.revoked ? "revoked" : "valid"].join(","),
          );
        });
      }
      const blob = new Blob([`${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `oncv-event-${eventId}-attendees.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(parseWeb3Error(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center gap-3">
          <IconTile>
            <Users className="h-4 w-4" />
          </IconTile>
          <div>
            <h3 className="text-sm font-semibold text-zinc-50">Katılımcılar</h3>
            <p className="text-xs text-zinc-500">{total.toString()} kayıt (iptal edilenler dahil) · check-in sırasına göre</p>
          </div>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={exportCsv} disabled={exporting || total === 0n}>
          {exporting ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />} CSV
        </button>
      </div>
      {exportError && <Notice tone="danger" className="m-4">{exportError}</Notice>}
      {total === 0n ? (
        <p className="p-5 text-sm text-zinc-500">Henüz check-in yok.</p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-800">
            {attendees.map((address, i) => {
              const record = records[i];
              return (
                <li key={address} className="flex items-center justify-between gap-3 px-5 py-2 text-xs">
                  <Link href={`/${address}`} className="font-mono text-zinc-300 hover:text-zinc-50">
                    {shortenAddress(address)}
                  </Link>
                  <span className="flex items-center gap-3">
                    <span className="text-zinc-500">{formatDateTime(record.timestamp)}</span>
                    {record.revoked ? (
                      <span className="text-brand-400">İptal edildi</span>
                    ) : (
                      <button type="button" className="btn-ghost !px-1.5 !py-0.5 text-[11px]" onClick={() => onRevoke(address)}>
                        <UserX className="h-3 w-3" /> İptal
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {pages > 1n && (
            <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-2 text-xs text-zinc-500">
              <button type="button" className="btn-ghost btn-sm" disabled={page === 0n} onClick={() => setPage((p) => p - 1n)}>
                Önceki
              </button>
              <span className="font-mono">
                {(page + 1n).toString()} / {pages.toString()}
              </span>
              <button type="button" className="btn-ghost btn-sm" disabled={page + 1n >= pages} onClick={() => setPage((p) => p + 1n)}>
                Sonraki
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EventProjects({ eventId }: { eventId: bigint }) {
  const appUrl = useAppUrl();
  const registerUrl = appUrl ? `${appUrl}/projects/new?eventId=${eventId}` : "";
  const idsQuery = useReadContract({
    ...projectRegistry,
    chainId: fuji.id,
    functionName: "getEventProjects",
    args: [eventId],
    query: { refetchInterval: 15_000 },
  });
  const ids = idsQuery.data ?? [];
  const projectsQuery = useReadContracts({
    contracts: ids.map((id) => ({ ...projectRegistry, chainId: fuji.id, functionName: "getProject" as const, args: [id] as const })),
    allowFailure: false,
    query: { enabled: ids.length > 0 },
  });
  const projects = [...(projectsQuery.data ?? [])].sort((a, b) => Number(b.id - a.id));
  const pending = projects.filter((p) => p.stage !== 0 && !p.stageAttested).length;

  return (
    <section className="card overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center gap-3">
          <IconTile>
            <FolderKanban className="h-4 w-4" />
          </IconTile>
          <div>
            <h3 className="text-sm font-semibold text-zinc-50">Proje takibi</h3>
            <p className="text-xs text-zinc-500">
              Takımlar projelerini kaydeder, 3. ve 6. ayda durum girer. &quot;Hâlâ aktif&quot; ve &quot;İlk müşteri&quot; beyanlarını
              siz onaylarsınız; &quot;Yatırım aldı&quot; doğrulanmış yatırımcı veya admin onayı ister.
            </p>
          </div>
        </div>
        {pending > 0 && <span className="chip border-amber-500/30 text-amber-300">{pending} onay bekliyor</span>}
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr]">
        {registerUrl && (
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-lg bg-white p-2">
              <QRCodeSVG value={registerUrl} size={96} marginSize={0} fgColor="#09090B" />
            </div>
            <CopyButton value={registerUrl} label="Kayıt linki" className="btn-sm" />
          </div>
        )}
        <div className="min-w-0">
          {idsQuery.isLoading || projectsQuery.isLoading ? (
            <Spinner className="h-4 w-4 text-zinc-500" />
          ) : projects.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Henüz kayıtlı proje yok. Etkinlik sonunda bu QR&apos;ı gösterin; katılımcılar etkinlik bitiminden sonraki 7
              gün içinde projelerini kaydedebilir.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {projects.map((p) => (
                <li key={p.id.toString()} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-100">
                      {p.title}
                      {p.hidden && <EyeOff className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-label="Gizlendi" />}
                    </div>
                    <div className="mt-1">
                      <StageBadge stage={p.stage} attested={p.stageAttested} />
                    </div>
                  </div>
                  <Link href={`/projects/${p.id}`} className="btn-ghost btn-sm shrink-0">
                    Takip <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function RevokeCredential({
  eventId,
  target,
  setTarget,
}: {
  eventId: bigint;
  target: string;
  setTarget: (value: string) => void;
}) {
  const { chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: fuji.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const valid = isAddress(target.trim(), { strict: false });

  async function revoke() {
    if (!valid || !publicClient) return;
    if (!window.confirm("Bu katılımcının kredansiyeli iptal edilecek: token yakılır, puanı ve varsa proje üyeliği kaldırılır. Geri alınamaz. Devam edilsin mi?")) return;
    setBusy(true);
    setMessage(null);
    try {
      if (chainId !== fuji.id) await switchChainAsync({ chainId: fuji.id });
      const hash = await writeContractAsync({
        ...proofSkill,
        chainId: fuji.id,
        functionName: "revokeCredential",
        args: [target.trim() as Address, eventId, reason.trim()],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("İşlem zincirde başarısız oldu.");
      await queryClient.invalidateQueries();
      setMessage({ tone: "success", text: "Kayıt iptal edildi; token yakıldı, puan ve proje üyeliği geri alındı." });
      setTarget("");
      setReason("");
    } catch (err) {
      setMessage({ tone: "danger", text: parseWeb3Error(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-50">
        <UserX className="h-4 w-4 text-zinc-400" /> Kayıt iptali
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Hatalı veya kötüye kullanımla alınmış bir katılımı iptal edin. Kayıt zincirde &quot;iptal edildi&quot; olarak kalır.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1.3fr_1fr_auto]">
        <input
          className="input font-mono"
          placeholder="Katılımcı cüzdanı 0x…"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <input className="input" placeholder="Gerekçe" maxLength={160} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="button" className="btn-secondary" onClick={revoke} disabled={!valid || busy}>
          {busy ? <Spinner /> : <UserX className="h-4 w-4" />} İptal et
        </button>
      </div>
      {message && (
        <Notice tone={message.tone} className="mt-3">
          {message.text}
        </Notice>
      )}
    </section>
  );
}

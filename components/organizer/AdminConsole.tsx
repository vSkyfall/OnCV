"use client";

import { motion } from "framer-motion";
import { CalendarRange, ChevronDown, KeyRound, Landmark, Pause, Play, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { IconTile, Notice, Spinner } from "@/components/ui/primitives";
import { OrganizerName } from "@/components/ui/VerifiedBadge";
import { fuji } from "@/config/chain";
import { isRegistryConfigured, projectRegistry, proofSkill } from "@/config/contract";
import { WALLETCONNECT_MISSING } from "@/config/wagmi";
import { isHttpUrl } from "@/lib/projects";
import { useContractTx } from "@/lib/use-tx";
import { cn, formatDateTime, shortenAddress } from "@/lib/utils";
import { AdminPanel } from "./AdminPanel";
import { EventAdminTools } from "./EventAdminTools";

/** Everything only the onCV admin can do: organizers, investors, moderation of all events, admin handover. */
export function AdminConsole() {
  const isLocal = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  return (
    <div className="space-y-6">
      {WALLETCONNECT_MISSING && !isLocal && (
        <Notice tone="warning" title="WalletConnect proje kimliği ayarlanmamış">
          <code className="font-mono">NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</code> boş; RainbowKit&apos;in demo kimliği yalnızca
          localhost&apos;ta çalışır. Masaüstünde OKX / MetaMask mobil ile QR bağlantısı başarısız olur. Ücretsiz kimliği
          cloud.reown.com&apos;dan alıp ortam değişkenine ekleyin.
        </Notice>
      )}
      <AdminPanel />
      {isRegistryConfigured && <InvestorManager />}
      <AllEvents />
      <AdminHandover />
    </div>
  );
}

function InvestorManager() {
  const { writeContractAsync } = useWriteContract();
  const tx = useContractTx();
  const [wallet, setWallet] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const candidate = wallet.trim() as Address;
  const valid = isAddress(candidate, { strict: false });

  const statusQuery = useReadContract({
    ...projectRegistry,
    chainId: fuji.id,
    functionName: "investors",
    args: [candidate],
    query: { enabled: valid },
  });
  const current = statusQuery.data;

  return (
    <section className="card overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center gap-3">
          <IconTile>
            <Landmark className="h-4 w-4" />
          </IconTile>
          <div>
            <h2 className="text-sm font-semibold text-zinc-50">Doğrulanmış yatırımcılar</h2>
            <p className="text-xs text-zinc-500">
              &quot;Yatırım aldı&quot; beyanlarını yalnızca doğrulanmış yatırımcılar (ve admin) onaylayabilir.
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-5">
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
          <input className="input font-mono" placeholder="Yatırımcı cüzdanı 0x…" value={wallet} onChange={(e) => setWallet(e.target.value)} />
          <input className="input" placeholder="Kurum adı (örn. Avalanche Ventures)" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input font-mono" placeholder="https://… (opsiyonel)" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        {valid && current && (
          <p className="text-xs text-zinc-500">
            Zincirdeki durum: {current[2] ? <span className="text-zinc-200">Aktif · {current[0]}</span> : "Kayıtlı değil / pasif"}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={!valid || !name.trim() || tx.busy}
            onClick={() => {
              if (!isHttpUrl(url.trim())) {
                tx.setError("Link http(s) ile başlamalı.");
                return;
              }
              void tx.run("add", () =>
                writeContractAsync({
                  ...projectRegistry,
                  chainId: fuji.id,
                  functionName: "addInvestor",
                  args: [candidate, name.trim(), url.trim()],
                }),
              );
            }}
          >
            {tx.pending === "add" ? <Spinner /> : <UserPlus className="h-4 w-4" />} Yatırımcıyı doğrula
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!valid || tx.busy}
            onClick={() =>
              tx.run("remove", () =>
                writeContractAsync({ ...projectRegistry, chainId: fuji.id, functionName: "removeInvestor", args: [candidate] }),
              )
            }
          >
            {tx.pending === "remove" ? <Spinner /> : <UserMinus className="h-4 w-4" />} Kaldır
          </button>
        </div>
        {tx.error && <Notice tone="danger">{tx.error}</Notice>}
      </div>
    </section>
  );
}

const EVENTS_PAGE = 10n;

function AllEvents() {
  const [page, setPage] = useState(0n);
  const [open, setOpen] = useState<bigint | null>(null);
  const { writeContractAsync } = useWriteContract();
  const tx = useContractTx();

  const countQuery = useReadContract({ ...proofSkill, chainId: fuji.id, functionName: "eventCount" });
  const total = countQuery.data ?? 0n;
  const pages = total === 0n ? 1n : (total + EVENTS_PAGE - 1n) / EVENTS_PAGE;
  const eventsQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "getLatestEvents",
    args: [page * EVENTS_PAGE, EVENTS_PAGE],
    query: { enabled: total > 0n, refetchInterval: 15_000, placeholderData: (previous) => previous },
  });
  const events = eventsQuery.data ?? [];
  const creatorsQuery = useReadContracts({
    contracts: events.map((e) => ({ ...proofSkill, chainId: fuji.id, functionName: "isVerifiedOrganizer" as const, args: [e.creator] as const })),
    allowFailure: false,
    query: { enabled: events.length > 0 },
  });

  return (
    <section className="card overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center gap-3">
          <IconTile>
            <CalendarRange className="h-4 w-4" />
          </IconTile>
          <div>
            <h2 className="text-sm font-semibold text-zinc-50">Tüm etkinlikler</h2>
            <p className="text-xs text-zinc-500">
              {total.toString()} etkinlik · Admin olarak herhangi bir etkinliği durdurabilir veya kayıt iptal edebilirsiniz; QR
              anahtarı yalnızca etkinliğin sahibindedir.
            </p>
          </div>
        </div>
      </div>
      {total === 0n ? (
        <p className="p-5 text-sm text-zinc-500">Henüz etkinlik yok.</p>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {events.map((event, i) => {
            const creatorVerified = creatorsQuery.data?.[i];
            const expanded = open === event.id;
            return (
              <li key={event.id.toString()}>
                <div className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
                      <span className="font-mono text-xs text-zinc-500">#{event.id.toString()}</span>
                      <span className="truncate font-medium">{event.name}</span>
                      {!event.isActive && <span className="chip">Durduruldu</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                      <OrganizerName name={event.organizer} verified={creatorVerified !== false} />
                      {creatorVerified === false && <span className="text-brand-400">doğrulaması kaldırıldı</span>}
                      <span>{formatDateTime(event.timestamp)}</span>
                      <span>{event.attendeeCount.toString()} katılımcı</span>
                      <span className="font-mono">{shortenAddress(event.creator)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={tx.busy}
                      onClick={() =>
                        tx.run(`toggle-${event.id}`, () =>
                          writeContractAsync({
                            ...proofSkill,
                            chainId: fuji.id,
                            functionName: "setEventActive",
                            args: [event.id, !event.isActive],
                          }),
                        )
                      }
                    >
                      {tx.pending === `toggle-${event.id}` ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : event.isActive ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {event.isActive ? "Durdur" : "Aktifleştir"}
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(expanded ? null : event.id)}>
                      Yönet <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                    </button>
                  </div>
                </div>
                {expanded && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-t border-zinc-800 bg-zinc-950/40 p-4">
                    <EventAdminTools eventId={event.id} />
                  </motion.div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {tx.error && <Notice tone="danger" className="m-4">{tx.error}</Notice>}
      {pages > 1n && (
        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-2 text-xs text-zinc-500">
          <button type="button" className="btn-ghost btn-sm" disabled={page === 0n} onClick={() => setPage((p) => p - 1n)}>
            Daha yeni
          </button>
          <span className="font-mono">
            {(page + 1n).toString()} / {pages.toString()}
          </span>
          <button type="button" className="btn-ghost btn-sm" disabled={page + 1n >= pages} onClick={() => setPage((p) => p + 1n)}>
            Daha eski
          </button>
        </div>
      )}
    </section>
  );
}

function AdminHandover() {
  const query = useReadContracts({
    contracts: [
      { ...proofSkill, chainId: fuji.id, functionName: "defaultAdmin" },
      { ...proofSkill, chainId: fuji.id, functionName: "pendingDefaultAdmin" },
      { ...proofSkill, chainId: fuji.id, functionName: "defaultAdminDelay" },
    ],
    allowFailure: false,
  });
  if (!query.data) return null;
  const [admin, [pending, schedule], delay] = query.data;
  const hasPending = pending !== "0x0000000000000000000000000000000000000000";

  return (
    <section className="card p-5 text-xs text-zinc-500">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-50">
        <KeyRound className="h-4 w-4 text-zinc-400" /> Admin yetkisi
      </div>
      <p className="mt-2">
        Mevcut admin: <span className="font-mono text-zinc-300">{admin}</span> · devir bekleme süresi{" "}
        {Math.round(Number(delay) / 3600)} saat.
      </p>
      {hasPending && (
        <p className="mt-1 text-amber-300">
          Bekleyen devir: <span className="font-mono">{pending}</span> · {formatDateTime(schedule)} sonrasında kabul edilebilir.
        </p>
      )}
      <p className="mt-2">
        Admin yetkisi iki adımlı ve gecikmeli devredilir (ör. bir Safe multisig&apos;e): <code className="font-mono">npm run admin:transfer</code>.
        Tek bir anahtarın çalınması durumunda bekleme süresi içinde devir iptal edilebilir.
      </p>
    </section>
  );
}

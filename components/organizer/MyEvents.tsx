"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CircleDot, Pause, Play, QrCode, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { categoryIcon } from "@/components/credentials/icons";
import { IconTile, Notice, SectionHeader, Spinner } from "@/components/ui/primitives";
import { OrganizerName } from "@/components/ui/VerifiedBadge";
import { CHECKIN_OPENS_BEFORE_SECONDS, proofSkill, type ProofEvent } from "@/config/contract";
import { fuji } from "@/config/chain";
import { parseWeb3Error } from "@/lib/errors";
import { useNow } from "@/lib/hooks";
import { cn, formatDateTime } from "@/lib/utils";

type Status = { label: string; className: string };

function eventStatus(event: ProofEvent, nowSec: number): Status {
  const start = Number(event.timestamp);
  const end = start + Number(event.durationHours) * 3600;
  if (!event.isActive) return { label: "Pasif", className: "text-zinc-500 [&>svg]:text-zinc-600" };
  if (nowSec > end) return { label: "Sona erdi", className: "text-zinc-500 [&>svg]:text-zinc-600" };
  if (nowSec + CHECKIN_OPENS_BEFORE_SECONDS < start)
    return { label: "Yaklaşan", className: "text-zinc-300 [&>svg]:text-zinc-400" };
  return { label: "Check-in açık", className: "text-zinc-100 [&>svg]:text-emerald-400" };
}

export function MyEvents({
  organizer,
  selectedId,
  onSelect,
}: {
  organizer: Address;
  selectedId: bigint | null;
  onSelect: (id: bigint) => void;
}) {
  const now = useNow(30_000);
  const idsQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "getOrganizerEvents",
    args: [organizer],
  });
  const [visible, setVisible] = useState(PAGE);
  const allIds = useMemo(() => idsQuery.data ?? [], [idsQuery.data]);
  // Newest first; getEvents accepts at most 100 ids per call, so the list is paged.
  const ids = useMemo(() => [...allIds].reverse().slice(0, visible), [allIds, visible]);
  const eventsQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "getEvents",
    args: [ids],
    query: { enabled: ids.length > 0, refetchInterval: 15_000, placeholderData: (previous) => previous },
  });
  const events = [...(eventsQuery.data ?? [])].sort((a, b) => Number(b.id - a.id));

  return (
    <section>
      <SectionHeader
        title="Etkinliklerim"
        description="Bu cüzdanla oluşturduğunuz etkinlikler. QR ekranını açmak için bir etkinlik seçin."
      />
      {idsQuery.isLoading || (ids.length > 0 && eventsQuery.isLoading) ? (
        <div className="card flex h-32 items-center justify-center">
          <Spinner className="h-5 w-5 text-zinc-500" />
        </div>
      ) : events.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-zinc-400">
          Henüz etkinlik oluşturmadınız. İlk etkinliğinizi yukarıdaki formla oluşturun.
        </div>
      ) : (
        <div className="grid gap-3">
          {events.map((event) => (
            <EventRow
              key={event.id.toString()}
              event={event}
              selected={selectedId === event.id}
              nowSec={now === null ? 0 : now / 1000}
              onSelect={() => onSelect(event.id)}
            />
          ))}
          {allIds.length > visible &&
            (visible < MAX_VISIBLE ? (
              <button type="button" className="btn-secondary w-full" onClick={() => setVisible((v) => Math.min(v + PAGE, MAX_VISIBLE))}>
                Daha eski etkinlikler ({allIds.length - visible})
              </button>
            ) : (
              <p className="text-center text-xs text-zinc-500">En yeni {MAX_VISIBLE} etkinlik gösteriliyor.</p>
            ))}
        </div>
      )}
    </section>
  );
}

const PAGE = 20;
/** ProofSkill.MAX_PAGE_SIZE: getEvents rejects larger id lists. */
const MAX_VISIBLE = 100;

function EventRow({
  event,
  selected,
  nowSec,
  onSelect,
}: {
  event: ProofEvent;
  selected: boolean;
  nowSec: number;
  onSelect: () => void;
}) {
  const { chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: fuji.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = nowSec ? eventStatus(event, nowSec) : null;
  const Icon = categoryIcon(event.category);

  async function toggleActive() {
    if (!publicClient) return;
    setBusy(true);
    setError(null);
    try {
      if (chainId !== fuji.id) await switchChainAsync({ chainId: fuji.id });
      const hash = await writeContractAsync({
        ...proofSkill,
        chainId: fuji.id,
        functionName: "setEventActive",
        args: [event.id, !event.isActive],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("İşlem zincirde başarısız oldu.");
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(parseWeb3Error(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "card flex flex-col gap-4 p-4 transition-colors sm:flex-row sm:items-center sm:justify-between",
        selected ? "border-zinc-600 bg-zinc-900/70" : "card-hover",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <IconTile>
          <Icon className="h-4 w-4" />
        </IconTile>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-50">{event.name}</span>
            {status && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border border-zinc-800 px-1.5 py-px text-[11px]",
                  status.className,
                )}
              >
                <CircleDot className="h-2.5 w-2.5" /> {status.label}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-500">
            <OrganizerName name={event.organizer} verified={event.organizerVerified} />
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3 w-3" /> {formatDateTime(event.timestamp)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" /> {event.attendeeCount.toString()}
              {event.maxAttendees > 0n ? ` / ${event.maxAttendees.toString()}` : ""} katılımcı
            </span>
            {event.isOnline && <span>Online</span>}
            <span className="font-mono">#{event.id.toString()}</span>
          </div>
          {error && <Notice tone="danger" className="mt-2 !py-2">{error}</Notice>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={toggleActive} disabled={busy}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : event.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {event.isActive ? "Durdur" : "Aktifleştir"}
        </button>
        <button type="button" className={cn(selected ? "btn-primary" : "btn-secondary", "btn-sm")} onClick={onSelect}>
          <QrCode className="h-3.5 w-3.5" /> QR ekranı
        </button>
      </div>
    </div>
  );
}

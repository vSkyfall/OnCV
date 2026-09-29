"use client";

import { useQuery } from "@tanstack/react-query";
import { Fuel } from "lucide-react";
import { GASLESS_CHECKIN } from "@/config/contract";
import { cn } from "@/lib/utils";

type Health = {
  enabled: boolean;
  balance?: string;
  lowBalance?: boolean;
  rpcOk?: boolean;
  eventTxUsed?: number;
  limits: { maxTxPerEvent: number; dailyTxLimit: number; minBalance: string };
};

/** Gasless relayer health for the organizer console: balance and this event's share of the budget. */
export function RelayerStatus({ eventId }: { eventId: bigint }) {
  const query = useQuery({
    queryKey: ["relayer-health", eventId.toString()],
    enabled: GASLESS_CHECKIN,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Health> => {
      const response = await fetch(`/api/relay/check-in?eventId=${eventId}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
  });
  if (!GASLESS_CHECKIN) return null;

  const h = query.data;
  const problem = query.isError || (h && (!h.enabled || h.lowBalance || h.rpcOk === false));
  const usedUp = h?.eventTxUsed !== undefined && h.eventTxUsed >= h.limits.maxTxPerEvent;

  let text = "Gassız check-in durumu okunuyor…";
  if (query.isError) text = "Relayer'a ulaşılamıyor; katılımcılar işlemi kendi cüzdanlarından gönderecek.";
  else if (h && !h.enabled) text = "Gassız check-in sunucuda kapalı; katılımcılar gas ücretini kendisi öder.";
  else if (h?.rpcOk === false) text = "Relayer ağa ulaşamıyor; katılımcılar kendi cüzdanlarından gönderecek.";
  else if (h?.lowBalance) text = `Relayer bakiyesi düşük (${Number(h.balance).toFixed(3)} AVAX); yakında cüzdan ödemesine geçilecek.`;
  else if (h)
    text = `Gassız check-in aktif · relayer ${Number(h.balance).toFixed(3)} AVAX · bu etkinlik ${h.eventTxUsed ?? 0}/${h.limits.maxTxPerEvent} işlem`;

  return (
    <div
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        problem || usedUp ? "border-amber-500/30 text-amber-200" : "border-zinc-800 text-zinc-400",
      )}
    >
      <Fuel className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{usedUp ? "Bu etkinliğin gassız işlem kotası doldu; katılımcılar kendi cüzdanlarından gönderecek." : text}</span>
    </div>
  );
}

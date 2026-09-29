"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleX, ScanLine, UserSquare2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { Address, Hash, Hex } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { QrScanner } from "@/components/checkin/LazyQrScanner";
import { Spinner } from "@/components/ui/primitives";
import { fuji } from "@/config/chain";
import { GASLESS_CHECKIN, proofSkill } from "@/config/contract";
import { parseKioskPass, signKioskAttest, type KioskPass } from "@/lib/checkin-code";
import { contractErrorMessage, parseWeb3Error } from "@/lib/errors";
import { cn, shortenAddress } from "@/lib/utils";

type Row = { attendee: Address; status: "pending" | "done" | "error"; message?: string; via?: "relayer" | "wallet" };

/**
 * Kiosk mode, organizer side: scans attendees' personal QR codes (signed KioskConsent), co-signs each with
 * the event's QR key (KioskAttest) and submits checkInViaKiosk. The relayer pays the gas when available;
 * otherwise the organizer's connected wallet submits (and pays) instead.
 */
export function KioskScanner({ eventId, signerKey }: { eventId: bigint; signerKey: Hex }) {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: fuji.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const seen = useRef(new Set<string>());

  const update = (attendee: Address, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.attendee === attendee ? { ...r, ...patch } : r)));

  const submit = useCallback(
    async (pass: KioskPass) => {
      const { attendee, deadline, signature } = pass;
      try {
        if (deadline * 1000n < BigInt(Date.now())) throw new Error("Katılımcının QR'ının süresi dolmuş; yenilemesini isteyin.");
        const kioskSignature = await signKioskAttest(signerKey, {
          chainId: fuji.id,
          contract: proofSkill.address,
          eventId,
          attendee,
          deadline,
        });

        let hash: Hash | null = null;
        let via: Row["via"] = "relayer";
        if (GASLESS_CHECKIN) {
          const response = await fetch("/api/relay/check-in", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "kiosk",
              attendee,
              eventId: eventId.toString(),
              deadline: deadline.toString(),
              attendeeSignature: signature,
              kioskSignature,
            }),
          }).catch(() => new Response(null, { status: 599 }));
          const body = (await response.json().catch(() => ({}))) as { hash?: Hash; error?: string; errorName?: string; fallback?: boolean };
          if (body.hash) hash = body.hash;
          else if (!body.fallback && response.status < 500) {
            throw new Error(contractErrorMessage(body.errorName, body.error ?? "Relayer işlemi gönderemedi."));
          }
        }
        if (!hash) {
          if (!address || !publicClient) throw new Error("Relayer kullanılamıyor; göndermek için cüzdanınızı bağlayın.");
          via = "wallet";
          if (chainId !== fuji.id) await switchChainAsync({ chainId: fuji.id });
          const args = [eventId, attendee, deadline, signature, kioskSignature] as const;
          await publicClient.simulateContract({ ...proofSkill, functionName: "checkInViaKiosk", args, account: address });
          hash = await writeContractAsync({ ...proofSkill, chainId: fuji.id, functionName: "checkInViaKiosk", args });
        }
        const receipt = await publicClient!.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("İşlem zincirde başarısız oldu.");
        update(attendee, { status: "done", via });
        void queryClient.invalidateQueries();
      } catch (err) {
        update(attendee, { status: "error", message: parseWeb3Error(err) });
        seen.current.delete(attendee.toLowerCase()); // allow a retry scan
      }
    },
    [address, chainId, eventId, publicClient, queryClient, signerKey, switchChainAsync, writeContractAsync],
  );

  const onResult = useCallback(
    (payload: string) => {
      const pass = parseKioskPass(payload);
      if (!pass) return false;
      const id = pass.attendee.toLowerCase();
      if (seen.current.has(id)) return true;
      seen.current.add(id);
      setRows((prev) => [{ attendee: pass.attendee, status: "pending" as const }, ...prev.filter((r) => r.attendee !== pass.attendee)].slice(0, 20));
      void submit(pass);
      return true;
    },
    [submit],
  );

  return (
    <div className="w-full space-y-3">
      {open ? (
        <QrScanner continuous onResult={onResult} onClose={() => setOpen(false)} rejectHint="Bu bir onCV kişisel katılımcı QR'ı değil." />
      ) : (
        <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)}>
          <UserSquare2 className="h-4 w-4" /> Kiosk modu · katılımcı QR&apos;ı okut
        </button>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {rows.map((row) => (
            <li key={row.attendee} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <span className="font-mono text-zinc-300">{shortenAddress(row.attendee)}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-right",
                  row.status === "done" && "text-emerald-400",
                  row.status === "error" && "text-brand-400",
                  row.status === "pending" && "text-zinc-500",
                )}
              >
                {row.status === "pending" && (
                  <>
                    <Spinner className="h-3 w-3" /> Gönderiliyor
                  </>
                )}
                {row.status === "done" && (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Kaydedildi{row.via === "wallet" ? " (cüzdanınızdan)" : ""}
                  </>
                )}
                {row.status === "error" && (
                  <>
                    <CircleX className="h-3.5 w-3.5 shrink-0" /> {row.message}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!open && rows.length === 0 && (
        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-500">
          <ScanLine className="h-3 w-3" /> Kamerası olmayan katılımcılar check-in sayfasından kişisel QR oluşturabilir.
        </p>
      )}
    </div>
  );
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  KeyRound,
  Lock,
  Maximize2,
  MapPin,
  Minimize2,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { OnCVMark } from "@/components/brand/Logos";
import { categoryIcon } from "@/components/credentials/icons";
import { AnimatedNumber, CopyButton, Notice, Spinner } from "@/components/ui/primitives";
import { OrganizerName } from "@/components/ui/VerifiedBadge";
import { fuji } from "@/config/chain";
import {
  CHECKIN_OPENS_BEFORE_SECONDS,
  QR_CODE_TTL_SECONDS,
  QR_ROTATION_SECONDS,
  proofSkill,
  type ProofEvent,
} from "@/config/contract";
import { buildCheckInUrl, currentCodeWindow, signCheckInCode } from "@/lib/checkin-code";
import { categoryMeta } from "@/lib/credentials";
import { parseWeb3Error } from "@/lib/errors";
import { useAppUrl, useIsClient, useNow } from "@/lib/hooks";
import {
  createSessionSigner,
  forgetSessionSigner,
  getSessionSignerKey,
  pruneSessionSigners,
  setSessionSignerExpiry,
} from "@/lib/session-keys";
import { KioskScanner } from "./KioskScanner";
import { RelayerStatus } from "./RelayerStatus";
import { cn, formatDateTime } from "@/lib/utils";

type SignedCode = { window: bigint; signature: Hex; url: string };

/**
 * Organizer screen: re-signs the check-in payload every QR_ROTATION_SECONDS with the event's ephemeral
 * signer key. The contract only accepts codes younger than QR_CODE_TTL_SECONDS.
 */
export function DynamicQRPanel({ eventId }: { eventId: bigint }) {
  const eventQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "getEvent",
    args: [eventId],
    query: { refetchInterval: 4_000 },
  });
  const event = eventQuery.data;
  const appUrl = useAppUrl();
  const now = useNow(250);
  const isClient = useIsClient();

  const [signerKey, setSignerKey] = useState<Hex | null>(null);
  const [code, setCode] = useState<SignedCode | null>(null);
  const [presenting, setPresenting] = useState(false);
  const lastSigned = useRef<string | null>(null);

  const signerAddress = event?.checkInSigner;
  const eventEnd = event ? Number(event.timestamp) + Number(event.durationHours) * 3600 : null;
  useEffect(() => {
    pruneSessionSigners();
    if (signerAddress && eventEnd !== null) setSessionSignerExpiry(signerAddress, eventEnd);
    setSignerKey(signerAddress ? getSessionSignerKey(signerAddress) : null);
    lastSigned.current = null;
  }, [signerAddress, eventEnd]);

  const codeWindow = now === null ? null : currentCodeWindow(now);

  useEffect(() => {
    if (!signerKey || codeWindow === null || !appUrl) return;
    const cacheKey = `${eventId}:${codeWindow}:${signerKey.slice(0, 10)}`;
    if (lastSigned.current === cacheKey) return;
    lastSigned.current = cacheKey;
    let cancelled = false;
    signCheckInCode(signerKey, { chainId: fuji.id, contract: proofSkill.address, eventId, codeWindow }).then(
      (signature) => {
        if (!cancelled) {
          setCode({ window: codeWindow, signature, url: buildCheckInUrl(appUrl, eventId, codeWindow, signature) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [signerKey, codeWindow, appUrl, eventId]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPresenting(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting]);

  if (eventQuery.isLoading) {
    return (
      <div className="card flex h-[520px] items-center justify-center">
        <Spinner className="h-5 w-5 text-zinc-500" />
      </div>
    );
  }
  if (!event) {
    return (
      <Notice tone="danger" title="Etkinlik okunamadı">
        {eventQuery.error ? parseWeb3Error(eventQuery.error) : "Etkinlik bulunamadı."}
      </Notice>
    );
  }

  const nowSec = now === null ? 0 : now / 1000;
  const startsAt = Number(event.timestamp);
  const endsAt = startsAt + Number(event.durationHours) * 3600;
  const ended = now !== null && nowSec > endsAt;
  const notOpen = now !== null && nowSec + CHECKIN_OPENS_BEFORE_SECONDS < startsAt;
  const secondsLeft = now === null ? QR_ROTATION_SECONDS : QR_ROTATION_SECONDS - (nowSec % QR_ROTATION_SECONDS);
  const full = event.maxAttendees > 0n && event.attendeeCount >= event.maxAttendees;
  const blocked = !event.isActive || ended;
  const isLocalhost = appUrl ? /localhost|127\.0\.0\.1|\[::1\]/.test(new URL(appUrl).hostname) : false;
  // A wrong NEXT_PUBLIC_APP_URL silently sends every scan to another site (e.g. a template default).
  const qrOrigin = appUrl ? new URL(appUrl).origin : null;
  const pageOrigin = typeof window === "undefined" ? null : window.location.origin;
  const originMismatch = !!qrOrigin && !!pageOrigin && qrOrigin !== pageOrigin && !isLocalhost;

  const qrBody = (size: number) =>
    signerKey && code ? (
      <div className="relative">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={code.window.toString()}
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0.5 }}
            transition={{ duration: 0.2 }}
            className={cn("rounded-xl bg-white p-4", blocked && "opacity-20 blur-sm")}
          >
            <QRCodeSVG value={code.url} size={size} level="M" bgColor="#FFFFFF" fgColor="#09090B" marginSize={0} />
          </motion.div>
        </AnimatePresence>
        {blocked && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-background/95 px-3 py-1.5 text-sm font-medium text-zinc-100">
              <Lock className="h-3.5 w-3.5" /> {ended ? "Etkinlik sona erdi" : "Check-in kapalı"}
            </span>
          </div>
        )}
      </div>
    ) : (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950"
        style={{ width: size + 32, height: size + 32 }}
      >
        {signerKey ? <Spinner className="h-5 w-5 text-zinc-600" /> : <KeyRound className="h-7 w-7 text-zinc-700" />}
      </div>
    );

  const countdown = (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <RefreshCw className="h-3 w-3" /> Kod yenileniyor
        </span>
        <span className="font-mono tabular-nums text-zinc-300">{Math.ceil(secondsLeft)}s</span>
      </div>
      <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-200 ease-linear"
          style={{ width: `${(secondsLeft / QR_ROTATION_SECONDS) * 100}%` }}
        />
      </div>
    </div>
  );

  const CategoryIcon = categoryIcon(event.category);

  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-xs text-zinc-500">
              <CategoryIcon className="h-3.5 w-3.5" /> {categoryMeta(event.category).label} · #{event.id.toString()}
            </div>
            <h3 className="mt-1 truncate text-base font-semibold text-zinc-50">{event.name}</h3>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
              <OrganizerName name={event.organizer} verified={event.organizerVerified} />
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5 text-zinc-500" /> {formatDateTime(event.timestamp)} ·{" "}
                {event.durationHours.toString()} saat
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-zinc-500" /> {event.isOnline ? `Online · ${event.location}` : event.location}
              </span>
            </div>
          </div>
          <div className="shrink-0 rounded-lg border border-zinc-800 px-3 py-2 text-center">
            <div className="flex items-center justify-center gap-1 text-[11px] text-zinc-500">
              <Users className="h-3 w-3" /> Katılımcı
            </div>
            <AnimatedNumber value={Number(event.attendeeCount)} className="font-mono text-xl font-semibold text-zinc-50" />
            {event.maxAttendees > 0n && <div className="font-mono text-[11px] text-zinc-500">/ {event.maxAttendees.toString()}</div>}
          </div>
        </div>

        <div className="flex flex-col items-center gap-5 p-6">
          {qrBody(240)}
          {signerKey && code && !blocked && countdown}

          {signerKey && code && (
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                sig {code.signature.slice(0, 10)}…{code.signature.slice(-6)} · w{code.window.toString()}
              </span>
              <div className="flex gap-2">
                <CopyButton value={code.url} label="Test linki" className="btn-sm" />
                <button type="button" className="btn-primary btn-sm" onClick={() => setPresenting(true)}>
                  <Maximize2 className="h-3.5 w-3.5" /> Sunum modu
                </button>
              </div>
            </div>
          )}

          {!signerKey && <MissingSignerNotice event={event} onRotated={setSignerKey} />}

          {signerKey && !blocked && !full && <KioskScanner eventId={eventId} signerKey={signerKey} />}
          {!blocked && <RelayerStatus eventId={eventId} />}

          {notOpen && !blocked && (
            <Notice tone="warning" className="w-full">
              Check-in, etkinlik başlangıcından 1 saat önce açılır. QR şimdiden hazır.
            </Notice>
          )}
          {full && !blocked && (
            <Notice tone="warning" className="w-full">
              Kontenjan doldu ({event.maxAttendees.toString()} kişi); kontrat yeni check-in kabul etmiyor.
            </Notice>
          )}
          {isLocalhost && (
            <Notice tone="warning" icon={<TriangleAlert className="h-4 w-4" />} className="w-full" title="QR localhost adresini içeriyor">
              Telefonlar bu adresi açamaz. Uygulamayı HTTPS ile yayınlayın (ör. Vercel) veya{" "}
              <code className="font-mono">NEXT_PUBLIC_APP_URL</code> ayarlayın.
            </Notice>
          )}
          {originMismatch && (
            <Notice tone="warning" icon={<TriangleAlert className="h-4 w-4" />} className="w-full" title="QR başka bir siteye yönlendiriyor">
              QR kodları <code className="font-mono">{qrOrigin}</code> adresini açıyor, bu sayfa ise{" "}
              <code className="font-mono">{pageOrigin}</code>. <code className="font-mono">NEXT_PUBLIC_APP_URL</code> değerini
              kendi yayın adresinizle değiştirin ya da boş bırakın.
            </Notice>
          )}
          <p className="text-center text-xs leading-relaxed text-zinc-500">
            QR her {QR_ROTATION_SECONDS} sn&apos;de yeniden imzalanır; kontrat {QR_CODE_TTL_SECONDS} sn&apos;den eski
            kodları reddeder.{" "}
            {event.isOnline
              ? "Online etkinlik: konum kontrolü yapılmaz."
              : "Katılımcı ayrıca 1 km konum doğrulamasından geçer."}
          </p>
        </div>
      </div>

      {/* Portal: a `position: fixed` overlay inside a transformed ancestor (the panel's entry animation) would
          be positioned against that ancestor instead of the viewport. */}
      {isClient &&
        createPortal(
      <AnimatePresence>
        {presenting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background p-6"
          >
            <button type="button" className="btn-secondary absolute right-5 top-5" onClick={() => setPresenting(false)}>
              <Minimize2 className="h-4 w-4" /> Kapat (Esc)
            </button>
            <div className="absolute left-6 top-6 flex items-center gap-2 text-sm text-zinc-400">
              <OnCVMark className="h-9 w-9" /> onCV · Verified Attendance
            </div>
            <div className="text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">{event.name}</h2>
              <p className="mt-3 inline-flex items-center gap-2 text-zinc-400">
                <OrganizerName name={event.organizer} verified={event.organizerVerified} badgeClassName="h-4 w-4" />
              </p>
            </div>
            {qrBody(Math.max(220, Math.min(560, typeof window === "undefined" ? 480 : window.innerHeight - 340)))}
            <div className="flex w-full max-w-md flex-col items-center gap-4">
              {!blocked && countdown}
              <div className="flex items-center gap-2 text-base text-zinc-400">
                <Users className="h-4 w-4" />
                <AnimatedNumber value={Number(event.attendeeCount)} className="font-mono font-semibold text-zinc-50" />{" "}
                katılım doğrulandı
              </div>
              <p className="text-sm text-zinc-500">Kamerayla okutun · Cüzdanla onaylayın · Web3 CV&apos;nize eklensin</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

function MissingSignerNotice({ event, onRotated }: { event: ProofEvent; onRotated: (key: Hex) => void }) {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: fuji.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the event's creator may rotate the QR key (admins cannot issue attendance on an organizer's behalf).
  const canManage = !!address && address.toLowerCase() === event.creator.toLowerCase();

  const rotate = useCallback(async () => {
    if (!address || !publicClient) return;
    setBusy(true);
    setError(null);
    const signer = createSessionSigner();
    try {
      if (chainId !== fuji.id) await switchChainAsync({ chainId: fuji.id });
      const hash = await writeContractAsync({
        ...proofSkill,
        chainId: fuji.id,
        functionName: "setCheckInSigner",
        args: [event.id, signer.address],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("İşlem zincirde başarısız oldu.");
      await queryClient.invalidateQueries();
      onRotated(signer.privateKey);
    } catch (err) {
      forgetSessionSigner(signer.address);
      setError(parseWeb3Error(err));
    } finally {
      setBusy(false);
    }
  }, [address, publicClient, chainId, switchChainAsync, writeContractAsync, event.id, queryClient, onRotated]);

  return (
    <div className="w-full space-y-3">
      <Notice tone="warning" icon={<KeyRound className="h-4 w-4" />} title="Bu cihazda QR imza anahtarı yok">
        Etkinlik başka bir cihazda oluşturulmuş. Bu cihazı QR ekranı yapmak için yeni bir imza anahtarı oluşturup
        zincire kaydedin; eski ekrandaki QR geçersiz olur.
      </Notice>
      {canManage ? (
        <button type="button" className="btn-primary w-full" onClick={rotate} disabled={busy}>
          {busy ? <Spinner /> : <KeyRound className="h-4 w-4" />} Bu cihazı QR ekranı yap
        </button>
      ) : (
        <p className="text-center text-xs text-zinc-500">
          Güvenlik gereği QR anahtarını yalnızca etkinliği oluşturan doğrulanmış organizatör yenileyebilir.
        </p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

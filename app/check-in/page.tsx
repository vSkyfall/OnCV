"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleX,
  Droplets,
  ExternalLink,
  Fingerprint,
  FolderKanban,
  LocateFixed,
  Lock,
  MapPin,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { encodePacked, keccak256, type Address, type Hash, type Hex } from "viem";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { AvalancheLogo, OkxLogo } from "@/components/brand/Logos";
import { KioskPassCard } from "@/components/checkin/KioskPassCard";
import { QrScanner } from "@/components/checkin/LazyQrScanner";
import { categoryIcon } from "@/components/credentials/icons";
import { IconTile, Notice, Spinner } from "@/components/ui/primitives";
import { SetupNotice } from "@/components/ui/SetupNotice";
import { OrganizerName } from "@/components/ui/VerifiedBadge";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import {
  CHECKIN_OPENS_BEFORE_SECONDS,
  CHECKIN_TYPES,
  FAUCET_URL,
  GASLESS_CHECKIN,
  GEOFENCE_RADIUS_KM,
  POINTS_PER_CHECKIN,
  QR_CODE_TTL_SECONDS,
  checkInDomain,
  explorerTxUrl,
  isContractConfigured,
  isRegistryConfigured,
  proofSkill,
} from "@/config/contract";
import { fuji } from "@/config/chain";
import {
  codeExpiresAt,
  extractCheckInQuery,
  parseCheckInParams,
  recoverCodeSigner,
  type CheckInParams,
} from "@/lib/checkin-code";
import { categoryMeta } from "@/lib/credentials";
import { contractErrorMessage, parseWeb3Error } from "@/lib/errors";
import { distanceKm, formatDistance, fromScaledCoordinate, geolocationErrorMessage, getCurrentPosition } from "@/lib/geo";
import { useClientEnv, useNow } from "@/lib/hooks";
import { cn, formatDateTime, shortenAddress, shortenHash } from "@/lib/utils";
import { metaMaskDappDeepLink, okxDappDeepLink } from "@/lib/wallet-env";

export default function CheckInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-32">
          <Spinner className="h-6 w-6 text-zinc-500" />
        </div>
      }
    >
      <CheckInRouter />
    </Suspense>
  );
}

function CheckInRouter() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const params = useMemo(() => parseCheckInParams(new URLSearchParams(query)), [query]);

  if (!isContractConfigured) {
    return (
      <div className="page-shell py-12">
        <SetupNotice />
      </div>
    );
  }
  if (params.eventId === null) return <ScanLanding />;
  return <CheckInFlow key={query} params={params} eventId={params.eventId} />;
}

// ---------------------------------------------------------------------------
// Landing (no QR payload yet)
// ---------------------------------------------------------------------------

function useScanHandler() {
  const router = useRouter();
  return useCallback(
    (payload: string) => {
      const query = extractCheckInQuery(payload);
      if (!query) return false;
      router.replace(`/check-in${query}`);
      return true;
    },
    [router],
  );
}

function ScanLanding() {
  const [scanning, setScanning] = useState(false);
  const handleScan = useScanHandler();
  const { isConnected } = useAccount();

  const steps: Array<{ icon: LucideIcon; title: string; text: string }> = [
    { icon: QrCode, title: "QR'ı okutun", text: "Organizatör ekranındaki, 10 sn'de bir yenilenen kodu okutun." },
    {
      icon: LocateFixed,
      title: "Konum doğrulaması",
      text: `Etkinlik alanına ${GEOFENCE_RADIUS_KM} km mesafede olmalısınız (online etkinliklerde atlanır).`,
    },
    { icon: Wallet, title: "Cüzdanla onaylayın", text: "OKX Wallet veya MetaMask ile Fuji'de işlemi imzalayın." },
    { icon: Fingerprint, title: "Web3 CV'ye eklenir", text: `Katılımınız zincire yazılır, +${POINTS_PER_CHECKIN} Proof Score.` },
  ];

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10 sm:py-14">
      <div className="text-center">
        <div className="eyebrow justify-center">
          <ScanLine className="h-3.5 w-3.5" /> Etkinlik Check-In
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">Katılımınızı zincire yazın</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Telefonunuzun kamerasıyla QR&apos;ı okuttuğunuzda bu sayfa otomatik açılır. Cüzdan tarayıcısındaysanız aşağıdan
          tarayabilirsiniz.
        </p>
      </div>

      <div className="mt-8">
        {scanning ? (
          <QrScanner onResult={handleScan} onClose={() => setScanning(false)} />
        ) : (
          <div className="card p-6">
            <button type="button" className="btn-primary btn-lg w-full" onClick={() => setScanning(true)}>
              <ScanLine className="h-5 w-5" /> QR Kodu Tara
            </button>
            {!isConnected && (
              <div className="mt-3">
                <ConnectWalletButton fullWidth size="lg" variant="secondary" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6">
        <KioskPassCard />
      </div>

      <ol className="card mt-6 divide-y divide-zinc-800">
        {steps.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="flex gap-4 p-4">
            <IconTile>
              <Icon className="h-4 w-4" />
            </IconTile>
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <span className="font-mono text-xs text-zinc-600">0{i + 1}</span> {title}
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">{text}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check-in flow
// ---------------------------------------------------------------------------

type GeoState =
  | { status: "idle" | "locating" }
  | { status: "ok" | "far"; distance: number; accuracy: number }
  | { status: "error"; message: string };

type Phase = "idle" | "switching" | "simulating" | "wallet" | "relaying" | "confirming" | "success";

const PHASE_LABEL: Record<Exclude<Phase, "idle" | "success">, string> = {
  switching: "Avalanche Fuji ağına geçiliyor…",
  simulating: "Kod ve katılım zincirde kontrol ediliyor…",
  wallet: GASLESS_CHECKIN ? "Cüzdanınızda imzalayın (gas ücreti yok)…" : "Cüzdanınızda işlemi onaylayın…",
  relaying: "onCV relayer işlemi gönderiyor…",
  confirming: "Avalanche Fuji'de onaylanıyor…",
};

const REDIRECT_SECONDS = 5;

async function celebrate() {
  const confetti = (await import("canvas-confetti")).default;
  // Restrained, on-brand palette: monochrome with the Avalanche red accent.
  const colors = ["#FAFAFA", "#FD9D7C", "#F56B54", "#DD3136", "#B31133"];
  const base = { colors, disableForReducedMotion: true, zIndex: 60, shapes: ["square" as const], scalar: 0.8 };
  confetti({ ...base, particleCount: 110, spread: 75, startVelocity: 40, origin: { y: 0.65 } });
  window.setTimeout(() => confetti({ ...base, particleCount: 50, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } }), 250);
  window.setTimeout(() => confetti({ ...base, particleCount: 50, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } }), 400);
}

function CheckInFlow({ params, eventId }: { params: CheckInParams; eventId: bigint }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { address, chainId, isConnected, connector } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient({ chainId: fuji.id });
  const clientEnv = useClientEnv();
  const now = useNow(1000);
  const handleScan = useScanHandler();

  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [phase, setPhase] = useState<Phase>("idle");
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [redirectIn, setRedirectIn] = useState(REDIRECT_SECONDS);
  const [rescanning, setRescanning] = useState(false);

  // ---- On-chain reads
  const eventQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "getEvent",
    args: [eventId],
    query: { retry: 1 },
  });
  const event = eventQuery.data;

  // The attendance record (timestamp 0 = none) also tells whether the credential was revoked.
  const recordQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "attendanceRecords",
    args: [
      keccak256(encodePacked(["address", "uint256"], [address ?? "0x0000000000000000000000000000000000000000", eventId])),
    ],
    query: { enabled: !!address },
  });
  const record = recordQuery.data;
  const balanceQuery = useBalance({ address, chainId: fuji.id, query: { enabled: !!address } });
  // The contract refuses check-ins for events whose organizer lost verified status.
  const organizerStatusQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "isVerifiedOrganizer",
    args: [event?.creator ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!event },
  });
  const organizerRevoked = organizerStatusQuery.data === false;

  // ---- Step 1: QR signature (verified locally against the event's on-chain signer)
  const { codeWindow, signature } = params;
  const signerQuery = useQuery({
    queryKey: ["qr-signer", eventId.toString(), codeWindow?.toString() ?? "", signature ?? ""],
    enabled: codeWindow !== null && !!signature,
    staleTime: Infinity,
    queryFn: () =>
      recoverCodeSigner({ chainId: fuji.id, contract: proofSkill.address, eventId, codeWindow: codeWindow! }, signature!),
  });
  const signatureValid =
    !!event && !!signerQuery.data && signerQuery.data.toLowerCase() === event.checkInSigner.toLowerCase();
  const expiresAt = codeWindow !== null ? codeExpiresAt(codeWindow) : 0;
  const secondsLeft = now === null ? null : Math.max(0, Math.floor(expiresAt - now / 1000));
  const codeExpired = secondsLeft !== null && secondsLeft <= 0;

  // ---- Step 2: geofence
  const verifyLocation = useCallback(async () => {
    if (!event) return;
    setGeo({ status: "locating" });
    try {
      const position = await getCurrentPosition();
      const distance = distanceKm(
        { lat: position.coords.latitude, lng: position.coords.longitude },
        { lat: fromScaledCoordinate(event.lat), lng: fromScaledCoordinate(event.long) },
      );
      setGeo({
        status: distance <= GEOFENCE_RADIUS_KM ? "ok" : "far",
        distance,
        accuracy: position.coords.accuracy,
      });
    } catch (err) {
      setGeo({ status: "error", message: geolocationErrorMessage(err) });
    }
  }, [event]);

  const autoLocated = useRef(false);
  useEffect(() => {
    // Online events have no venue: presence is proven by the rotating QR only.
    if (event && !event.isOnline && !autoLocated.current) {
      autoLocated.current = true;
      void verifyLocation();
    }
  }, [event, verifyLocation]);

  // ---- Timing
  const nowSec = now === null ? null : now / 1000;
  const startsAt = event ? Number(event.timestamp) : 0;
  const endsAt = event ? startsAt + Number(event.durationHours) * 3600 : 0;
  const notOpenYet = !!event && nowSec !== null && nowSec + CHECKIN_OPENS_BEFORE_SECONDS < startsAt;
  const ended = !!event && nowSec !== null && nowSec > endsAt;
  const full = !!event && event.maxAttendees > 0n && event.attendeeCount >= event.maxAttendees;
  const eventOpen = !!event && event.isActive && !notOpenYet && !ended && !organizerRevoked && !full;
  const locationOk = !!event && (event.isOnline || geo.status === "ok");

  // ---- Redirect after success
  useEffect(() => {
    if (phase !== "success") return;
    if (redirectIn <= 0) {
      router.push("/profile");
      return;
    }
    const id = window.setTimeout(() => setRedirectIn((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [phase, redirectIn, router]);

  const alreadyAttended = record !== undefined && record[0] > 0n;
  const revoked = alreadyAttended && record[2];
  const onFuji = chainId === fuji.id;
  // With the relayer enabled attendees need no AVAX at all (unless the relayer is unavailable).
  const noGas = !GASLESS_CHECKIN && balanceQuery.data?.value === 0n;
  const busy = phase !== "idle" && phase !== "success";
  const canClaim =
    signatureValid && !codeExpired && locationOk && isConnected && !alreadyAttended && eventOpen && !busy;
  const [relayNote, setRelayNote] = useState<string | null>(null);

  /**
   * Gasless path: the attendee signs an EIP-712 intent (free), the onCV relayer submits checkInWithSig.
   * Returns null when the relayer cannot help right now (disabled, low balance, budget used up, server or
   * network error) so the caller falls back to a normal transaction. Contract rejections are thrown.
   */
  async function relayCheckIn(attendee: Address, window: bigint, qrSignature: Hex): Promise<Hash | null> {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const attendeeSignature = await signTypedDataAsync({
      domain: checkInDomain(),
      types: CHECKIN_TYPES,
      primaryType: "CheckIn",
      message: { attendee, eventId, codeWindow: window, deadline },
    });
    setPhase("relaying");
    let response: Response;
    try {
      response = await fetch("/api/relay/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attendee,
          eventId: eventId.toString(),
          codeWindow: window.toString(),
          qrSignature,
          deadline: deadline.toString(),
          attendeeSignature,
        }),
      });
    } catch {
      response = new Response(null, { status: 599 });
    }
    const body = (await response.json().catch(() => ({}))) as {
      hash?: Hash;
      error?: string;
      errorName?: string;
      fallback?: boolean;
    };
    if (body.hash) return body.hash;
    if (body.fallback || response.status >= 500) {
      setRelayNote(body.error ?? "Gassız check-in şu an kullanılamıyor; işlem cüzdanınızdan gönderilecek.");
      setPhase("wallet");
      return null;
    }
    throw new Error(contractErrorMessage(body.errorName, body.error ?? "Relayer işlemi gönderemedi."));
  }

  async function claim() {
    if (!address || !publicClient || codeWindow === null || !signature) return;
    setClaimError(null);
    try {
      if (chainId !== fuji.id) {
        setPhase("switching");
        await switchChainAsync({ chainId: fuji.id });
      }
      const args = [eventId, codeWindow, signature] as const;
      setPhase("simulating");
      // Surfaces contract errors (expired code, already checked in...) before the wallet opens.
      await publicClient.simulateContract({ ...proofSkill, functionName: "checkIn", args, account: address });

      setPhase("wallet");
      const hash =
        (GASLESS_CHECKIN ? await relayCheckIn(address, codeWindow, signature) : null) ??
        (await writeContractAsync({ ...proofSkill, chainId: fuji.id, functionName: "checkIn", args }));
      setTxHash(hash);

      setPhase("confirming");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("İşlem zincirde başarısız oldu.");

      setPhase("success");
      void celebrate();
      void queryClient.invalidateQueries();
    } catch (err) {
      setClaimError(parseWeb3Error(err));
      setPhase("idle");
    }
  }

  // ---- Render
  if (eventQuery.isLoading) {
    return (
      <div className="flex justify-center py-32">
        <Spinner className="h-6 w-6 text-zinc-500" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-14">
        <Notice tone="danger" title="Etkinlik bulunamadı" icon={<CircleX className="h-4 w-4" />}>
          {eventQuery.error ? parseWeb3Error(eventQuery.error) : `#${eventId.toString()} numaralı etkinlik bulunamadı.`}
        </Notice>
        <Link href="/check-in" className="btn-secondary mt-4 w-full">
          <ScanLine className="h-4 w-4" /> Yeni QR tara
        </Link>
      </div>
    );
  }

  const CategoryIcon = categoryIcon(event.category);

  const qrStep: StepProps = !signature || codeWindow === null
    ? { state: "error", title: "QR kodu eksik", description: "Bu link imzasız. Organizatör ekranındaki QR kodunu okutun." }
    : signerQuery.isLoading
      ? { state: "loading", title: "QR imzası doğrulanıyor" }
      : !signatureValid
        ? { state: "error", title: "QR imzası geçersiz", description: "Kod bu etkinliğin organizatör ekranı tarafından imzalanmamış." }
        : codeExpired
          ? { state: "error", title: "QR kodunun süresi doldu", description: "Ekrandaki güncel QR kodunu tekrar okutun." }
          : {
              state: "done",
              title: "Dinamik QR doğrulandı",
              description: `Organizatör imzalı · ${secondsLeft ?? QR_CODE_TTL_SECONDS} sn daha geçerli`,
            };

  const geoStep: StepProps = event.isOnline
    ? { state: "done", title: "Online etkinlik", description: "Konum kontrolü yok; katılım yalnızca canlı QR ile kanıtlanır." }
    : geo.status === "ok"
      ? {
          state: "done",
          title: "Konum doğrulandı",
          description: `Etkinlik alanına ${formatDistance(geo.distance)} · ${GEOFENCE_RADIUS_KM} km sınırı içinde`,
        }
      : geo.status === "far"
        ? {
            state: "error",
            title: "Etkinlik alanının dışındasınız",
            description: `Mesafe ${formatDistance(geo.distance)} (sınır ${GEOFENCE_RADIUS_KM} km, doğruluk ±${Math.round(geo.accuracy)} m)`,
            action: <RetryButton onClick={verifyLocation} />,
          }
        : geo.status === "error"
          ? { state: "error", title: "Konum alınamadı", description: geo.message, action: <RetryButton onClick={verifyLocation} /> }
          : { state: "loading", title: "Konumunuz doğrulanıyor", description: "Tarayıcı konum izni isteyebilir." };

  const walletStep: StepProps = isConnected
    ? {
        state: "done",
        title: `${connector?.name ?? "Cüzdan"} bağlı`,
        description: address ? shortenAddress(address) : undefined,
      }
    : { state: "active", title: "Cüzdanınızı bağlayın", description: "OKX Wallet önerilir · MetaMask desteklenir" };

  const networkStep: StepProps = !isConnected
    ? { state: "pending", title: "Avalanche Fuji Testnet" }
    : noGas
      ? {
          state: "error",
          title: "Gas için Fuji AVAX gerekli",
          description: "Faucet'ten ücretsiz test AVAX alın, ardından tekrar deneyin.",
          action: (
            <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
              <Droplets className="h-3.5 w-3.5" /> Faucet
            </a>
          ),
        }
      : {
          state: onFuji ? "done" : "active",
          title: onFuji ? "Avalanche Fuji Testnet" : "Fuji ağına geçilecek",
          description: GASLESS_CHECKIN
            ? "Gassız check-in · işlem ücretini onCV öder"
            : balanceQuery.data
              ? `Bakiye: ${Number(balanceQuery.data.formatted).toLocaleString("tr-TR", { maximumFractionDigits: 4 })} AVAX`
              : undefined,
        };

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:py-12">
      {/* Event header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
        <div className="flex items-start gap-4">
          <IconTile className="h-11 w-11">
            <CategoryIcon className="h-5 w-5" />
          </IconTile>
          <div className="min-w-0">
            <div className="font-mono text-xs text-zinc-500">
              {categoryMeta(event.category).label} · #{event.id.toString()}
            </div>
            <h1 className="mt-0.5 text-lg font-semibold leading-snug text-zinc-50">{event.name}</h1>
            <OrganizerName
              name={event.organizer}
              verified={event.organizerVerified && !organizerRevoked}
              className="mt-1 text-sm text-zinc-300"
            />
            <div className="mt-2 flex flex-col gap-1 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" /> {formatDateTime(event.timestamp)} · {event.durationHours.toString()} saat
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> {event.isOnline ? `Online · ${event.location}` : event.location}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> {event.attendeeCount.toString()} doğrulanmış katılımcı
                {event.maxAttendees > 0n && ` / ${event.maxAttendees.toString()} kontenjan`}
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {phase === "success" ? (
          <SuccessCard key="success" txHash={txHash} redirectIn={redirectIn} eventId={eventId} />
        ) : revoked ? (
          <motion.div key="revoked" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card mt-4 p-6 text-center">
            <CircleX className="mx-auto h-9 w-9 text-brand-400" />
            <h2 className="mt-3 text-base font-semibold text-zinc-50">Bu etkinlikteki kaydınız iptal edildi</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Organizatör veya onCV admini katılım kaydınızı iptal etti; kredansiyel ve puanı Web3 CV&apos;nizden kaldırıldı.
              Aynı etkinliğe yeniden check-in yapılamaz. Bir hata olduğunu düşünüyorsanız organizatörle iletişime geçin.
            </p>
            <Link href="/profile" className="btn-secondary mt-5 w-full">
              Web3 CV&apos;ye git <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>
        ) : alreadyAttended ? (
          <motion.div key="attended" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card mt-4 p-6 text-center">
            <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-400" />
            <h2 className="mt-3 text-base font-semibold text-zinc-50">Bu etkinlik zaten Web3 CV&apos;nizde</h2>
            <p className="mt-1 text-sm text-zinc-500">Katılımınız daha önce Avalanche Fuji&apos;de doğrulandı.</p>
            <Link href="/profile" className="btn-primary mt-5 w-full">
              Web3 CV&apos;ye git <ArrowRight className="h-4 w-4" />
            </Link>
            {isRegistryConfigured && (
              <Link href={`/projects/new?eventId=${eventId}`} className="btn-secondary mt-2 w-full">
                <FolderKanban className="h-4 w-4" /> Projeni kaydet · 3. ve 6. ay takibi
              </Link>
            )}
          </motion.div>
        ) : (
          <motion.div key="flow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Code validity bar */}
            {signatureValid && !codeExpired && secondsLeft !== null && (
              <div className="mt-4 px-1">
                <div className="flex justify-between text-[11px] text-zinc-500">
                  <span>QR kodu geçerlilik süresi</span>
                  <span className="font-mono tabular-nums">{secondsLeft} sn</span>
                </div>
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-1000 ease-linear",
                      secondsLeft < 20 ? "bg-brand-500" : "bg-zinc-300",
                    )}
                    style={{ width: `${Math.min(100, (secondsLeft / (QR_CODE_TTL_SECONDS + 10)) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <ol className="card mt-4 divide-y divide-zinc-800">
              <Step icon={QrCode} {...qrStep} />
              <Step icon={LocateFixed} {...geoStep} />
              <Step icon={Wallet} {...walletStep} />
              <Step icon={Fingerprint} {...networkStep} />
            </ol>

            {!event.isActive && (
              <Notice tone="warning" className="mt-4">Organizatör bu etkinlik için check-in&apos;i durdurdu.</Notice>
            )}
            {notOpenYet && (
              <Notice tone="warning" className="mt-4">
                Check-in, etkinlik başlangıcından 1 saat önce açılır ({formatDateTime(startsAt - CHECKIN_OPENS_BEFORE_SECONDS)}).
              </Notice>
            )}
            {ended && <Notice tone="warning" className="mt-4">Etkinlik sona erdi; check-in kapandı.</Notice>}
            {full && !ended && (
              <Notice tone="warning" className="mt-4">
                Etkinlik kontenjanı ({event.maxAttendees.toString()} kişi) doldu; yeni check-in kabul edilmiyor.
              </Notice>
            )}
            {organizerRevoked && (
              <Notice tone="danger" className="mt-4" icon={<Lock className="h-4 w-4" />} title="Organizer verification revoked">
                Bu etkinliğin organizatörünün doğrulaması kaldırıldı; yeni check-in kabul edilmiyor.
              </Notice>
            )}

            <div className="mt-5 space-y-3">
              {!isConnected ? (
                <>
                  <button type="button" className="btn-primary btn-lg w-full" onClick={openConnectModal}>
                    <OkxLogo className="h-5 w-5" /> OKX Wallet ile bağlan
                  </button>
                  {clientEnv?.mobile && !clientEnv.injected && (
                    <div className="grid grid-cols-2 gap-2">
                      <a href={okxDappDeepLink(clientEnv.href)} className="btn-secondary text-xs">
                        <OkxLogo className="h-4 w-4" /> OKX uygulamasında aç
                      </a>
                      <a href={metaMaskDappDeepLink(clientEnv.href)} className="btn-secondary text-xs">
                        <Smartphone className="h-4 w-4" /> MetaMask&apos;ta aç
                      </a>
                    </div>
                  )}
                </>
              ) : (
                <button type="button" className="btn-accent btn-lg h-14 w-full" onClick={claim} disabled={!canClaim}>
                  {busy ? <Spinner className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                  <span className="flex flex-col items-start leading-tight">
                    <span>{busy ? PHASE_LABEL[phase as keyof typeof PHASE_LABEL] : "Claim & Verify Attendance"}</span>
                    {!busy && (
                      <span className="text-[11px] font-normal text-white/75">
                        +{POINTS_PER_CHECKIN} Proof Score · Avalanche Fuji
                      </span>
                    )}
                  </span>
                </button>
              )}

              {txHash && busy && (
                <a
                  href={explorerTxUrl(txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1 font-mono text-xs text-zinc-400 hover:text-zinc-200"
                >
                  {shortenHash(txHash)} <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
              {relayNote && busy && <Notice tone="info">{relayNote}</Notice>}
              {claimError && (
                <Notice tone="danger" icon={<CircleX className="h-4 w-4" />}>
                  {claimError}
                </Notice>
              )}

              {(codeExpired || rescanning) &&
                (rescanning ? (
                  <QrScanner onResult={handleScan} onClose={() => setRescanning(false)} />
                ) : (
                  <button type="button" className="btn-secondary w-full" onClick={() => setRescanning(true)}>
                    <ScanLine className="h-4 w-4" /> Güncel QR&apos;ı tara
                  </button>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-500">
        <AvalancheLogo className="h-3.5 w-3.5" /> Kontrat QR imzasını ve süresini zincir üzerinde yeniden doğrular.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UI pieces
// ---------------------------------------------------------------------------

type StepState = "done" | "active" | "loading" | "error" | "pending";

type StepProps = {
  state: StepState;
  title: string;
  description?: string;
  action?: ReactNode;
};

function Step({ icon: Icon, state, title, description, action }: StepProps & { icon: LucideIcon }) {
  const indicator = {
    done: <CheckCircle2 className="h-[18px] w-[18px] text-emerald-400" />,
    error: <CircleX className="h-[18px] w-[18px] text-brand-400" />,
    loading: <Spinner className="h-[18px] w-[18px] text-zinc-400" />,
    active: <span className="h-2 w-2 animate-pulse-dot rounded-full bg-zinc-200" />,
    pending: <span className="h-2 w-2 rounded-full bg-zinc-700" />,
  }[state];

  return (
    <li className="flex items-center gap-4 p-4">
      <IconTile
        className={cn(
          state === "done" && "text-zinc-100",
          state === "error" && "border-brand-500/30 text-brand-400",
          state === "pending" && "text-zinc-600",
        )}
      >
        <Icon className="h-4 w-4" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", state === "pending" ? "text-zinc-500" : "text-zinc-50")}>{title}</div>
        {description && <div className="mt-0.5 text-xs text-zinc-500">{description}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      <div className="flex w-5 shrink-0 justify-center">{indicator}</div>
    </li>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="btn-secondary btn-sm">
      <RefreshCw className="h-3.5 w-3.5" /> Tekrar dene
    </button>
  );
}

function SuccessCard({ txHash, redirectIn, eventId }: { txHash: Hash | null; redirectIn: number; eventId: bigint }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className="card mt-4 p-7 text-center"
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.1 }}
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      >
        <CheckCircle2 className="h-7 w-7" />
      </motion.div>
      <h2 className="mt-5 text-xl font-semibold tracking-tight text-zinc-50">Attendance verified</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Kaydınız Avalanche Fuji&apos;ye yazıldı ·{" "}
        <span className="font-mono text-zinc-100">+{POINTS_PER_CHECKIN} Proof Score</span>
      </p>
      {txHash && (
        <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer" className="btn-secondary mt-6 w-full">
          <AvalancheLogo className="h-4 w-4" /> View on SnowTrace <ExternalLink className="h-3.5 w-3.5 text-zinc-500" />
        </a>
      )}
      <Link href="/profile" className="btn-primary mt-2 w-full">
        Web3 CV&apos;ye git <ArrowRight className="h-4 w-4" />
      </Link>
      {isRegistryConfigured && (
        <Link href={`/projects/new?eventId=${eventId}`} className="btn-ghost mt-2 w-full">
          <FolderKanban className="h-4 w-4" /> Projeni kaydet
        </Link>
      )}
      <p className="mt-4 text-xs text-zinc-500">
        {redirectIn > 0 ? `${redirectIn} sn içinde Web3 CV'nize yönlendiriliyorsunuz…` : "Yönlendiriliyor…"}
      </p>
    </motion.div>
  );
}

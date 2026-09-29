"use client";

import { motion } from "framer-motion";
import {
  Building2,
  CircleCheck,
  ExternalLink,
  Lock,
  Mail,
  QrCode,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import dynamic from "next/dynamic";
import { EventAdminTools } from "@/components/organizer/EventAdminTools";
import { CreateEventForm } from "@/components/organizer/CreateEventForm";
import { DynamicQRPanel } from "@/components/organizer/DynamicQRPanel";
import { MyEvents } from "@/components/organizer/MyEvents";
import { CopyButton, IconTile, Notice, Spinner } from "@/components/ui/primitives";
import { SetupNotice } from "@/components/ui/SetupNotice";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { BRAND, VERIFICATION_EMAIL } from "@/config/brand";
import { fuji } from "@/config/chain";
import { PROOFSKILL_ADDRESS, explorerAddressUrl, isContractConfigured, proofSkill } from "@/config/contract";
import { shortenAddress } from "@/lib/utils";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

// Admin-only tools are downloaded only for admin wallets.
const AdminConsole = dynamic(() => import("@/components/organizer/AdminConsole").then((m) => m.AdminConsole), {
  ssr: false,
  loading: () => (
    <div className="card flex h-32 items-center justify-center">
      <Spinner className="h-5 w-5 text-zinc-500" />
    </div>
  ),
});

export default function OrganizerPage() {
  const { address, status } = useAccount();
  const [selectedEventId, setSelectedEventId] = useState<bigint | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  const verifiedQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "isVerifiedOrganizer",
    args: [address ?? ZERO],
    query: { enabled: isContractConfigured && !!address },
  });
  const adminQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "isAdmin",
    args: [address ?? ZERO],
    query: { enabled: isContractConfigured && !!address },
  });
  const profileQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "organizerProfiles",
    args: [address ?? ZERO],
    query: { enabled: isContractConfigured && !!address },
  });

  useEffect(() => {
    setSelectedEventId(null);
  }, [address]);

  function selectEvent(id: bigint) {
    setSelectedEventId(id);
    window.setTimeout(() => qrRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const header = (
    <div className="mb-8">
      <div className="eyebrow">
        <Building2 className="h-3.5 w-3.5" /> Enterprise Portal · Organizatör ve admin
      </div>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
        Etkinlik oluşturun, dinamik QR ile doğrulayın
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
        Yalnızca {BRAND.name} tarafından doğrulanmış kurumlar etkinlik yayınlayabilir. QR kodu her 10 saniyede
        cihazınızdaki geçici anahtarla yeniden imzalanır; ekran görüntüsüyle veya uzaktan sahte check-in yapılamaz.
      </p>
    </div>
  );

  if (!isContractConfigured) {
    return (
      <div className="page-shell py-12">
        {header}
        <SetupNotice />
      </div>
    );
  }

  if (!address) {
    return (
      <div className="page-shell py-12">
        {header}
        <div className="card mx-auto flex max-w-lg flex-col items-center p-10 text-center">
          {status === "reconnecting" || status === "connecting" ? (
            <Spinner className="h-5 w-5 text-zinc-500" />
          ) : (
            <>
              <IconTile className="h-11 w-11">
                <Lock className="h-5 w-5" />
              </IconTile>
              <h2 className="mt-4 text-base font-semibold text-zinc-50">Enterprise Portal girişi</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Devam etmek için doğrulanmış kurum (organizatör) veya admin cüzdanınızı bağlayın. Erişim zincirdeki
                doğrulama kaydına göre verilir.
              </p>
              <div className="mt-6">
                <ConnectWalletButton size="lg" />
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (verifiedQuery.isLoading || adminQuery.isLoading) {
    return (
      <div className="page-shell py-12">
        {header}
        <div className="flex justify-center py-20">
          <Spinner className="h-5 w-5 text-zinc-500" />
        </div>
      </div>
    );
  }

  const isVerified = verifiedQuery.data === true;
  const isAdmin = adminQuery.data === true;

  if (!isVerified) {
    return (
      <div className="page-shell py-12">
        {header}
        <UnverifiedOrganizer address={address} />
        {isAdmin && (
          <div className="mx-auto mt-6 max-w-3xl space-y-4">
            <Notice tone="info" icon={<ShieldCheck className="h-4 w-4" />} title="Admin hesabı">
              Bu cüzdan admin yetkisine sahip ancak organizatör olarak doğrulanmamış. Etkinlik oluşturmak için aşağıdan
              kendi adresinizi doğrulayabilirsiniz.
            </Notice>
            <AdminConsole />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page-shell py-12">
      {header}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-xs font-medium text-zinc-100">
          <VerifiedBadge className="h-3.5 w-3.5" /> {profileQuery.data?.[0] || "Verified Organizer"}
        </span>
        {profileQuery.data?.[1] && <span className="chip font-mono">{profileQuery.data[1]}</span>}
        {isAdmin && (
          <span className="chip">
            <ShieldCheck className="h-3.5 w-3.5" /> Admin
          </span>
        )}
        <span className="font-mono text-xs text-zinc-500">{shortenAddress(address, 6)}</span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_1fr]">
        <CreateEventForm onCreated={selectEvent} />
        <div ref={qrRef} className="scroll-mt-24 lg:sticky lg:top-20">
          {selectedEventId !== null ? (
            <motion.div key={selectedEventId.toString()} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <DynamicQRPanel eventId={selectedEventId} />
              <div className="mt-4">
                <EventAdminTools eventId={selectedEventId} />
              </div>
            </motion.div>
          ) : (
            <div className="card flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-zinc-700">
                <QrCode className="h-7 w-7 text-zinc-500" />
              </div>
              <h3 className="mt-5 text-base font-semibold text-zinc-50">Dinamik QR burada belirecek</h3>
              <p className="mt-1 max-w-sm text-sm text-zinc-500">
                Etkinliği oluşturduğunuzda veya listeden bir etkinlik seçtiğinizde, her 10 saniyede yenilenen check-in QR
                kodu bu alanda görünür.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-12">
        <MyEvents organizer={address} selectedId={selectedEventId} onSelect={selectEvent} />
      </div>

      {isAdmin && (
        <div className="mt-12">
          <AdminConsole />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unverified organizer: corporate authorization screen
// ---------------------------------------------------------------------------

const VERIFICATION_STEPS: Array<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: Mail,
    title: "Request verification",
    text: "Kurum bilgilerinizi ve cüzdan adresinizi onCV ekibine iletin.",
  },
  {
    icon: Building2,
    title: "Domain & organization review",
    text: "Kurum domain'inize TXT kaydı eklersiniz; kurum ve etkinlik geçmişiniz incelenir.",
  },
  {
    icon: ShieldCheck,
    title: "On-chain approval",
    text: "Admin cüzdanınızı zincir üzerinde doğrular; etkinlikleriniz mavi tik ile yayınlanır.",
  },
];

function UnverifiedOrganizer({ address }: { address: Address }) {
  const subject = `${BRAND.name} Organizer Verification Request`;
  const body = [
    `${BRAND.name} Organizer Verification Request`,
    "",
    `Wallet: ${address}`,
    `Network: Avalanche Fuji (${fuji.id})`,
    "",
    "Organization name:",
    "Website / domain:",
    `DNS TXT record added: oncv-verify=${address.toLowerCase()} (yes / no)`,
    "Contact person & role:",
    "Planned event types (workshop / hackathon / conference / meetup / bootcamp):",
  ].join("\n");
  const mailto = `mailto:${VERIFICATION_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="card mx-auto max-w-3xl overflow-hidden"
    >
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:p-8">
        <IconTile className="h-11 w-11">
          <Lock className="h-5 w-5" />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">Kurumsal doğrulama gereklidir</span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-1.5 py-px font-mono text-[11px] text-zinc-400">
              <span className="accent-dot" /> Status: Unverified
            </span>
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">Unverified Organizer Account</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Bu cüzdan {BRAND.name} üzerinde doğrulanmış bir organizatör olarak kayıtlı değil. Etkinlik oluşturma ve
            on-chain kimlik bilgisi verme yetkisi yalnızca {BRAND.name} yöneticileri tarafından onaylanan kurumlara
            tanınır.
          </p>

          <div className="mt-5 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 py-1 pl-3 pr-1">
            <span className="shrink-0 text-xs text-zinc-500">Wallet</span>
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-200">{address}</code>
            <CopyButton value={address} iconOnly label="Adresi kopyala" />
          </div>

          <div className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 py-1 pl-3 pr-1">
            <span className="shrink-0 text-xs text-zinc-500">DNS TXT</span>
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-200">
              oncv-verify={address.toLowerCase()}
            </code>
            <CopyButton value={`oncv-verify=${address.toLowerCase()}`} iconOnly label="TXT kaydını kopyala" />
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">
            Kurum domain&apos;inize (veya <code className="font-mono">_oncv.</code> alt alanına) bu TXT kaydını ekleyin;
            admin doğrulamadan önce domain sahipliğini kontrol eder.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <a href={mailto} className="btn-primary">
              <Mail className="h-4 w-4" /> Request Verification
            </a>
            <CopyButton value={address} label="Cüzdan adresini kopyala" />
          </div>
        </div>
      </div>

      <ol className="grid border-t border-zinc-800 sm:grid-cols-3 sm:divide-x sm:divide-zinc-800">
        {VERIFICATION_STEPS.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="border-b border-zinc-800 p-5 last:border-b-0 sm:border-b-0">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <Icon className="h-4 w-4 text-zinc-500" />
              <span className="font-mono text-xs text-zinc-600">0{i + 1}</span>
              {title}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{text}</p>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-zinc-800 bg-zinc-950/50 px-6 py-3 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span className="inline-flex items-center gap-1.5">
          <CircleCheck className="h-3.5 w-3.5" /> Doğrulama durumu zincir üzerinde herkese açıktır.
        </span>
        {PROOFSKILL_ADDRESS && (
          <a
            href={explorerAddressUrl(PROOFSKILL_ADDRESS)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono hover:text-zinc-300"
          >
            Registry {shortenAddress(PROOFSKILL_ADDRESS)} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </motion.div>
  );
}

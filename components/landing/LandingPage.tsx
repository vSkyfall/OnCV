"use client";

import { motion, type Variants } from "framer-motion";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  ExternalLink,
  Fingerprint,
  FolderKanban,
  GraduationCap,
  Handshake,
  Landmark,
  LocateFixed,
  Lock,
  MapPin,
  QrCode,
  ScanLine,
  ShieldCheck,
  Timer,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useReadContract, useReadContracts } from "wagmi";
import { AvalancheLogo, OkxLogo } from "@/components/brand/Logos";
import { categoryIcon, tierIcon } from "@/components/credentials/icons";
import { AnimatedNumber, IconTile } from "@/components/ui/primitives";
import { OrganizerName, VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { BRAND } from "@/config/brand";
import { fuji } from "@/config/chain";
import {
  PROOFSKILL_ADDRESS,
  POINTS_PER_CHECKIN,
  QR_CODE_TTL_SECONDS,
  QR_ROTATION_SECONDS,
  explorerAddressUrl,
  isContractConfigured,
  proofSkill,
} from "@/config/contract";
import { categoryMeta } from "@/lib/credentials";
import { formatDate, shortenAddress } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.07, ease: EASE } }),
};

export function LandingPage() {
  const statsQuery = useReadContracts({
    contracts: [
      { ...proofSkill, chainId: fuji.id, functionName: "eventCount" },
      { ...proofSkill, chainId: fuji.id, functionName: "totalCheckIns" },
    ],
    allowFailure: false,
    query: { enabled: isContractConfigured },
  });
  const latestQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "getLatestEvents",
    args: [0n, 3n],
    query: { enabled: isContractConfigured },
  });

  const [eventCount, checkIns] = statsQuery.data ?? [undefined, undefined];

  return (
    <div>
      {/* ------------------------------------------------------------------ Hero */}
      <section className="page-shell pb-16 pt-16 text-center sm:pt-24">
        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0} className="flex justify-center">
          <a
            href={PROOFSKILL_ADDRESS ? explorerAddressUrl(PROOFSKILL_ADDRESS) : "https://build.avax.network"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 py-1 pl-2 pr-3 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          >
            <span className="accent-dot animate-pulse-dot" />
            Live on Avalanche Fuji
            <span className="text-zinc-700">|</span>
            <span className="inline-flex items-center gap-1.5">
              <OkxLogo className="h-3.5 w-3.5" /> OKX Wallet ready
            </span>
            <ArrowRight className="h-3 w-3" />
          </a>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={1}
          className="text-gradient mx-auto mt-7 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
        >
          Verifiable On-Chain Credentials &amp; Attendance Infrastructure.
        </motion.h1>

        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={2}
          className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg"
        >
          {BRAND.name}, doğrulanmış kurumların etkinlik katılımlarını Avalanche üzerinde değiştirilemez kimlik
          bilgilerine dönüştürür. İşverenler ve akademik kurumlar her kaydı bağımsız olarak doğrulayabilir.
        </motion.p>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={3}
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <Link href="/profile" className="btn-primary btn-lg">
            Web3 CV&apos;mi Gör <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/projects" className="btn-secondary btn-lg">
            <FolderKanban className="h-4 w-4" /> Projeleri Keşfet
          </Link>
        </motion.div>

        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={4}
          className="mt-5 inline-flex items-center gap-2 text-xs text-zinc-500"
        >
          <OkxLogo className="h-3.5 w-3.5" /> OKX Wallet önerilir
          <span className="text-zinc-700">·</span>
          <Wallet className="h-3.5 w-3.5" /> MetaMask desteklenir
        </motion.p>

        <ProductPreview />
      </section>

      {/* ------------------------------------------------------------------ Live registry */}
      <section className="page-shell">
        <div className="card grid grid-cols-2 md:grid-cols-4 md:divide-x md:divide-zinc-800">
          <LiveStat label="Zincirdeki etkinlik" value={eventCount} />
          <LiveStat label="Doğrulanmış katılım" value={checkIns} />
          <div className="border-t border-zinc-800 p-5 md:border-t-0">
            <div className="eyebrow">Network</div>
            <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-zinc-50">
              <AvalancheLogo className="h-5 w-5" /> Fuji · 43113
            </div>
          </div>
          <div className="border-t border-zinc-800 p-5 md:border-t-0">
            <div className="eyebrow">Registry</div>
            {PROOFSKILL_ADDRESS ? (
              <a
                href={explorerAddressUrl(PROOFSKILL_ADDRESS)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 font-mono text-lg font-semibold text-zinc-50 hover:text-zinc-300"
              >
                {shortenAddress(PROOFSKILL_ADDRESS)} <ExternalLink className="h-4 w-4 text-zinc-500" />
              </a>
            ) : (
              <div className="mt-2 text-sm text-zinc-500">Deploy bekleniyor</div>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ How it works */}
      <section className="page-shell py-24">
        <div className="max-w-2xl">
          <div className="eyebrow">How it works</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">Üç adımda doğrulanmış katılım</h2>
        </div>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800 md:grid-cols-3">
          {[
            {
              icon: Building2,
              title: "Doğrulanmış kurum yayınlar",
              text: "Yalnızca admin onaylı organizatörler etkinlik oluşturabilir; her kayıt organizatörün doğrulama durumunu taşır.",
            },
            {
              icon: ScanLine,
              title: "Katılımcı QR'ı okutur",
              text: `Kod her ${QR_ROTATION_SECONDS} sn'de yeniden imzalanır, konum 1 km yarıçapla doğrulanır, cüzdanla onaylanır.`,
            },
            {
              icon: Fingerprint,
              title: "Web3 CV güncellenir",
              text: `Katılım zincire yazılır; +${POINTS_PER_CHECKIN} Proof Score ve etkinlik türüne göre beceriler eklenir.`,
            },
          ].map((step, i) => (
            <motion.div
              key={step.title}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-60px" }}
              custom={i}
              className="bg-background p-6"
            >
              <div className="flex items-center justify-between">
                <IconTile>
                  <step.icon className="h-4 w-4" />
                </IconTile>
                <span className="font-mono text-xs text-zinc-600">0{i + 1}</span>
              </div>
              <h3 className="mt-5 text-base font-semibold text-zinc-50">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">{step.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ Trust model */}
      <section className="page-shell">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <div className="eyebrow">
              <Lock className="h-3.5 w-3.5" /> Security model
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
              Kayıt, gerçekten orada olduğunuzu kanıtlar
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Kurumsal güven için katılım dört bağımsız katmanda doğrulanır. Her katman zincir üzerinde veya
              istemcide denetlenebilir; hiçbir kayıt sonradan düzenlenemez.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature
              icon={BadgeCheck}
              title="Verified organizers"
              text="Organizatörler admin incelemesinden sonra addOrganizer ile zincirde doğrulanır ve mavi tik alır."
            />
            <Feature
              icon={QrCode}
              title="Rotating signed QR"
              text={`Organizatör ekranındaki geçici anahtar kodu her ${QR_ROTATION_SECONDS} sn'de ECDSA ile yeniden imzalar.`}
            />
            <Feature
              icon={Timer}
              title="On-chain expiry"
              text={`Kontrat ${QR_CODE_TTL_SECONDS} sn'den eski kodları reddeder; ekran görüntüsü işe yaramaz.`}
            />
            <Feature
              icon={LocateFixed}
              title="Geofenced check-in"
              text="HTML5 Geolocation ve Turf.js ile etkinlik alanına 1 km mesafe doğrulanır."
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ Audiences */}
      <section className="page-shell py-24">
        <div className="grid gap-3 md:grid-cols-3">
          <Audience
            icon={GraduationCap}
            title="Katılımcılar"
            text="Tek linkle paylaşılan Web3 CV; LinkedIn'e sertifika olarak eklenebilen, doğrulanabilir kayıtlar."
          />
          <Audience
            icon={Building2}
            title="Organizatörler"
            text="Doğrulanmış kurum profili, sahte katılımsız yoklama ve canlı katılımcı sayacı."
          />
          <Audience
            icon={Briefcase}
            title="İşverenler & Akademi"
            text="SnowTrace üzerinden herkesin bağımsız doğrulayabileceği yetkinlik ve katılım geçmişi."
          />
        </div>
      </section>

      {/* ------------------------------------------------------------------ Post-event tracking */}
      <section className="page-shell pb-24">
        <div className="card grid gap-8 p-8 sm:p-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <div className="eyebrow">
              <FolderKanban className="h-3.5 w-3.5" /> Post-event tracking
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              Hackathon bittiğinde kanıt bitmez
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Projelerin çoğu birkaç hafta içinde terk edilir. Takımlar projelerini kaydeder, 3. ve 6. ayda durumunu zincire
              yazar; organizatör onaylar. Yaşayan projeler yatırımcı ve işverenler için en güçlü sinyal olur.
            </p>
            <Link href="/projects" className="btn-secondary mt-6">
              Yaşayan projeler <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
            {[
              { icon: Activity, title: "3. ay", text: "Hâlâ aktif mi? Kaçırılan kontrol noktası zincirde görünür." },
              { icon: Handshake, title: "İlk müşteri", text: "Organizatör onaylı ilerleme; tüm takıma ek Proof Score." },
              { icon: Landmark, title: "Yatırım aldı", text: "Takımın soulbound proje token'ı dinamik olarak güncellenir." },
            ].map((item) => (
              <div key={item.title} className="bg-background p-5">
                <item.icon className="h-4 w-4 text-zinc-300" />
                <div className="mt-3 text-sm font-semibold text-zinc-50">{item.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* ------------------------------------------------------------------ Latest events */}
      {isContractConfigured && (latestQuery.data?.length ?? 0) > 0 && (
        <section className="page-shell pb-8">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="eyebrow">
                <span className="accent-dot" /> Live registry
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">Son etkinlikler</h2>
            </div>
            <Link href="/check-in" className="btn-ghost">
              Check-in <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {latestQuery.data!.map((event) => {
              const Icon = categoryIcon(event.category);
              return (
                <div key={event.id.toString()} className="card card-hover p-5">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-500">
                      <Icon className="h-3.5 w-3.5" /> {categoryMeta(event.category).label}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-zinc-500">
                      <Users className="h-3.5 w-3.5" /> {event.attendeeCount.toString()}
                    </span>
                  </div>
                  <h3 className="mt-3 line-clamp-2 font-medium text-zinc-50">{event.name}</h3>
                  <OrganizerName
                    name={event.organizer}
                    verified={event.organizerVerified}
                    className="mt-1 text-sm text-zinc-400"
                  />
                  <div className="mt-3 space-y-1 text-xs text-zinc-500">
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" /> {formatDate(event.timestamp)}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{event.location}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ CTA */}
      <section className="page-shell pt-16">
        <div className="card flex flex-col items-start justify-between gap-6 p-8 sm:p-10 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Kurumunuzu {BRAND.name}&apos;de doğrulayın.</h2>
            <p className="mt-2 max-w-xl text-sm text-zinc-400">
              Doğrulanmış organizatör olarak etkinlik yayınlayın; katılımcılarınız mavi tikli, zincir üzerinde kalıcı
              kimlik bilgileri kazansın.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/organizer" className="btn-primary btn-lg">
              <Building2 className="h-4 w-4" /> Enterprise Portal
            </Link>
            <Link href="/check-in" className="btn-secondary btn-lg">
              <ScanLine className="h-4 w-4" /> Check-In
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function LiveStat({ label, value }: { label: string; value: bigint | undefined }) {
  return (
    <div className="p-5">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold text-zinc-50">
        {!isContractConfigured ? (
          <span className="text-zinc-700">—</span>
        ) : value === undefined ? (
          <span className="skeleton inline-block h-7 w-12 align-middle" />
        ) : (
          <AnimatedNumber value={Number(value)} />
        )}
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="card p-5">
      <Icon className="h-5 w-5 text-zinc-300" />
      <h3 className="mt-4 text-sm font-semibold text-zinc-50">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{text}</p>
    </div>
  );
}

function Audience({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="card p-6">
      <IconTile>
        <Icon className="h-4 w-4" />
      </IconTile>
      <h3 className="mt-4 text-base font-semibold text-zinc-50">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-500">{text}</p>
    </div>
  );
}

const SAMPLE_CREDENTIALS = [
  { name: "Avalanche Hackathon İstanbul", organizer: "Team1 Türkiye", cat: 1, tx: "0x7d3a…c41f" },
  { name: "Smart Contract Security Workshop", organizer: "Blockchain İTÜ", cat: 0, tx: "0x19be…08a2" },
  { name: "AI x Web3 Summit", organizer: "Ankara Blockchain", cat: 2, tx: "0xa45c…77d0" },
];

/** Illustrative product frame (sample data, clearly labelled). */
function ProductPreview() {
  const BuilderIcon = tierIcon("builder");
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
      className="relative mx-auto mt-16 max-w-4xl text-left"
    >
      <div aria-hidden className="absolute inset-x-10 -top-px h-px bg-gradient-to-r from-transparent via-zinc-500/60 to-transparent" />
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-pop">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-800" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-800" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-800" />
          </div>
          <span className="font-mono text-[11px] text-zinc-500">{BRAND.domain}/0x7099…79C8</span>
          <span className="rounded border border-zinc-800 px-1.5 py-px font-mono text-[10px] text-zinc-600">
            Örnek
          </span>
        </div>
        <div className="grid md:grid-cols-[240px_1fr]">
          <div className="border-b border-zinc-800 p-5 md:border-b-0 md:border-r">
            <div className="eyebrow">Proof Score</div>
            <div className="mt-2 font-mono text-4xl font-semibold text-zinc-50">125</div>
            <span className="chip mt-3 border-zinc-700 text-zinc-200">
              <BuilderIcon className="h-3.5 w-3.5" /> Builder
            </span>
            <div className="mt-5 space-y-2 text-xs text-zinc-500">
              <div className="flex justify-between">
                <span>Doğrulanmış etkinlik</span>
                <span className="font-mono text-zinc-300">5</span>
              </div>
              <div className="flex justify-between">
                <span>Doğrulanmış kurum</span>
                <span className="font-mono text-zinc-300">4</span>
              </div>
              <div className="flex justify-between">
                <span>Beceri</span>
                <span className="font-mono text-zinc-300">7</span>
              </div>
            </div>
          </div>
          <div className="divide-y divide-zinc-800">
            {SAMPLE_CREDENTIALS.map((item, i) => {
              const Icon = categoryIcon(item.cat);
              return (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                  className="flex items-center gap-3 px-5 py-3.5"
                >
                  <IconTile>
                    <Icon className="h-4 w-4" />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-zinc-100">{item.name}</div>
                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                      {item.organizer} <VerifiedBadge className="h-3 w-3" />
                    </div>
                  </div>
                  <span className="hidden font-mono text-[11px] text-zinc-600 sm:inline">{item.tx}</span>
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

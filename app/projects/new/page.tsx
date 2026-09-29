"use client";

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, FolderKanban, Plus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent, type ReactNode } from "react";
import { isAddress, parseEventLogs, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { IconTile, Notice, Spinner } from "@/components/ui/primitives";
import { SetupNotice } from "@/components/ui/SetupNotice";
import { OrganizerName } from "@/components/ui/VerifiedBadge";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { fuji } from "@/config/chain";
import {
  MAX_TEAM_SIZE,
  REGISTRATION_WINDOW_SECONDS,
  isContractConfigured,
  isRegistryConfigured,
  projectRegistry,
  proofSkill,
} from "@/config/contract";
import { parseWeb3Error } from "@/lib/errors";
import { useNow } from "@/lib/hooks";
import { isHttpUrl } from "@/lib/projects";
import { formatDateTime } from "@/lib/utils";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const byteLength = (value: string) => new TextEncoder().encode(value).length;

export default function NewProjectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-32">
          <Spinner className="h-5 w-5 text-zinc-500" />
        </div>
      }
    >
      <NewProject />
    </Suspense>
  );
}

function NewProject() {
  const searchParams = useSearchParams();
  const raw = searchParams.get("eventId") ?? "";
  const eventId = /^\d{1,20}$/.test(raw) ? BigInt(raw) : null;

  if (!isContractConfigured || !isRegistryConfigured) {
    return (
      <div className="page-shell py-12">
        <SetupNotice />
      </div>
    );
  }
  if (eventId === null) {
    return (
      <Shell>
        <Notice tone="warning" title="Etkinlik seçilmedi">
          Proje kaydı etkinliğe bağlıdır. Organizatörün gösterdiği kayıt QR&apos;ını okutun ya da Web3 CV&apos;nizdeki
          etkinlikten &quot;Proje kaydet&quot;e tıklayın.
        </Notice>
      </Shell>
    );
  }
  return <RegisterForm eventId={eventId} />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <div className="eyebrow">
        <FolderKanban className="h-3.5 w-3.5" /> Proje takibi
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">Projeni kaydet</h1>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
        Hackathon projelerinin çoğu birkaç hafta içinde terk edilir. Projeni kaydet; 3. ve 6. ayda durumunu güncelle.
        Yaşayan projeler, yatırımcı ve işverenler için Web3 CV&apos;ndeki en güçlü sinyal olur.
      </p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

type FormState = { title: string; pitch: string; url: string; teammates: string[] };

function RegisterForm({ eventId }: { eventId: bigint }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { address, chainId, status } = useAccount();
  const publicClient = usePublicClient({ chainId: fuji.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const now = useNow(30_000);

  const [form, setForm] = useState<FormState>({ title: "", pitch: "", url: "", teammates: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventQuery = useReadContract({ ...proofSkill, chainId: fuji.id, functionName: "getEvent", args: [eventId] });
  const statusQuery = useReadContracts({
    contracts: [
      { ...proofSkill, chainId: fuji.id, functionName: "isValidAttendance", args: [address ?? ZERO, eventId] },
      { ...projectRegistry, chainId: fuji.id, functionName: "projectOf", args: [eventId, address ?? ZERO] },
    ],
    allowFailure: false,
    query: { enabled: !!address },
  });
  const [isAttendee, existingProject] = statusQuery.data ?? [undefined, undefined];
  const event = eventQuery.data;

  const teammates = form.teammates.map((t) => t.trim()).filter(Boolean);
  const teammateStatus = useReadContracts({
    contracts: teammates.map((mate) => ({
      ...proofSkill,
      chainId: fuji.id,
      functionName: "isValidAttendance" as const,
      args: [(isAddress(mate, { strict: false }) ? mate : ZERO) as Address, eventId] as const,
    })),
    allowFailure: false,
    query: { enabled: teammates.length > 0 },
  });

  if (eventQuery.isLoading || status === "reconnecting" || status === "connecting") {
    return (
      <Shell>
        <Spinner className="h-5 w-5 text-zinc-500" />
      </Shell>
    );
  }
  if (!event) {
    return (
      <Shell>
        <Notice tone="danger" title="Etkinlik bulunamadı">
          {eventQuery.error ? parseWeb3Error(eventQuery.error) : `#${eventId} numaralı etkinlik yok.`}
        </Notice>
      </Shell>
    );
  }

  const start = Number(event.timestamp);
  const end = start + Number(event.durationHours) * 3600;
  const closesAt = end + REGISTRATION_WINDOW_SECONDS;
  const nowSec = now === null ? null : now / 1000;
  const windowOpen = nowSec === null || (nowSec >= start && nowSec <= closesAt);

  const header = (
    <div className="card mb-5 flex items-center gap-3 p-4">
      <IconTile>
        <Users className="h-4 w-4" />
      </IconTile>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-zinc-100">{event.name}</div>
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-zinc-500">
          <OrganizerName name={event.organizer} verified={event.organizerVerified} />
          <span>Kayıt son tarihi: {formatDateTime(closesAt)}</span>
        </div>
      </div>
    </div>
  );

  if (!address) {
    return (
      <Shell>
        {header}
        <div className="card flex flex-col items-center p-8 text-center">
          <p className="text-sm text-zinc-400">Projeyi kaydetmek için etkinliğe check-in yaptığınız cüzdanı bağlayın.</p>
          <div className="mt-5">
            <ConnectWalletButton size="lg" />
          </div>
        </div>
      </Shell>
    );
  }

  if (existingProject && existingProject > 0n) {
    return (
      <Shell>
        {header}
        <Notice tone="info" title="Bu etkinlik için zaten bir projedesiniz">
          <Link href={`/projects/${existingProject}`} className="underline">
            Proje takip sayfasına git
          </Link>
        </Notice>
      </Shell>
    );
  }

  if (isAttendee === false) {
    return (
      <Shell>
        {header}
        <Notice tone="warning" title="Geçerli katılım bulunamadı">
          Proje kaydı yalnızca bu etkinliğe check-in yapmış (ve kaydı iptal edilmemiş) katılımcılara açıktır.
        </Notice>
      </Shell>
    );
  }

  function validate(): string | null {
    if (!form.title.trim() || byteLength(form.title.trim()) > 80) return "Proje adı 1–80 karakter olmalı.";
    if (!form.pitch.trim() || byteLength(form.pitch.trim()) > 280) return "Kısa açıklama 1–280 karakter olmalı.";
    if (!isHttpUrl(form.url.trim())) return "Link http(s) ile başlamalı.";
    if (teammates.some((t) => !isAddress(t, { strict: false }))) return "Takım arkadaşı adreslerini kontrol edin.";
    if (new Set(teammates.map((t) => t.toLowerCase())).size !== teammates.length) return "Aynı adres iki kez eklenmiş.";
    if (teammates.some((t) => t.toLowerCase() === address!.toLowerCase())) return "Kendi adresinizi takım arkadaşı olarak eklemeyin.";
    const missing = teammates.filter((_, i) => teammateStatus.data?.[i] === false);
    if (missing.length) return `Bu adres(ler) etkinliğe katılmamış: ${missing.join(", ")}`;
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (!address || !publicClient) return;
    setBusy(true);
    const input = {
      eventId,
      title: form.title.trim(),
      pitch: form.pitch.trim(),
      url: form.url.trim(),
      invitees: teammates as Address[],
    };
    try {
      if (chainId !== fuji.id) await switchChainAsync({ chainId: fuji.id });
      await publicClient.simulateContract({ ...projectRegistry, functionName: "registerProject", args: [input], account: address });
      const hash = await writeContractAsync({
        ...projectRegistry,
        chainId: fuji.id,
        functionName: "registerProject",
        args: [input],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("İşlem zincirde başarısız oldu.");
      const [registered] = parseEventLogs({ abi: projectRegistry.abi, logs: receipt.logs, eventName: "ProjectRegistered" });
      await queryClient.invalidateQueries();
      router.push(registered ? `/projects/${registered.args.projectId}` : "/projects");
    } catch (err) {
      setError(parseWeb3Error(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      {header}
      {!windowOpen && (
        <Notice tone="warning" className="mb-4" title="Kayıt penceresi kapalı">
          Proje kaydı etkinlik başlangıcından bitişinden 7 gün sonrasına kadar açıktır.
        </Notice>
      )}
      <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onSubmit={handleSubmit} className="card space-y-5 p-6">
        <Field label="Proje adı" hint={`${byteLength(form.title)}/80`}>
          <input
            className="input"
            placeholder="örn. FraudShield"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            disabled={busy}
            required
          />
        </Field>
        <Field label="Kısa açıklama (herkese açık)" hint={`${byteLength(form.pitch)}/280`}>
          <textarea
            className="input h-24 resize-none py-2"
            placeholder="Hangi problemi çözüyorsunuz, kim için?"
            value={form.pitch}
            onChange={(e) => setForm({ ...form, pitch: e.target.value })}
            disabled={busy}
            required
          />
        </Field>
        <Field label="Link (repo, demo veya web sitesi · opsiyonel)">
          <input
            className="input font-mono"
            placeholder="https://github.com/…"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            disabled={busy}
          />
        </Field>

        <div>
          <span className="label">Takım arkadaşlarını davet et (etkinliğe katılmış olmalı · en fazla {MAX_TEAM_SIZE - 1})</span>
          <div className="space-y-2">
            {form.teammates.map((mate, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input font-mono"
                  placeholder="0x…"
                  value={mate}
                  onChange={(e) => {
                    const next = [...form.teammates];
                    next[i] = e.target.value;
                    setForm({ ...form, teammates: next });
                  }}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="btn-ghost h-9 w-9 shrink-0 !px-0"
                  onClick={() => setForm({ ...form, teammates: form.teammates.filter((_, j) => j !== i) })}
                  aria-label="Kaldır"
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {form.teammates.length < MAX_TEAM_SIZE - 1 && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setForm({ ...form, teammates: [...form.teammates, ""] })}
                disabled={busy}
              >
                <Plus className="h-3.5 w-3.5" /> Takım arkadaşı ekle
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Davet edilenler proje sayfasından veya Web3 CV&apos;lerinden daveti kabul ettiklerinde takıma katılır;
            kimse rızası olmadan bir projeye bağlanamaz. Her takım üyesi projenin devredilemez kredansiyel
            token&apos;ını alır ve durum güncellendikçe token&apos;ın metadata&apos;sı da güncellenir.
          </p>
        </div>

        {error && <Notice tone="danger">{error}</Notice>}

        <button type="submit" className="btn-primary btn-lg w-full" disabled={busy || !windowOpen}>
          {busy ? <Spinner /> : <ArrowRight className="h-4 w-4" />} Projeyi kaydet
        </button>
      </motion.form>
    </Shell>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-zinc-400">
        {label}
        {hint && <span className="font-mono text-[11px] text-zinc-600">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

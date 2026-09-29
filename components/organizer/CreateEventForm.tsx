"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, LocateFixed, MapPin, Plus, QrCode, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { parseEventLogs, type Hash } from "viem";
import { useAccount, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { IconTile, Notice, Spinner } from "@/components/ui/primitives";
import { OrganizerName } from "@/components/ui/VerifiedBadge";
import { explorerTxUrl, proofSkill } from "@/config/contract";
import { fuji } from "@/config/chain";
import { EVENT_CATEGORIES, SUGGESTED_SKILL_TAGS, type CategoryValue } from "@/lib/credentials";
import { parseWeb3Error } from "@/lib/errors";
import { geolocationErrorMessage, getCurrentPosition, isValidLatLng, toScaledCoordinate } from "@/lib/geo";
import { createSessionSigner, forgetSessionSigner } from "@/lib/session-keys";
import { cn, toDatetimeLocalValue } from "@/lib/utils";

type FormState = {
  name: string;
  location: string;
  start: string;
  durationHours: string;
  isOnline: boolean;
  lat: string;
  lng: string;
  maxAttendees: string;
  category: CategoryValue;
  tags: string[];
  customTag: string;
};

type Stage = "idle" | "switching" | "simulating" | "wallet" | "confirming";

const STAGE_LABEL: Record<Exclude<Stage, "idle">, string> = {
  switching: "Avalanche Fuji ağına geçiliyor…",
  simulating: "İşlem kontrol ediliyor…",
  wallet: "Cüzdanınızda işlemi onaylayın…",
  confirming: "Avalanche Fuji'de onaylanıyor…",
};

const MAX_BYTES = 160;
const byteLength = (value: string) => new TextEncoder().encode(value).length;

function initialState(): FormState {
  return {
    name: "",
    location: "",
    start: toDatetimeLocalValue(new Date()),
    durationHours: "8",
    isOnline: false,
    lat: "",
    lng: "",
    maxAttendees: "",
    category: 1,
    tags: ["Solidity", "Avalanche"],
    customTag: "",
  };
}

function validate(form: FormState): string | null {
  if (!form.name.trim()) return "Etkinlik adı gerekli.";
  if (!form.location.trim()) return "Konum adı gerekli.";
  for (const [label, value] of [
    ["Etkinlik adı", form.name],
    ["Konum", form.location],
    ["Beceri etiketleri", form.tags.join(",")],
  ] as const) {
    if (byteLength(value.trim()) > MAX_BYTES) return `${label} en fazla ${MAX_BYTES} karakter olabilir.`;
  }
  const start = new Date(form.start).getTime();
  if (Number.isNaN(start)) return "Geçerli bir başlangıç tarihi seçin.";
  // Mirrors MAX_BACKDATE / MAX_START_OFFSET in ProofSkill.sol (5 min margin for clock drift).
  if (start < Date.now() - 55 * 60_000) return "Başlangıç en fazla 1 saat geçmişte olabilir.";
  if (start > Date.now() + 365 * 24 * 3_600_000) return "Başlangıç en fazla 1 yıl sonrası olabilir.";
  const duration = Number(form.durationHours);
  if (!Number.isInteger(duration) || duration < 1 || duration > 720) return "Süre 1–720 saat arasında bir tam sayı olmalı.";
  if (start + duration * 3_600_000 <= Date.now()) return "Etkinliğin bitiş zamanı geçmişte kalıyor.";
  if (form.maxAttendees.trim() !== "") {
    const cap = Number(form.maxAttendees);
    if (!Number.isInteger(cap) || cap < 1 || cap > 1_000_000) return "Kontenjan 1 veya daha büyük bir tam sayı olmalı (boş = sınırsız).";
  }
  if (form.isOnline) return null;
  const lat = Number(form.lat);
  const lng = Number(form.lng);
  if (form.lat.trim() === "" || form.lng.trim() === "" || !isValidLatLng(lat, lng)) {
    return "Geçerli koordinatlar girin (enlem ±90, boylam ±180) veya “Konumumu kullan”a tıklayın.";
  }
  return null;
}

export function CreateEventForm({ onCreated }: { onCreated: (eventId: bigint) => void }) {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: fuji.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  // The organizer name on credentials comes from the admin-registered profile, never from free text.
  const profileQuery = useReadContract({
    ...proofSkill,
    chainId: fuji.id,
    functionName: "organizerProfiles",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address },
  });

  const [form, setForm] = useState<FormState>(initialState);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [locating, setLocating] = useState(false);

  const busy = stage !== "idle";
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  async function fillMyLocation() {
    setLocating(true);
    setError(null);
    try {
      const position = await getCurrentPosition();
      setForm((prev) => ({
        ...prev,
        lat: position.coords.latitude.toFixed(6),
        lng: position.coords.longitude.toFixed(6),
      }));
    } catch (err) {
      setError(geolocationErrorMessage(err));
    } finally {
      setLocating(false);
    }
  }

  function toggleTag(tag: string) {
    setForm((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
    }));
  }

  function addCustomTag() {
    const tag = form.customTag.replace(/,/g, " ").trim();
    if (!tag) return;
    setForm((prev) => ({
      ...prev,
      tags: prev.tags.some((t) => t.toLowerCase() === tag.toLowerCase()) ? prev.tags : [...prev.tags, tag],
      customTag: "",
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setTxHash(null);

    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    if (!address || !publicClient) {
      setError("Önce cüzdanınızı bağlayın.");
      return;
    }

    // Ephemeral key that will sign the rotating QR codes on this device.
    const eventEnd = Math.floor(new Date(form.start).getTime() / 1000) + Number(form.durationHours) * 3600;
    const signer = createSessionSigner(eventEnd + 24 * 3600);
    if (!signer.persisted) {
      setError("Tarayıcı depolaması kapalı; QR imza anahtarı kaydedilemiyor. Gizli sekme dışında deneyin.");
      return;
    }

    const args = [
      {
        name: form.name.trim(),
        location: form.location.trim(),
        startTime: BigInt(Math.floor(new Date(form.start).getTime() / 1000)),
        durationHours: BigInt(form.durationHours),
        lat: form.isOnline ? 0n : toScaledCoordinate(Number(form.lat)),
        long: form.isOnline ? 0n : toScaledCoordinate(Number(form.lng)),
        category: form.category,
        skillTags: form.tags.join(","),
        checkInSigner: signer.address,
        maxAttendees: form.maxAttendees.trim() ? BigInt(form.maxAttendees) : 0n,
        isOnline: form.isOnline,
      },
    ] as const;

    try {
      if (chainId !== fuji.id) {
        setStage("switching");
        await switchChainAsync({ chainId: fuji.id });
      }
      setStage("simulating");
      await publicClient.simulateContract({ ...proofSkill, functionName: "createEvent", args, account: address });

      setStage("wallet");
      const hash = await writeContractAsync({ ...proofSkill, chainId: fuji.id, functionName: "createEvent", args });
      setTxHash(hash);

      setStage("confirming");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("İşlem zincirde başarısız oldu.");

      const [created] = parseEventLogs({ abi: proofSkill.abi, logs: receipt.logs, eventName: "EventCreated" });
      if (!created) throw new Error("EventCreated kaydı bulunamadı.");

      await queryClient.invalidateQueries();
      setForm((prev) => ({ ...initialState(), lat: prev.lat, lng: prev.lng }));
      onCreated(created.args.eventId);
    } catch (err) {
      forgetSessionSigner(signer.address);
      setError(parseWeb3Error(err));
    } finally {
      setStage("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-5 p-6">
      <div className="flex items-center gap-3">
        <IconTile>
          <CalendarPlus className="h-4 w-4" />
        </IconTile>
        <div>
          <h2 className="text-base font-semibold text-zinc-50">Yeni Etkinlik</h2>
          <p className="text-xs text-zinc-500">Etkinlik Avalanche Fuji&apos;ye yazılır ve dinamik QR anında üretilir.</p>
        </div>
      </div>

      <Field label="Etkinlik adı">
        <input
          className="input"
          placeholder="örn. Avalanche Build Games İstanbul"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          disabled={busy}
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organizatör (doğrulanmış kurum profili)">
          <div className="input flex items-center gap-1.5 text-zinc-300">
            {profileQuery.data?.[0] ? (
              <OrganizerName name={profileQuery.data[0]} verified className="text-zinc-200" />
            ) : (
              <span className="text-zinc-600">Profil yükleniyor…</span>
            )}
          </div>
        </Field>
        <Field label="Kategori">
          <select
            className="input"
            value={form.category}
            onChange={(e) => update("category", Number(e.target.value) as CategoryValue)}
            disabled={busy}
          >
            {EVENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <Field label="Başlangıç (tarih & saat)">
          <input
            type="datetime-local"
            className="input [color-scheme:dark]"
            value={form.start}
            onChange={(e) => update("start", e.target.value)}
            disabled={busy}
            required
          />
        </Field>
        <Field label="Süre (saat)">
          <input
            type="number"
            min={1}
            max={720}
            className="input"
            value={form.durationHours}
            onChange={(e) => update("durationHours", e.target.value)}
            disabled={busy}
            required
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <Field label={form.isOnline ? "Platform / bağlantı adı" : "Konum adı"}>
          <input
            className="input"
            placeholder={form.isOnline ? "örn. Zoom, Discord Stage" : "örn. İTÜ Arı Teknokent, İstanbul"}
            value={form.location}
            onChange={(e) => update("location", e.target.value)}
            disabled={busy}
            required
          />
        </Field>
        <Field label="Kontenjan">
          <input
            type="number"
            min={1}
            className="input"
            placeholder="Sınırsız"
            value={form.maxAttendees}
            onChange={(e) => update("maxAttendees", e.target.value)}
            disabled={busy}
          />
        </Field>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-zinc-200"
          checked={form.isOnline}
          onChange={(e) => update("isOnline", e.target.checked)}
          disabled={busy}
        />
        <span>
          <span className="block text-sm font-medium text-zinc-200">Online etkinlik</span>
          <span className="block text-xs text-zinc-500">
            Konum kontrolü yapılmaz; katılım yalnızca ekrandaki 10 saniyede bir yenilenen QR ile kanıtlanır.
          </span>
        </span>
      </label>

      <div className={cn(form.isOnline && "hidden")}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label !mb-0">Konum koordinatları · 1 km check-in alanı</span>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-50 disabled:opacity-50"
            onClick={fillMyLocation}
            disabled={busy || locating}
          >
            {locating ? <Spinner className="h-3.5 w-3.5" /> : <LocateFixed className="h-3.5 w-3.5" />}
            Konumumu kullan
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input
            className="input font-mono"
            inputMode="decimal"
            placeholder="Enlem (41.015137)"
            value={form.lat}
            onChange={(e) => update("lat", e.target.value)}
            disabled={busy}
            aria-label="Enlem"
          />
          <input
            className="input font-mono"
            inputMode="decimal"
            placeholder="Boylam (28.979530)"
            value={form.lng}
            onChange={(e) => update("lng", e.target.value)}
            disabled={busy}
            aria-label="Boylam"
          />
        </div>
        {isValidLatLng(Number(form.lat), Number(form.lng)) && form.lat && form.lng && (
          <a
            href={`https://www.google.com/maps?q=${form.lat},${form.lng}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <MapPin className="h-3 w-3" /> Haritada kontrol et
          </a>
        )}
      </div>

      <div>
        <span className="label">Beceri etiketleri (Web3 CV rozetleri)</span>
        <div className="flex flex-wrap gap-2">
          {[...new Set([...SUGGESTED_SKILL_TAGS, ...form.tags])].map((tag) => {
            const active = form.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                disabled={busy}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-zinc-600 bg-zinc-800 text-zinc-50"
                    : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200",
                )}
              >
                {tag}
                {active && <X className="h-3 w-3" />}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="input"
            placeholder="Özel etiket ekle (örn. Rust)"
            value={form.customTag}
            onChange={(e) => update("customTag", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomTag();
              }
            }}
            disabled={busy}
          />
          <button type="button" className="btn-secondary shrink-0" onClick={addCustomTag} disabled={busy}>
            <Plus className="h-4 w-4" /> Ekle
          </button>
        </div>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      <button type="submit" className="btn-primary btn-lg w-full" disabled={busy}>
        {busy ? <Spinner /> : <QrCode className="h-5 w-5" />}
        {busy ? STAGE_LABEL[stage as Exclude<Stage, "idle">] : "Etkinliği Oluştur & Dinamik QR Üret"}
      </button>

      {txHash && busy && (
        <p className="text-center text-xs text-zinc-500">
          Tx:{" "}
          <a className="font-mono text-zinc-300 hover:underline" href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            {txHash.slice(0, 18)}…
          </a>
        </p>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

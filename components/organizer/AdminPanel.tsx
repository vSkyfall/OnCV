"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CircleX, Globe, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { IconTile, Notice, Spinner } from "@/components/ui/primitives";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { fuji } from "@/config/chain";
import { explorerTxUrl, proofSkill } from "@/config/contract";
import { parseWeb3Error } from "@/lib/errors";
import { shortenHash } from "@/lib/utils";

type Action = "add" | "remove";
type DomainCheck = { domain: string; verified: boolean; expected: string; found: string[]; error?: string };

async function checkDomain(domain: string, address: string): Promise<DomainCheck> {
  const response = await fetch(`/api/verify-domain?${new URLSearchParams({ domain, address })}`);
  return response.json();
}

/** Admin-only: verify or revoke organizer wallets with their registered organization profile. */
export function AdminPanel() {
  const { chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: fuji.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const [wallet, setWallet] = useState("");
  const [orgName, setOrgName] = useState("");
  const [domain, setDomain] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ action: Action; hash: `0x${string}` } | null>(null);

  const candidate = wallet.trim() as Address;
  const valid = isAddress(candidate, { strict: false });
  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  const statusQuery = useReadContracts({
    contracts: [
      { ...proofSkill, chainId: fuji.id, functionName: "isVerifiedOrganizer", args: [candidate] },
      { ...proofSkill, chainId: fuji.id, functionName: "organizerProfiles", args: [candidate] },
    ],
    allowFailure: false,
    query: { enabled: valid },
  });
  const [isVerified, profile] = statusQuery.data ?? [undefined, undefined];

  const domainQuery = useQuery({
    queryKey: ["domain-check", cleanDomain, candidate],
    queryFn: () => checkDomain(cleanDomain, candidate),
    enabled: false,
  });

  function reset() {
    setError(null);
    setResult(null);
  }

  async function run(action: Action) {
    if (!valid || !publicClient) return;
    if (action === "add" && !orgName.trim()) {
      setError("Kurumun kayıtlı görünen adını girin; etkinliklerde bu ad gösterilir.");
      return;
    }
    setPending(action);
    reset();
    try {
      if (chainId !== fuji.id) await switchChainAsync({ chainId: fuji.id });
      const hash =
        action === "add"
          ? await writeContractAsync({
              ...proofSkill,
              chainId: fuji.id,
              functionName: "addOrganizer",
              args: [candidate, orgName.trim(), cleanDomain],
            })
          : await writeContractAsync({
              ...proofSkill,
              chainId: fuji.id,
              functionName: "removeOrganizer",
              args: [candidate],
            });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("İşlem zincirde başarısız oldu.");
      setResult({ action, hash });
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(parseWeb3Error(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center gap-3">
          <IconTile>
            <Building2 className="h-4 w-4" />
          </IconTile>
          <div>
            <h2 className="text-sm font-semibold text-zinc-50">Organizer Verification</h2>
            <p className="text-xs text-zinc-500">
              Admin · Kurum incelemesi ve domain kontrolü sonrası cüzdanı kayıtlı kurum adıyla doğrulayın.
            </p>
          </div>
        </div>
        <span className="chip">
          <ShieldCheck className="h-3.5 w-3.5" /> Admin
        </span>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
          <label className="block">
            <span className="label">Organizatör cüzdanı</span>
            <input
              className="input font-mono"
              placeholder="0x…"
              value={wallet}
              onChange={(e) => {
                setWallet(e.target.value);
                reset();
              }}
            />
          </label>
          <label className="block">
            <span className="label">Kayıtlı kurum adı</span>
            <input
              className="input"
              placeholder="örn. Blockchain İTÜ"
              maxLength={80}
              value={orgName}
              onChange={(e) => {
                setOrgName(e.target.value);
                reset();
              }}
            />
          </label>
          <label className="block">
            <span className="label">Domain</span>
            <input
              className="input font-mono"
              placeholder="blockchainitu.com"
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                reset();
              }}
            />
          </label>
        </div>

        {valid && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
            Zincirdeki durum:{" "}
            {statusQuery.isLoading ? (
              <Spinner className="h-3 w-3" />
            ) : isVerified ? (
              <span className="inline-flex items-center gap-1 text-zinc-200">
                <VerifiedBadge className="h-3.5 w-3.5" /> {profile?.[0] || "Verified organizer"}
                {profile?.[1] ? <span className="font-mono text-zinc-500">· {profile[1]}</span> : null}
              </span>
            ) : (
              <span className="text-zinc-400">Unverified</span>
            )}
          </p>
        )}

        {valid && cleanDomain && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-zinc-400">
                <Globe className="h-3.5 w-3.5" /> DNS TXT kaydı:{" "}
                <code className="font-mono text-zinc-200">oncv-verify={candidate.toLowerCase()}</code>
                <span className="text-zinc-600">({cleanDomain} veya _oncv.{cleanDomain})</span>
              </span>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => domainQuery.refetch()}
                disabled={domainQuery.isFetching}
              >
                {domainQuery.isFetching ? <Spinner className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />} Domain&apos;i kontrol et
              </button>
            </div>
            {domainQuery.data &&
              (domainQuery.data.error ? (
                <p className="mt-2 text-brand-400">{domainQuery.data.error}</p>
              ) : domainQuery.data.verified ? (
                <p className="mt-2 inline-flex items-center gap-1 text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" /> Domain sahipliği doğrulandı.
                </p>
              ) : (
                <p className="mt-2 inline-flex items-center gap-1 text-amber-300">
                  <CircleX className="h-3.5 w-3.5" /> Kayıt bulunamadı
                  {domainQuery.data.found.length ? ` (bulunan: ${domainQuery.data.found.join(", ")})` : ""}. Yine de
                  doğrulayabilirsiniz, ancak önerilmez.
                </p>
              ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={!valid || pending !== null} onClick={() => run("add")}>
            {pending === "add" ? <Spinner /> : <UserPlus className="h-4 w-4" />} {isVerified ? "Profili güncelle" : "Verify organizer"}
          </button>
          <button type="button" className="btn-secondary" disabled={!valid || pending !== null} onClick={() => run("remove")}>
            {pending === "remove" ? <Spinner /> : <UserMinus className="h-4 w-4" />} Revoke
          </button>
        </div>

        {result && (
          <Notice tone="success">
            {result.action === "add" ? "Organizatör doğrulandı." : "Doğrulama kaldırıldı."}{" "}
            <a className="font-mono underline" href={explorerTxUrl(result.hash)} target="_blank" rel="noreferrer">
              {shortenHash(result.hash)}
            </a>
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}

        <p className="text-xs leading-relaxed text-zinc-500">
          Etkinliklerde organizatör adı olarak bu kayıtlı kurum adı gösterilir; organizatörler başka bir kurumun adını
          kullanamaz. Doğrulaması kaldırılan organizatör yeni etkinlik oluşturamaz ve etkinlikleri check-in kabul etmez.
        </p>
      </div>
    </section>
  );
}

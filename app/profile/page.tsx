"use client";

import { motion } from "framer-motion";
import { ArrowRight, Fingerprint, Lock, Search, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { ProfileView } from "@/components/profile/ProfileView";
import { IconTile, Spinner } from "@/components/ui/primitives";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";

export default function MyProfilePage() {
  const { address, status } = useAccount();

  if (address) return <ProfileView address={address} />;

  if (status === "reconnecting" || status === "connecting") {
    return (
      <div className="page-shell flex justify-center py-32 text-zinc-500">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return <ConnectPrompt />;
}

function ConnectPrompt() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleLookup(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!isAddress(value, { strict: false })) {
      setError("Geçerli bir cüzdan adresi girin (0x…).");
      return;
    }
    router.push(`/profile/${value}`);
  }

  return (
    <div className="page-shell py-16 sm:py-24">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="card mx-auto max-w-lg overflow-hidden"
      >
        <div className="p-8">
          <IconTile className="h-10 w-10">
            <Fingerprint className="h-5 w-5" />
          </IconTile>
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-zinc-50">Web3 CV Profilim</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Cüzdanınızı bağlayın; Avalanche üzerinde doğrulanmış tüm etkinlik katılımlarınız, Proof Score&apos;unuz ve
            becerileriniz tek bir doğrulanabilir profilde listelenir.
          </p>
          <ul className="mt-5 space-y-2 text-sm text-zinc-400">
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-zinc-500" /> Doğrulanmış organizatörlerce verilen kayıtlar
            </li>
            <li className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-zinc-500" /> Yalnızca kontrat yazabilir, kimse düzenleyemez
            </li>
          </ul>
          <div className="mt-7">
            <ConnectWalletButton size="lg" fullWidth />
          </div>
        </div>

        <div className="border-t border-zinc-800 bg-zinc-950/50 p-6">
          <form onSubmit={handleLookup}>
            <label htmlFor="lookup" className="label">
              Herhangi bir profili görüntüleyin
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                <input
                  id="lookup"
                  className="input pl-9 font-mono"
                  placeholder="0x… cüzdan adresi"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setError(null);
                  }}
                />
              </div>
              <button type="submit" className="btn-secondary shrink-0">
                Görüntüle <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-brand-400">{error}</p>}
          </form>
        </div>
      </motion.div>
    </div>
  );
}

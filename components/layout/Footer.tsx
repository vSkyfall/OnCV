import { Building2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { AvalancheLogo, OnCVMark } from "@/components/brand/Logos";
import { BRAND } from "@/config/brand";
import { PROOFSKILL_ADDRESS, explorerAddressUrl } from "@/config/contract";
import { shortenAddress } from "@/lib/utils";

const LINKS = [
  { href: "/profile", label: "Web3 CV" },
  { href: "/projects", label: "Projeler" },
  { href: "/check-in", label: "Check-In" },
];

export function Footer() {
  return (
    <footer className="relative z-10 mt-24 border-t border-zinc-800/80">
      <div className="page-shell flex flex-col gap-6 py-8 text-sm text-zinc-500">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-90" aria-label="onCV ana sayfa">
            <OnCVMark className="h-9 w-9" />
            <span className="flex flex-col">
              <span className="font-semibold text-zinc-200">{BRAND.name}</span>
              <span className="text-xs text-zinc-600">{BRAND.tagline}</span>
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Alt menü">
            {LINKS.map(({ href, label }) => (
              <Link key={href} href={href} className="transition-colors hover:text-brand-100">
                {label}
              </Link>
            ))}
            <Link href="/organizer" className="inline-flex items-center gap-1.5 text-zinc-600 transition-colors hover:text-brand-100">
              <Building2 className="h-3.5 w-3.5" /> Enterprise Portal
            </Link>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-zinc-800/60 pt-5 font-mono text-xs">
          <span className="inline-flex items-center gap-1.5">
            <AvalancheLogo className="h-3.5 w-3.5" /> Avalanche Fuji · 43113
          </span>
          {PROOFSKILL_ADDRESS && (
            <a
              href={explorerAddressUrl(PROOFSKILL_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-brand-100"
            >
              Registry {shortenAddress(PROOFSKILL_ADDRESS)} <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <span className="sm:ml-auto">{BRAND.domain}</span>
        </div>
      </div>
    </footer>
  );
}

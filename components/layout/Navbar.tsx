"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Building2, FolderKanban, IdCard, Menu, ScanLine, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { OnCVLogo } from "@/components/brand/Logos";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { useIsClient } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/** Public navigation: attendees, employers and investors. Organizer/admin tools live behind the Enterprise Portal. */
const NAV_ITEMS = [
  { href: "/profile", label: "Web3 CV", icon: IdCard },
  { href: "/projects", label: "Projeler", icon: FolderKanban },
  { href: "/check-in", label: "Check-In", icon: ScanLine },
];

const PORTAL = { href: "/organizer", label: "Enterprise Portal", hint: "Organizatör ve admin girişi" };

export function Navbar() {
  const pathname = usePathname();
  const mounted = useIsClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Active state is applied after hydration only: the server-rendered pathname can differ from the client's
  // (static prerender, not-found fallbacks), which would otherwise cause a hydration mismatch.
  const isActive = (href: string) => mounted && (pathname === href || pathname.startsWith(`${href}/`));
  const portalActive = isActive(PORTAL.href);

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-background/80 backdrop-blur-xl">
      <div className="page-shell flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/" aria-label="onCV ana sayfa" className="rounded-md transition-opacity hover:opacity-90">
            <OnCVLogo />
          </Link>
          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Ana menü">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm transition-colors",
                  isActive(href) ? "text-zinc-50" : "text-zinc-400 hover:text-brand-100",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {isActive(href) && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-md border border-brand-600/30 bg-brand-500/10"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                )}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 whitespace-nowrap rounded-md border border-zinc-800 px-2.5 py-1 font-mono text-[11px] text-zinc-400 2xl:inline-flex">
            <span className="accent-dot animate-pulse-dot" />
            Avalanche Fuji
          </span>
          {/* Subtle entry point for verified organizations; /organizer enforces the on-chain verification. */}
          <Link
            href={PORTAL.href}
            title={PORTAL.hint}
            aria-label={`${PORTAL.label} · ${PORTAL.hint}`}
            aria-current={portalActive ? "page" : undefined}
            className={cn(
              "hidden h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs transition-colors sm:inline-flex",
              portalActive
                ? "border-brand-600/50 bg-brand-500/10 text-brand-100"
                : "border-zinc-800 text-zinc-500 hover:border-brand-600/50 hover:text-brand-100",
            )}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{PORTAL.label}</span>
          </Link>
          <ConnectWalletButton />
          <button
            type="button"
            className="btn-ghost h-9 w-9 !px-0 lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-zinc-800 lg:hidden"
            aria-label="Mobil menü"
          >
            <div className="page-shell flex flex-col gap-1 py-3">
              <Link href="/" className="mb-1 flex items-center rounded-lg px-3 py-2">
                <OnCVLogo />
              </Link>
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive(href) ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                    isActive(href) ? "bg-brand-500/10 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900/60",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
              <div className="my-1.5 border-t border-zinc-800" aria-hidden />
              <Link
                href={PORTAL.href}
                aria-current={portalActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                  portalActive ? "bg-brand-500/10 text-brand-100" : "text-zinc-500 hover:bg-zinc-900/60 hover:text-brand-100",
                )}
              >
                <Building2 className="h-4 w-4" />
                <span className="flex flex-col">
                  {PORTAL.label}
                  <span className="text-xs text-zinc-600">{PORTAL.hint}</span>
                </span>
              </Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

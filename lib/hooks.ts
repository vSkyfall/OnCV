"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getAppUrl } from "@/config/contract";
import { hasInjectedWallet, isMobileDevice } from "./wallet-env";

const noopSubscribe = () => () => {};

/** false during SSR and hydration, true afterwards. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Public app base URL (NEXT_PUBLIC_APP_URL or window.location.origin); null during SSR. */
export function useAppUrl(): string | null {
  return useSyncExternalStore(noopSubscribe, getAppUrl, () => null);
}

/** Ticking clock in ms; null until mounted so server and client markup match. */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export type ClientEnv = { mobile: boolean; injected: boolean; href: string };

/** Device / wallet environment, read once after mount. */
export function useClientEnv(): ClientEnv | null {
  const [env, setEnv] = useState<ClientEnv | null>(null);
  useEffect(() => {
    setEnv({ mobile: isMobileDevice(), injected: hasInjectedWallet(), href: window.location.href });
  }, []);
  return env;
}

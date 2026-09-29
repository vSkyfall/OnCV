"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider, darkTheme, type DisclaimerComponent, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { BRAND } from "@/config/brand";
import { fuji, wagmiConfig } from "@/config/wagmi";

const baseTheme = darkTheme({
  accentColor: "#FAFAFA",
  accentColorForeground: "#09090B",
  borderRadius: "medium",
  fontStack: "system",
  overlayBlur: "small",
});

const theme: Theme = {
  ...baseTheme,
  colors: {
    ...baseTheme.colors,
    modalBackground: "#09090B",
    modalBorder: "#27272A",
    generalBorder: "#27272A",
    generalBorderDim: "#18181B",
    menuItemBackground: "#18181B",
    profileForeground: "#09090B",
    profileAction: "#18181B",
    profileActionHover: "#27272A",
    connectButtonBackground: "#18181B",
    modalText: "#FAFAFA",
    modalTextSecondary: "#A1A1AA",
    closeButton: "#A1A1AA",
    closeButtonBackground: "#18181B",
  },
  shadows: {
    ...baseTheme.shadows,
    dialog: "0 0 0 1px rgba(255,255,255,0.06), 0 30px 80px -24px rgba(0,0,0,0.9)",
  },
};

const Disclaimer: DisclaimerComponent = ({ Text, Link }) => (
  <Text>
    {BRAND.name} kimlik bilgilerini Avalanche Fuji Testnet&apos;e yazar. En akıcı deneyim için{" "}
    <Link href="https://web3.okx.com/download">OKX Wallet</Link> önerilir; MetaMask tam desteklenir.
  </Text>
);

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Chain reads stay fresh for 15 s: revisited pages render from cache without new RPC calls (the
          // public Fuji RPC is rate limited). Writes invalidate everything (lib/use-tx.ts) and live panels
          // use their own refetchInterval, so nothing shows stale data after an action.
          queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 2 },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={theme}
          initialChain={fuji}
          modalSize="wide"
          appInfo={{
            appName: BRAND.name,
            learnMoreUrl: "https://build.avax.network/docs",
            disclaimer: Disclaimer,
          }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

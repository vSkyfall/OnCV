import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { BRAND } from "./brand";
import { FUJI_RPC_URL, browserRpcUrl, fuji } from "./chain";

export { FUJI_RPC_URL, fuji };

/** True when the WalletConnect project id is missing: mobile QR connections only work on localhost then. */
export const WALLETCONNECT_MISSING = !process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

/**
 * WalletConnect Cloud project id (free at https://cloud.reown.com). Needed for OKX / MetaMask mobile
 * QR connections. "YOUR_PROJECT_ID" makes RainbowKit fall back to its localhost-only demo id.
 */
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || "YOUR_PROJECT_ID";

export const RECOMMENDED_WALLET_GROUP = "Recommended for Web3 CV";

const connectors = connectorsForWallets(
  [
    // OKX Wallet is always the first option in the modal, followed by MetaMask.
    { groupName: RECOMMENDED_WALLET_GROUP, wallets: [okxWallet, metaMaskWallet] },
    { groupName: "Other wallets", wallets: [coinbaseWallet, rabbyWallet, walletConnectWallet, injectedWallet] },
  ],
  {
    appName: BRAND.name,
    appDescription: BRAND.tagline,
    // Falls back to window.location.origin inside RainbowKit, which keeps WalletConnect metadata accurate.
    appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || undefined,
    projectId: walletConnectProjectId,
  },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [fuji],
  transports: {
    [fuji.id]: http(browserRpcUrl(), { batch: true }),
  },
  // With EIP-6963 discovery on, RainbowKit moves every installed extension into an "Installed" group in
  // arbitrary order. Turning it off keeps OKX Wallet pinned to the top of the curated list above;
  // the OKX / MetaMask connectors still detect their injected providers directly.
  multiInjectedProviderDiscovery: false,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

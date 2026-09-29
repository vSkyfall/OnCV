"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { AvalancheLogo, OkxLogo } from "@/components/brand/Logos";
import { Identicon } from "@/components/ui/Identicon";
import { cn } from "@/lib/utils";

type Props = {
  size?: "md" | "lg";
  variant?: "primary" | "secondary";
  fullWidth?: boolean;
  label?: string;
  className?: string;
};

/**
 * Wallet button built on RainbowKit's ConnectButton.Custom. OKX Wallet is the highlighted default;
 * the modal lists OKX first under "Recommended for Web3 CV", followed by MetaMask.
 */
export function ConnectWalletButton({
  size = "md",
  variant = "primary",
  fullWidth,
  label = "Connect Wallet",
  className,
}: Props) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, authenticationStatus, mounted }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && chain;

        return (
          <div
            aria-hidden={!ready}
            className={cn(!ready && "pointer-events-none select-none opacity-0", fullWidth && "w-full", className)}
          >
            {!connected ? (
              <button
                type="button"
                onClick={openConnectModal}
                className={cn(
                  variant === "primary" ? "btn-primary" : "btn-secondary",
                  size === "lg" && "btn-lg",
                  fullWidth && "w-full",
                )}
              >
                <OkxLogo className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} />
                <span>{label}</span>
                <span
                  className={cn(
                    "hidden rounded border px-1.5 py-px font-mono text-[10px] font-medium xl:inline",
                    variant === "primary" ? "border-zinc-300 text-zinc-600" : "border-zinc-700 text-zinc-400",
                    size === "lg" && "inline",
                  )}
                >
                  OKX önerilir
                </span>
              </button>
            ) : chain.unsupported ? (
              <button
                type="button"
                onClick={openChainModal}
                className={cn("btn-accent", size === "lg" && "btn-lg", fullWidth && "w-full")}
              >
                <TriangleAlert className="h-4 w-4" />
                Avalanche Fuji&apos;ye geç
              </button>
            ) : (
              <div className={cn("flex items-center gap-2", fullWidth && "w-full")}>
                <button
                  type="button"
                  onClick={openChainModal}
                  className="btn-secondary hidden !px-2.5 md:inline-flex"
                  title="Ağ"
                >
                  <AvalancheLogo className="h-4 w-4" />
                  <span className="text-xs">Fuji</span>
                </button>
                <button
                  type="button"
                  onClick={openAccountModal}
                  className={cn("btn-secondary !pl-1.5", fullWidth && "w-full justify-between")}
                >
                  <span className="flex items-center gap-2">
                    <Identicon address={account.address} size={22} />
                    <span className="font-mono text-[13px]">{account.displayName}</span>
                  </span>
                  {account.displayBalance && (
                    <span className="hidden font-mono text-xs text-zinc-500 lg:inline">{account.displayBalance}</span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                </button>
              </div>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

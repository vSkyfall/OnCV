"use client";

import { QrCode, RefreshCw, UserSquare2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { IconTile, Notice, Spinner } from "@/components/ui/primitives";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { fuji } from "@/config/chain";
import { KIOSK_CONSENT_TYPES, KIOSK_PASS_SECONDS, checkInDomain } from "@/config/contract";
import { encodeKioskPass } from "@/lib/checkin-code";
import { parseWeb3Error } from "@/lib/errors";
import { useNow } from "@/lib/hooks";

/**
 * Kiosk mode, attendee side: when the attendee cannot scan (no camera, crowded door, online relay down),
 * they sign a short-lived consent (free, no transaction) and show it as a personal QR. The organizer's
 * device scans it, co-signs with the event's QR key and submits the check-in; the attendee pays no gas.
 */
export function KioskPassCard() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const now = useNow(1000);
  const [payload, setPayload] = useState<{ value: string; deadline: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      // Wallets refuse EIP-712 signatures whose domain chainId differs from the active chain.
      if (chainId !== fuji.id) await switchChainAsync({ chainId: fuji.id });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + KIOSK_PASS_SECONDS);
      const signature = await signTypedDataAsync({
        domain: checkInDomain(),
        types: KIOSK_CONSENT_TYPES,
        primaryType: "KioskConsent",
        message: { attendee: address, deadline },
      });
      setPayload({ value: encodeKioskPass({ attendee: address, deadline, signature }), deadline: Number(deadline) });
    } catch (err) {
      setError(parseWeb3Error(err));
    } finally {
      setBusy(false);
    }
  }

  const secondsLeft = payload && now !== null ? Math.max(0, Math.floor(payload.deadline - now / 1000)) : null;
  const expired = secondsLeft === 0;
  const stale = payload && address && !payload.value.toLowerCase().includes(address.toLowerCase());

  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <IconTile>
          <UserSquare2 className="h-4 w-4" />
        </IconTile>
        <div>
          <h2 className="text-sm font-semibold text-zinc-50">QR okutamıyor musunuz?</h2>
          <p className="text-xs text-zinc-500">Kişisel QR&apos;ınızı gösterin; organizatör cihazı okutup check-in&apos;inizi yapar.</p>
        </div>
      </div>

      {!isConnected ? (
        <div className="mt-4">
          <ConnectWalletButton fullWidth variant="secondary" />
        </div>
      ) : payload && !expired && !stale ? (
        <div className="mt-4 flex flex-col items-center">
          <div className="rounded-xl bg-white p-3">
            <QRCodeSVG value={payload.value} size={220} level="M" marginSize={0} />
          </div>
          <p className="mt-3 font-mono text-xs tabular-nums text-zinc-400">{secondsLeft} sn geçerli</p>
          <p className="mt-1 text-center text-xs text-zinc-500">
            Bu QR yalnızca katılım onayınızdır; işlem göndermez ve gas ücreti yoktur. Organizatör cihazı hangi
            etkinlik için okuttuğunu kendi anahtarıyla imzalar.
          </p>
        </div>
      ) : (
        <button type="button" className="btn-secondary mt-4 w-full" onClick={create} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : expired || stale ? <RefreshCw className="h-4 w-4" /> : <QrCode className="h-4 w-4" />}
          {expired || stale ? "QR'ı yenile" : "Kişisel check-in QR'ımı oluştur"}
        </button>
      )}
      {error && (
        <Notice tone="danger" className="mt-3">
          {error}
        </Notice>
      )}
    </div>
  );
}

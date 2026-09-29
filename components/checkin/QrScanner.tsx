"use client";

import jsQR from "jsqr";
import { CameraOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  /** Return true to accept the payload (and stop scanning unless `continuous`). */
  onResult: (payload: string) => boolean;
  onClose: () => void;
  /**
   * Keep scanning after an accepted code (kiosk mode). A payload is reported once while it stays in view and
   * again after it has left the frame, so a code whose submission failed can be re-scanned.
   */
  continuous?: boolean;
  /** Shown when a code is read but rejected. */
  rejectHint?: string;
};

const SCAN_INTERVAL_MS = 150;
const MAX_SCAN_WIDTH = 640;
/** Scans without the last accepted code after which it counts as having left the frame (~1 s). */
const LEFT_FRAME_SCANS = 7;

/** In-page QR scanner (useful inside wallet dApp browsers where the phone camera app is not available). */
export function QrScanner({ onResult, onClose, continuous = false, rejectHint = "Bu bir onCV check-in QR kodu değil." }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onResultRef = useRef(onResult);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    let lastRejected = "";
    let lastAccepted = "";
    let scansWithoutAccepted = 0;

    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    const scan = () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        const scale = Math.min(1, MAX_SCAN_WIDTH / video.videoWidth);
        const width = Math.floor(video.videoWidth * scale);
        const height = Math.floor(video.videoHeight * scale);
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height);
          const image = ctx.getImageData(0, 0, width, height);
          const result = jsQR(image.data, width, height, { inversionAttempts: "dontInvert" });
          if (result?.data === lastAccepted) scansWithoutAccepted = 0;
          else if (lastAccepted && ++scansWithoutAccepted >= LEFT_FRAME_SCANS) lastAccepted = "";
          if (result?.data && result.data !== lastAccepted) {
            if (onResultRef.current(result.data)) {
              if (!continuous) {
                stop();
                return;
              }
              lastAccepted = result.data;
              scansWithoutAccepted = 0;
              setHint(null);
            } else if (result.data !== lastRejected) {
              lastRejected = result.data;
              setHint(rejectHint);
            }
          }
        }
      }
      timer = window.setTimeout(scan, SCAN_INTERVAL_MS);
    };

    async function start() {
      if (!window.isSecureContext) {
        setError("Kamera yalnızca HTTPS üzerinden kullanılabilir.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Bu tarayıcı kamera erişimini desteklemiyor. Telefonunuzun kamera uygulamasıyla okutun.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        scan();
      } catch (err) {
        const name = (err as DOMException)?.name;
        setError(
          name === "NotAllowedError"
            ? "Kamera izni reddedildi. Tarayıcı ayarlarından kamera iznini açın."
            : "Kamera başlatılamadı. Telefonunuzun kamera uygulamasıyla okutmayı deneyin.",
        );
      }
    }

    void start();
    return stop;
  }, [continuous, rejectHint]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <span className="text-sm font-medium text-zinc-100">QR kodu çerçeveye hizalayın</span>
        <button type="button" className="btn-ghost !p-1.5" onClick={onClose} aria-label="Tarayıcıyı kapat">
          <X className="h-4 w-4" />
        </button>
      </div>
      {error ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-sm text-zinc-400">
          <CameraOff className="h-8 w-8 text-zinc-500" />
          {error}
        </div>
      ) : (
        <div className="relative aspect-square w-full bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-3/5 w-3/5">
              {["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"].map(
                (pos) => (
                  <span key={pos} className={`absolute h-8 w-8 rounded-sm border-zinc-100 ${pos}`} />
                ),
              )}
              <span className="absolute inset-x-2 top-1/2 h-px animate-pulse-dot bg-brand-500" />
            </div>
          </div>
          {hint && (
            <div className="absolute inset-x-4 bottom-4 rounded-md border border-zinc-800 bg-background/90 px-3 py-2 text-center text-xs text-amber-300">
              {hint}
            </div>
          )}
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

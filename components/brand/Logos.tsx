import Image from "next/image";
import mark from "@/public/brand/oncv-mark-128.png";
import { cn } from "@/lib/utils";

type LogoProps = { className?: string };

/** onCV mark: the red panda logo (transparent PNG generated from the brand artwork). */
export function OnCVMark({ className, priority }: LogoProps & { priority?: boolean }) {
  return (
    <Image
      src={mark}
      alt=""
      aria-hidden
      priority={priority}
      sizes="64px"
      className={cn("object-contain", className)}
    />
  );
}

export function OnCVLogo({ className }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <OnCVMark className="h-8 w-8" priority />
      <span className="text-[17px] font-semibold tracking-tight">
        <span className="text-zinc-400">on</span>
        <span className="text-zinc-50">CV</span>
      </span>
    </span>
  );
}

/** OKX mark: five squares in an X pattern. */
export function OkxLogo({ className }: LogoProps) {
  const cells: Array<[number, number]> = [
    [5.1, 5.1],
    [14.3, 5.1],
    [9.7, 9.7],
    [5.1, 14.3],
    [14.3, 14.3],
  ];
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="OKX Wallet">
      <rect width="24" height="24" rx="5" fill="#000" />
      <rect x="0.5" y="0.5" width="23" height="23" rx="4.5" fill="none" stroke="rgba(255,255,255,0.16)" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="4.6" height="4.6" fill="#fff" />
      ))}
    </svg>
  );
}

/** Avalanche keeps its own brand red (#E84142), independent of the onCV palette. */
export function AvalancheLogo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Avalanche">
      <circle cx="16" cy="16" r="16" fill="#E84142" />
      <path
        fill="#fff"
        d="M11.14 22.4H8.02c-.66 0-.98 0-1.18-.13a.8.8 0 0 1-.36-.62c-.01-.23.15-.52.48-1.1l7.7-13.58c.33-.58.5-.87.71-.98a.8.8 0 0 1 .72 0c.21.11.38.4.71.98l1.58 2.77c.35.62.53.93.61 1.26.09.36.09.74 0 1.1-.08.33-.26.64-.62 1.27l-4.05 7.15c-.35.62-.53.93-.78 1.17-.27.26-.6.45-.96.56-.33.09-.7.09-1.43.09Zm7.87 0h4.47c.66 0 .99 0 1.19-.13.21-.14.35-.37.36-.62.01-.22-.15-.5-.47-1.06l-2.27-3.89c-.31-.53-.47-.8-.68-.9a.8.8 0 0 0-.71 0c-.2.1-.37.39-.7.95l-2.23 3.85c-.33.57-.5.85-.48 1.08.01.25.14.48.35.62.2.13.52.13 1.17.13Z"
      />
    </svg>
  );
}

export function LinkedInIcon({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}

export function XIcon({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" />
    </svg>
  );
}

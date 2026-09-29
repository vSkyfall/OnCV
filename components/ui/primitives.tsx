"use client";

import { animate, useInView } from "framer-motion";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("h-4 w-4 animate-spin", className)} aria-hidden />;
}

export function CopyButton({
  value,
  label,
  className,
  iconOnly,
}: {
  value: string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(iconOnly ? "btn-ghost h-8 w-8 !px-0" : "btn-secondary", className)}
      aria-label={label ?? "Kopyala"}
      title={label ?? "Kopyala"}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      {!iconOnly && <span>{copied ? "Kopyalandı" : (label ?? "Kopyala")}</span>}
    </button>
  );
}

export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const previous = useRef(0);

  useEffect(() => {
    if (!inView || !ref.current) return;
    const node = ref.current;
    const controls = animate(previous.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        node.textContent = Math.round(latest).toLocaleString("tr-TR");
      },
    });
    previous.current = value;
    return () => controls.stop();
  }, [value, inView]);

  // The visible text counts up once scrolled into view; assistive tech gets the real value immediately.
  return (
    <span ref={ref} className={cn("tabular-nums", className)} role="img" aria-label={value.toLocaleString("tr-TR")}>
      0
    </span>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h2 className="text-lg font-semibold tracking-tight text-zinc-50 sm:text-xl">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-zinc-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "border-zinc-800 bg-zinc-900/60 text-zinc-300",
  success: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300",
  warning: "border-amber-500/20 bg-amber-500/[0.06] text-amber-200",
  danger: "border-brand-500/25 bg-brand-500/[0.07] text-brand-300",
  info: "border-zinc-700 bg-zinc-900 text-zinc-300",
};

export function Notice({
  tone = "neutral",
  icon,
  title,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-3 rounded-lg border px-3.5 py-3 text-sm", toneClasses[tone], className)} role="status">
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 space-y-0.5">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className="text-[13px] leading-relaxed opacity-90">{children}</div>}
      </div>
    </div>
  );
}

/** Small icon tile used in list rows and cards. */
export function IconTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300",
        className,
      )}
    >
      {children}
    </div>
  );
}

import { cn } from "@/lib/utils";

/**
 * Official "blue tick" shown next to admin-verified organizers.
 * Geometry follows lucide's BadgeCheck icon, filled so the check reads at small sizes.
 */
export function VerifiedBadge({ className, title = "Verified organizer" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4 shrink-0", className)} role="img" aria-label={title}>
      <title>{title}</title>
      <path
        fill="#1D9BF0"
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
      />
      <path d="m9 12 2 2 4-4" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Organizer name with the blue tick when the event was created by a verified organizer. */
export function OrganizerName({
  name,
  verified,
  className,
  badgeClassName,
}: {
  name: string;
  verified: boolean;
  className?: string;
  badgeClassName?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <span className="truncate">{name}</span>
      {verified && <VerifiedBadge className={cn("h-3.5 w-3.5", badgeClassName)} />}
    </span>
  );
}

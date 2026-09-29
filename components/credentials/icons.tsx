import {
  Award,
  BadgeCheck,
  CircleDashed,
  Compass,
  Flame,
  Gem,
  GraduationCap,
  Hammer,
  Medal,
  Network,
  Presentation,
  Trophy,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { DerivedBadge, TierId } from "@/lib/credentials";

const CATEGORY_ICONS: Record<number, LucideIcon> = {
  0: Wrench,
  1: Trophy,
  2: Presentation,
  3: Users,
  4: GraduationCap,
};

const MILESTONE_ICONS: Record<string, LucideIcon> = {
  "first-proof": BadgeCheck,
  consistent: Flame,
  veteran: Medal,
  networker: Network,
};

const TIER_ICONS: Record<TierId, LucideIcon> = {
  newcomer: CircleDashed,
  explorer: Compass,
  contributor: Award,
  builder: Hammer,
  "senior-builder": Medal,
  "web3-builder": Gem,
};

export function categoryIcon(category: number): LucideIcon {
  return CATEGORY_ICONS[category] ?? Wrench;
}

export function badgeIcon(badge: DerivedBadge): LucideIcon {
  if (badge.kind === "category" && badge.category !== undefined) return categoryIcon(badge.category);
  return MILESTONE_ICONS[badge.id] ?? BadgeCheck;
}

export function tierIcon(tier: TierId): LucideIcon {
  return TIER_ICONS[tier];
}

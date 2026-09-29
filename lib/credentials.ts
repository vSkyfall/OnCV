import type { ProofEvent } from "@/config/contract";

// ---------------------------------------------------------------------------
// Categories (must match `enum Category` in ProofSkill.sol)
// ---------------------------------------------------------------------------

export const EVENT_CATEGORIES = [
  { value: 0, label: "Workshop", badge: "Hands-on Workshop" },
  { value: 1, label: "Hackathon", badge: "Hackathon Participant" },
  { value: 2, label: "Conference", badge: "Conference Attendee" },
  { value: 3, label: "Meetup", badge: "Community Member" },
  { value: 4, label: "Bootcamp", badge: "Bootcamp Graduate" },
] as const;

export type CategoryValue = (typeof EVENT_CATEGORIES)[number]["value"];

export function categoryMeta(value: number) {
  return EVENT_CATEGORIES.find((c) => c.value === value) ?? EVENT_CATEGORIES[0];
}

// ---------------------------------------------------------------------------
// Proof Score tiers
// ---------------------------------------------------------------------------

/** Rendered with lucide icons (see components/credentials/icons.tsx), never emoji. */
export const TIERS = [
  { id: "newcomer", min: 0, title: "Newcomer" },
  { id: "explorer", min: 25, title: "Explorer" },
  { id: "contributor", min: 50, title: "Contributor" },
  { id: "builder", min: 100, title: "Builder" },
  { id: "senior-builder", min: 175, title: "Senior Builder" },
  { id: "web3-builder", min: 250, title: "Web3 Builder" },
] as const;

export type TierId = (typeof TIERS)[number]["id"];

export type Tier = (typeof TIERS)[number];

export function getTier(score: number): { current: Tier; next: Tier | null; progress: number } {
  let index = 0;
  TIERS.forEach((tier, i) => {
    if (score >= tier.min) index = i;
  });
  const current = TIERS[index];
  const next = TIERS[index + 1] ?? null;
  const progress = next ? (score - current.min) / (next.min - current.min) : 1;
  return { current, next, progress: Math.min(1, Math.max(0, progress)) };
}

// ---------------------------------------------------------------------------
// Skills (derived from event skill tags + event names)
// ---------------------------------------------------------------------------

export const SKILL_CATALOG = [
  { label: "Solidity", keywords: ["solidity", "smart contract", "smart contracts", "evm"] },
  { label: "Avalanche", keywords: ["avalanche", "avax", "subnet", "avalanche l1", "teleporter"] },
  { label: "DeFi", keywords: ["defi", "dex", "amm", "lending", "stablecoin"] },
  { label: "AI Engineering", keywords: ["ai", "ai engineering", "llm", "machine learning", "ml", "agents", "ai agents"] },
  { label: "Zero Knowledge", keywords: ["zk", "zero knowledge", "zero-knowledge", "zkp"] },
  { label: "Smart Contract Security", keywords: ["security", "audit", "auditing"] },
  { label: "dApp Frontend", keywords: ["frontend", "react", "next.js", "nextjs", "dapp", "wagmi", "viem"] },
  { label: "NFT & Gaming", keywords: ["nft", "nfts", "gaming", "gamefi", "game"] },
  { label: "Rust", keywords: ["rust"] },
  { label: "Tokenomics", keywords: ["tokenomics", "token design"] },
  { label: "RWA", keywords: ["rwa", "real world assets", "tokenization"] },
  { label: "Product & Design", keywords: ["product", "design", "ux", "ui/ux"] },
] as const;

/** Suggestions shown in the organizer form. */
export const SUGGESTED_SKILL_TAGS = [
  "Solidity",
  "Avalanche",
  "DeFi",
  "AI Engineering",
  "Zero Knowledge",
  "Smart Contract Security",
  "dApp Frontend",
  "NFT & Gaming",
  "RWA",
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchCatalog(text: string): string[] {
  const lower = text.toLowerCase();
  return SKILL_CATALOG.filter((skill) =>
    skill.keywords.some((keyword) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`).test(lower)),
  ).map((skill) => skill.label);
}

export function parseSkillTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Participation intensity in a skill area (verified attendance count), NOT a competence assessment:
 * attending a workshop proves exposure to a topic, not mastery of it.
 */
export type SkillLevel = "İlk temas" | "Tekrarlayan" | "Yoğun katılım";

export type DerivedSkill = {
  label: string;
  count: number;
  level: SkillLevel;
  events: string[];
};

export function deriveSkills(events: readonly ProofEvent[]): DerivedSkill[] {
  const skills = new Map<string, { count: number; events: string[] }>();

  for (const event of events) {
    const labels = new Set<string>();
    for (const tag of parseSkillTags(event.skillTags)) {
      const matched = matchCatalog(tag);
      if (matched.length > 0) matched.forEach((label) => labels.add(label));
      else labels.add(tag);
    }
    matchCatalog(event.name).forEach((label) => labels.add(label));

    for (const label of labels) {
      const entry = skills.get(label) ?? { count: 0, events: [] };
      entry.count += 1;
      entry.events.push(event.name);
      skills.set(label, entry);
    }
  }

  return [...skills.entries()]
    .map(([label, { count, events: names }]) => ({
      label,
      count,
      events: names,
      level: (count >= 3 ? "Yoğun katılım" : count === 2 ? "Tekrarlayan" : "İlk temas") as SkillLevel,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type BadgeKind = "category" | "milestone";

export type DerivedBadge = {
  id: string;
  title: string;
  description: string;
  kind: BadgeKind;
  category?: number;
  count?: number;
};

export function deriveBadges(events: readonly ProofEvent[]): DerivedBadge[] {
  const badges: DerivedBadge[] = [];
  const total = events.length;

  const byCategory = new Map<number, number>();
  for (const event of events) {
    byCategory.set(event.category, (byCategory.get(event.category) ?? 0) + 1);
  }
  for (const [category, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    const meta = categoryMeta(category);
    badges.push({
      id: `category-${category}`,
      title: meta.badge,
      description: `${count} doğrulanmış ${meta.label.toLowerCase()} katılımı`,
      kind: "category",
      category,
      count,
    });
  }

  if (total >= 1) {
    badges.push({ id: "first-proof", title: "First Proof", description: "İlk on-chain katılım kanıtı", kind: "milestone" });
  }
  if (total >= 3) {
    badges.push({ id: "consistent", title: "Consistent Learner", description: "3+ doğrulanmış etkinlik", kind: "milestone" });
  }
  if (total >= 5) {
    badges.push({ id: "veteran", title: "Ecosystem Veteran", description: "5+ doğrulanmış etkinlik", kind: "milestone" });
  }
  const organizers = new Set(events.map((e) => e.organizer.trim().toLowerCase()).filter(Boolean));
  if (organizers.size >= 3) {
    badges.push({
      id: "networker",
      title: "Cross-Community Networker",
      description: `${organizers.size} farklı organizatörün etkinliği`,
      kind: "milestone",
    });
  }

  return badges;
}

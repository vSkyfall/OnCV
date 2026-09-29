/**
 * onCV brand standard: name, tagline, copy and visual identity used by metadata, share cards and the UI.
 * The mark is the red panda logo (public/brand/oncv-mark.png); its palette is the `brand` color scale in
 * tailwind.config.ts.
 */
export const BRAND = {
  name: "onCV",
  domain: "oncv.xyz",
  url: "https://oncv.xyz",
  tagline: "Verifiable On-Chain Credentials & Attendance Infrastructure.",
  /** Meta description (site language is Turkish; ~150 characters for search snippets). */
  description:
    "Doğrulanmış kurumların etkinlik katılımlarını Avalanche üzerinde devredilemez kimlik bilgilerine dönüştürür: dinamik QR check-in, Web3 CV ve proje takibi.",
  keywords: [
    "onCV",
    "Web3 CV",
    "on-chain credentials",
    "proof of attendance",
    "verifiable credentials",
    "soulbound",
    "hackathon",
    "Avalanche",
    "OKX Wallet",
  ],
  mark: "/brand/oncv-mark.png",
  themeColor: "#09090B",
  accent: "#DD3136",
} as const;

/** Where unverified organizers send verification requests (override with NEXT_PUBLIC_VERIFICATION_EMAIL). */
export const VERIFICATION_EMAIL = process.env.NEXT_PUBLIC_VERIFICATION_EMAIL?.trim() || `verify@${BRAND.domain}`;

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BRAND } from "@/config/brand";

// /profile shows the connected wallet's own CV, so it is not indexed; public CVs (/[address],
// /profile/[address]) set their own title and re-enable indexing.
export const metadata: Metadata = {
  // Object form keeps "· onCV" on /profile/[address] (a plain string would reset the root title template).
  title: { default: "Web3 CV", template: `%s · ${BRAND.name}` },
  description: "Avalanche üzerinde doğrulanmış etkinlik katılımlarınız, Proof Score'unuz, projeleriniz ve beceri alanlarınız.",
  robots: { index: false, follow: true },
};

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return children;
}

import type { Metadata } from "next";
import type { ReactNode } from "react";

// Enterprise Portal: organizer and admin tools. Access is enforced on-chain; the page is kept out of search.
export const metadata: Metadata = {
  title: "Enterprise Portal",
  description: "Doğrulanmış kurumlar ve onCV yöneticileri için etkinlik, dinamik QR ve doğrulama yönetimi.",
  alternates: { canonical: "/organizer" },
  robots: { index: false, follow: false },
};

export default function OrganizerLayout({ children }: { children: ReactNode }) {
  return children;
}

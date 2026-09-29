import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  // Object form keeps "· onCV" on nested pages (a plain string would reset the root title template).
  title: { default: "Projeler", template: `%s · ${BRAND.name}` },
  description:
    "Hackathon sonrası yaşayan projeler: 3. ve 6. ay kontrol noktaları, organizatör ve yatırımcı onaylı ilerleme, zincirde doğrulanabilir.",
  alternates: { canonical: "/projects" },
};

export default function ProjectsLayout({ children }: { children: ReactNode }) {
  return children;
}

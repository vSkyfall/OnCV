import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Proje Kaydı",
  description: "Etkinliğe katıldığınız projeyi kaydedin, takım arkadaşlarınızı davet edin ve 3. / 6. ay takibini başlatın.",
  alternates: { canonical: "/projects/new" },
  robots: { index: false, follow: true },
};

export default function NewProjectLayout({ children }: { children: ReactNode }) {
  return children;
}

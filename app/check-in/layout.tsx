import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Etkinlik Check-In",
  description:
    "Organizatör ekranındaki dinamik QR'ı okutun, konumunuz ve cüzdanınızla katılımınızı Avalanche'a yazın. Gas ücreti yok.",
  alternates: { canonical: "/check-in" },
};

export default function CheckInLayout({ children }: { children: ReactNode }) {
  return children;
}

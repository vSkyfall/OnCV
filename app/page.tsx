import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

// Title and description come from the root layout (onCV · tagline).
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <LandingPage />;
}

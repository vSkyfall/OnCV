import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import { Navbar } from "@/components/layout/Navbar";
import { BRAND } from "@/config/brand";
import { siteUrl } from "@/lib/site-url";
import { Providers } from "./providers";
import "./globals.css";

const resolveMetadataBase = () => new URL(siteUrl());

/**
 * onCV metadata standard:
 * - Titles: "<Page> · onCV"; the landing page uses "onCV · <tagline>".
 * - Descriptions in Turkish (site language), ~150 characters.
 * - Pages set only title / description / canonical / robots. openGraph and twitter titles are filled from
 *   them automatically, and the share image comes from the nearest opengraph-image file (the root one shows
 *   the red panda mark). A page must not define its own `openGraph` object, or it drops that image.
 * - Favicon / apple icon: app/icon.png and app/apple-icon.png (generated from the logo); PWA: app/manifest.ts.
 */
export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: {
    default: `${BRAND.name} · ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  keywords: [...BRAND.keywords],
  authors: [{ name: BRAND.name, url: BRAND.url }],
  creator: BRAND.name,
  publisher: BRAND.name,
  category: "technology",
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "tr_TR",
    siteName: BRAND.name,
  },
  twitter: {
    card: "summary_large_image",
  },
  appleWebApp: {
    title: BRAND.name,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: BRAND.themeColor,
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-zinc-100 antialiased">
        <Providers>
          <div className="relative flex min-h-screen flex-col overflow-x-clip">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[560px]">
              <div className="bg-grid mask-fade-b absolute inset-0" />
              <div className="absolute left-1/2 top-[-280px] h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-white/[0.035] blur-[110px]" />
            </div>
            <Navbar />
            <main className="relative z-10 flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}

import { BRAND } from "@/config/brand";

/** Absolute public origin for metadata files (NEXT_PUBLIC_APP_URL, else the brand domain). */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the brand URL
    }
  }
  return BRAND.url;
}

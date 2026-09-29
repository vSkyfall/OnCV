import type { MetadataRoute } from "next";
import { BRAND } from "@/config/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} · ${BRAND.tagline}`,
    short_name: BRAND.name,
    description: BRAND.description,
    lang: "tr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BRAND.themeColor,
    theme_color: BRAND.themeColor,
    categories: ["productivity", "education", "business"],
    icons: [
      { src: "/brand/oncv-mark-128.png", sizes: "128x128", type: "image/png" },
      { src: BRAND.mark, sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}

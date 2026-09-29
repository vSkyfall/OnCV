import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/** Public, wallet-independent pages. Individual Web3 CVs and projects are reached through shared links. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/projects`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/check-in`, changeFrequency: "monthly", priority: 0.5 },
  ];
}

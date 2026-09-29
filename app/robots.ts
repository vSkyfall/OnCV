import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Enterprise Portal, wallet-specific and API routes are not for search engines.
      disallow: ["/api/", "/organizer", "/profile$", "/projects/new"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}

import type { MetadataRoute } from "next";
import { isPublicSite, siteUrl } from "@/core/site";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (!isPublicSite()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/ops", "/api/"] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

import type { MetadataRoute } from "next";

const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") ||
  "https://yehthatrocks.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/account/", "/admin/"],
      },
    ],
    sitemap: [
      `${SITE_ORIGIN}/sitemap/0.xml`,
      `${SITE_ORIGIN}/sitemap/1.xml`,
      `${SITE_ORIGIN}/sitemap/2.xml`,
      `${SITE_ORIGIN}/sitemap/3.xml`,
      `${SITE_ORIGIN}/sitemap/4.xml`,
    ],
  };
}

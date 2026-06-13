import type { MetadataRoute } from "next";

const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") ||
  "https://yehthatrocks.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "GPTBot",
        crawlDelay: 30,
        allow: "/",
        disallow: ["/api/", "/account/", "/admin/"],
      },
      {
        userAgent: "Applebot",
        crawlDelay: 30,
        allow: "/",
        disallow: ["/api/", "/account/", "/admin/"],
      },
      {
        userAgent: "Amazonbot",
        crawlDelay: 30,
        allow: "/",
        disallow: ["/api/", "/account/", "/admin/"],
      },
      {
        userAgent: "*",
        crawlDelay: 10,
        allow: "/",
        disallow: ["/api/", "/account/", "/admin/"],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
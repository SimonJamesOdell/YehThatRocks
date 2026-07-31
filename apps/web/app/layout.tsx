import type { Metadata } from "next";
import { Metal_Mania } from "next/font/google";

import { PerformanceMeasureGuard } from "@/components/performance-measure-guard";
import { YouTubeIframeApiLoader } from "@/components/youtube-iframe-api-loader";
import { buildWebSite } from "@/lib/schema-org";
import "./globals.css";

const metalMania = Metal_Mania({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display"
});

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";
const DEFAULT_SHARE_IMAGE = "/images/yeh_share_fb.png";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: "YehThatRocks | The World's LOUDEST Website",
  description:
    "Community-driven rock and metal streaming, discovery, chat, and catalogue depth rebuilt for the modern web.",
  openGraph: {
    title: "YehThatRocks | The World's LOUDEST Website",
    description:
      "Community-driven rock and metal streaming, discovery, chat, and catalogue depth rebuilt for the modern web.",
    url: "/",
    siteName: "YehThatRocks",
    type: "website",
    images: [
      {
        url: DEFAULT_SHARE_IMAGE,
        alt: "YehThatRocks background artwork",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "YehThatRocks | The World's LOUDEST Website",
    description:
      "Community-driven rock and metal streaming, discovery, chat, and catalogue depth rebuilt for the modern web.",
    images: [DEFAULT_SHARE_IMAGE],
  },
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <head>
        <link rel="dns-prefetch" href="https://www.youtube.com" />
        <link rel="dns-prefetch" href="https://www.youtube-nocookie.com" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://www.youtube-nocookie.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <meta property="fb:app_id" content="1016139985071738" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildWebSite()) }}
        />
      </head>
      <body className={metalMania.variable}>
        <PerformanceMeasureGuard />
        <YouTubeIframeApiLoader />
        {children}
      </body>
    </html>
  );
}
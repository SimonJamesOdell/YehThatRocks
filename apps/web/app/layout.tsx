import type { Metadata } from "next";
import localFont from "next/font/local";

import { PerformanceMeasureGuard } from "@/components/performance-measure-guard";
import { YouTubeIframeApiLoader } from "@/components/youtube-iframe-api-loader";
import { UtmCapture } from "@/components/utm-capture";
import { BotChallengeSolver } from "@/components/bot-challenge-solver";
import { buildWebSite } from "@/lib/schema-org";
import "./globals.css";

// Self-hosted Metal Mania (SIL OFL 1.1 — see ./fonts/OFL.txt).
// Self-hosting keeps the Docker build hermetic: next/font/google downloads
// from fonts.googleapis.com at build time and fails hard when the builder
// cannot reach Google (seen as "Failed to fetch Metal Mania from Google Fonts").
const metalMania = localFont({
  src: "./fonts/metal-mania-latin-400-normal.woff2",
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
        <UtmCapture />
        <BotChallengeSolver />
        <YouTubeIframeApiLoader />
        {children}
      </body>
    </html>
  );
}
import type { Metadata } from "next";
import { Metal_Mania } from "next/font/google";
import Script from "next/script";

import { startAdminHostMetricSampling } from "@/lib/admin-dashboard-health";
import { YouTubeIframeApiLoader } from "@/components/youtube-iframe-api-loader";
import "./globals.css";

const metalMania = Metal_Mania({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display"
});

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";
const DEFAULT_SHARE_IMAGE = "/images/guitar_back.png";

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
  startAdminHostMetricSampling();

  return (
    <html lang="en">
      <head>
        <Script
          id="performance-measure-guard"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                if (typeof window === "undefined" || typeof performance === "undefined") {
                  return;
                }

                var perf = performance;
                if (perf.__ytrMeasurePatched) {
                  return;
                }

                var originalMeasure = perf.measure.bind(perf);
                perf.__ytrMeasurePatched = true;
                perf.measure = function () {
                  try {
                    return originalMeasure.apply(perf, arguments);
                  } catch (error) {
                    var message = error && error.message ? String(error.message) : String(error);
                    if (
                      message.indexOf("negative time stamp") !== -1 ||
                      message.indexOf("cannot have a negative time stamp") !== -1 ||
                      message.indexOf("Failed to execute 'measure'") !== -1 ||
                      message.indexOf("NotFound") !== -1
                    ) {
                      return;
                    }
                    throw error;
                  }
                };
              })();
            `,
          }}
        />
        <link rel="dns-prefetch" href="https://www.youtube.com" />
        <link rel="dns-prefetch" href="https://www.youtube-nocookie.com" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://www.youtube-nocookie.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
      </head>
      <body className={metalMania.variable}>
        <YouTubeIframeApiLoader />
        {children}
      </body>
    </html>
  );
}

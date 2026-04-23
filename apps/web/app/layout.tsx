import type { Metadata } from "next";
import { Metal_Mania } from "next/font/google";
import Script from "next/script";

import { startAdminHostMetricSampling } from "@/lib/admin-dashboard-health";
import { startPerfSampling } from "@/lib/perf-sample-persistence";
import "./globals.css";

const metalMania = Metal_Mania({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display"
});

export const metadata: Metadata = {
  title: "YehThatRocks | The World's LOUDEST Website",
  description:
    "Community-driven rock and metal streaming, discovery, chat, and catalogue depth rebuilt for the modern web."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  startAdminHostMetricSampling();
  startPerfSampling();

  return (
    <html lang="en">
      <head>
        <link rel="dns-prefetch" href="https://www.youtube.com" />
        <link rel="dns-prefetch" href="https://www.youtube-nocookie.com" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://www.youtube-nocookie.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
      </head>
      <body className={metalMania.variable}>
        <Script
          id="youtube-iframe-api"
          src="https://www.youtube.com/iframe_api"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}

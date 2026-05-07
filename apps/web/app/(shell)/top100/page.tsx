import type { Metadata } from "next";
import { Top100VideosLoader } from "@/components/top100-videos-loader";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

export const metadata: Metadata = {
  title: "Top 100 Rock & Metal Videos | YehThatRocks",
  description: "The 100 most-played rock and metal videos on YehThatRocks, ranked by community streams.",
  alternates: { canonical: "/top100" },
  openGraph: {
    title: "Top 100 Rock & Metal Videos | YehThatRocks",
    description: "The 100 most-played rock and metal videos on YehThatRocks, ranked by community streams.",
    url: "/top100",
    siteName: "YehThatRocks",
    type: "website",
    images: [{ url: `${SITE_ORIGIN}/images/guitar_back.png`, alt: "YehThatRocks Top 100" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Top 100 Rock & Metal Videos | YehThatRocks",
    description: "The 100 most-played rock and metal videos on YehThatRocks, ranked by community streams.",
    images: [`${SITE_ORIGIN}/images/guitar_back.png`],
  },
};

const top100JsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Top 100 Rock & Metal Videos | YehThatRocks",
  description: "The 100 most-played rock and metal videos on YehThatRocks, ranked by community streams.",
  url: `${SITE_ORIGIN}/top100`,
  isPartOf: { "@type": "WebSite", name: "YehThatRocks", url: SITE_ORIGIN },
};

export default async function TopHundredPage() {
  const [{ hasAccessToken: isAuthenticated }, { seenVideoIds, hiddenVideoIds }] = await Promise.all([
    getShellRequestAuthState(),
    getShellRequestVideoState(),
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(top100JsonLd) }} />
      <Top100VideosLoader
        isAuthenticated={isAuthenticated}
        seenVideoIds={Array.from(seenVideoIds)}
        hiddenVideoIds={Array.from(hiddenVideoIds)}
      />
    </>
  );
}

import type { Metadata } from "next";
import { NewVideosLoader } from "@/components/new-videos-loader";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

export const metadata: Metadata = {
  title: "New Rock & Metal Videos | YehThatRocks",
  description: "The latest rock and metal music videos added to YehThatRocks. Fresh drops from across the genre spectrum.",
  alternates: { canonical: "/new" },
  openGraph: {
    title: "New Rock & Metal Videos | YehThatRocks",
    description: "The latest rock and metal music videos added to YehThatRocks. Fresh drops from across the genre spectrum.",
    url: "/new",
    siteName: "YehThatRocks",
    type: "website",
    images: [{ url: `${SITE_ORIGIN}/images/guitar_back.png`, alt: "YehThatRocks new videos" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "New Rock & Metal Videos | YehThatRocks",
    description: "The latest rock and metal music videos added to YehThatRocks.",
    images: [`${SITE_ORIGIN}/images/guitar_back.png`],
  },
};

const newVideosJsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "New Rock & Metal Videos | YehThatRocks",
  description: "The latest rock and metal music videos added to YehThatRocks. Fresh drops from across the genre spectrum.",
  url: `${SITE_ORIGIN}/new`,
  isPartOf: { "@type": "WebSite", name: "YehThatRocks", url: SITE_ORIGIN },
};

export default async function NewPage() {
  const [{ hasAccessToken: isAuthenticated, isAdmin: isAdminUser }, { seenVideoIds, hiddenVideoIds }] = await Promise.all([
    getShellRequestAuthState(),
    getShellRequestVideoState(),
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(newVideosJsonLd) }} />
      <NewVideosLoader
        initialVideos={[]}
        isAuthenticated={isAuthenticated}
        isAdminUser={isAdminUser}
        seenVideoIds={Array.from(seenVideoIds)}
        hiddenVideoIds={Array.from(hiddenVideoIds)}
      />
    </>
  );
}
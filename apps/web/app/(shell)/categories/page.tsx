import type { Metadata } from "next";
import { CategoriesNewGrid } from "@/components/categories-new-grid";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { getCategoriesNewTopLevelSnapshot } from "@/lib/categories-new-snapshots";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

export const metadata: Metadata = {
  title: "Rock & Metal Category Buckets | YehThatRocks",
  description: "Explore top-level rock and metal category buckets on YehThatRocks — from Classic and Symphonic, Thrash & Power, and Black and Death Metal to Punk, Doom, Nu-metal & Metalcore, and Progressive scenes.",
  alternates: { canonical: "/categories" },
  openGraph: {
    title: "Rock & Metal Category Buckets | YehThatRocks",
    description: "Explore top-level rock and metal category buckets on YehThatRocks.",
    url: "/categories",
    siteName: "YehThatRocks",
    type: "website",
    images: [{ url: `${SITE_ORIGIN}/images/guitar_back.png`, alt: "YehThatRocks rock and metal category buckets" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rock & Metal Category Buckets | YehThatRocks",
    description: "Explore top-level rock and metal category buckets on YehThatRocks.",
    images: [`${SITE_ORIGIN}/images/guitar_back.png`],
  },
};

export default async function CategoriesPage() {
  const snapshot = await getCategoriesNewTopLevelSnapshot();
  const cards = (snapshot?.cards ?? []).filter((card) => card.genre !== "Rock / Metal");

  const categoriesJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Rock & Metal Category Buckets on YehThatRocks",
    description: "Top-level rock and metal category buckets with curated music videos.",
    url: `${SITE_ORIGIN}/categories`,
    itemListElement: cards.slice(0, 50).map((card, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: card.genre,
      url: `${SITE_ORIGIN}/categories/${card.genre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    })),
  };

  if (cards.length === 0) {
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(categoriesJsonLd) }} />
        <OverlayScrollReset />
        <article className="catalogCard categoryNoVideos">
          <p className="statusLabel">Categories</p>
          <h3>Snapshot not built yet</h3>
          <p>Pin a category thumbnail or apply any catalog change to trigger the categories snapshot build.</p>
        </article>
      </>
    );
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(categoriesJsonLd) }} />
      <OverlayScrollReset />
      <CategoriesNewGrid cards={cards} basePath="/categories" />
    </>
  );
}

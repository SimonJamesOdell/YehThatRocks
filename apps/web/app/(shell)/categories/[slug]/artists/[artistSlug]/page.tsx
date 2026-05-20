import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CategoryVideosInfinite } from "@/components/category-videos-infinite";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { getCategoryArtistsByGenre, getGenreBySlug, getVideosByGenreAndArtist } from "@/lib/catalog-data";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

const CATEGORY_ARTIST_VIDEOS_INITIAL_PAGE_SIZE = 48;
const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

type CategoryArtistPageProps = {
  params: Promise<{ slug: string; artistSlug: string }>;
  searchParams: Promise<{ name?: string }>;
};

async function resolveCategoryArtistName(genre: string, artistSlug: string, nameHint?: string) {
  const direct = (nameHint ?? "").trim();
  if (direct) {
    return direct;
  }

  const candidates = await getCategoryArtistsByGenre(genre, { offset: 0, limit: 200 });
  return candidates.find((artist) => artist.slug === artistSlug)?.name ?? "";
}

export async function generateMetadata({ params, searchParams }: CategoryArtistPageProps): Promise<Metadata> {
  const [{ slug, artistSlug }, query] = await Promise.all([params, searchParams]);
  const genre = await getGenreBySlug(slug);
  if (!genre) {
    return {};
  }

  const artistName = await resolveCategoryArtistName(genre, artistSlug, query.name);
  if (!artistName) {
    return {};
  }

  const title = `${artistName} in ${genre} | YehThatRocks`;
  const description = `Watch ${artistName} videos in the ${genre} category on YehThatRocks.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/categories/${slug}/artists/${artistSlug}`,
    },
    openGraph: {
      title,
      description,
      url: `/categories/${slug}/artists/${artistSlug}`,
      siteName: "YehThatRocks",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function CategoryArtistVideosPage({ params, searchParams }: CategoryArtistPageProps) {
  const [{ hasAccessToken: isAuthenticated, isAdmin }, { seenVideoIds, hiddenVideoIds }, { slug, artistSlug }, query] = await Promise.all([
    getShellRequestAuthState(),
    getShellRequestVideoState(),
    params,
    searchParams,
  ]);

  const genre = await getGenreBySlug(slug);
  if (!genre) {
    notFound();
  }

  const artistName = await resolveCategoryArtistName(genre, artistSlug, query.name);
  if (!artistName) {
    notFound();
  }

  const initialVideosWithProbe = await getVideosByGenreAndArtist(genre, artistName, {
    offset: 0,
    limit: CATEGORY_ARTIST_VIDEOS_INITIAL_PAGE_SIZE + 1,
  });

  const initialHasMore = initialVideosWithProbe.length > CATEGORY_ARTIST_VIDEOS_INITIAL_PAGE_SIZE;
  const initialVideos = initialVideosWithProbe.slice(0, CATEGORY_ARTIST_VIDEOS_INITIAL_PAGE_SIZE);

  const pageJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${artistName} in ${genre} | YehThatRocks`,
    description: `Watch ${artistName} videos in the ${genre} category on YehThatRocks.`,
    url: `${SITE_ORIGIN}/categories/${slug}/artists/${artistSlug}`,
    isPartOf: { "@type": "WebSite", name: "YehThatRocks", url: SITE_ORIGIN },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd) }} />
      <OverlayScrollReset />
      <CategoryVideosInfinite
        slug={slug}
        genre={genre}
        isAuthenticated={isAuthenticated}
        isAdmin={isAdmin}
        seenVideoIds={Array.from(seenVideoIds)}
        hiddenVideoIds={Array.from(hiddenVideoIds)}
        initialVideos={initialVideos}
        initialHasMore={initialHasMore}
        pageSize={CATEGORY_ARTIST_VIDEOS_INITIAL_PAGE_SIZE}
        artistSlug={artistSlug}
        artistName={artistName}
      />
    </>
  );
}

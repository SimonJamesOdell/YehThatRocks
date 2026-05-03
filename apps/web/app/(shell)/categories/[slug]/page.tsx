import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CategoryVideosInfinite } from "@/components/category-videos-infinite";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import {
  getGenreBySlug,
  getVideosByGenre,
} from "@/lib/catalog-data";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";

const CATEGORY_INITIAL_PAGE_SIZE = 48;

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const genre = await getGenreBySlug(slug);
  if (!genre) return {};
  return {
    title: `${genre} Videos | YehThatRocks`,
    description: `Stream the best ${genre} music videos on YehThatRocks — community-driven rock and metal discovery.`,
    alternates: { canonical: `/categories/${slug}` },
    openGraph: {
      title: `${genre} Videos | YehThatRocks`,
      description: `Stream the best ${genre} music videos on YehThatRocks.`,
      url: `/categories/${slug}`,
      siteName: "YehThatRocks",
      type: "website",
    },
  };
}

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function CategoryDetailPage({ params }: CategoryPageProps) {
  const [{ hasAccessToken: isAuthenticated }, { seenVideoIds, hiddenVideoIds }] = await Promise.all([
    getShellRequestAuthState(),
    getShellRequestVideoState(),
  ]);

  const { slug } = await params;
  const genre = await getGenreBySlug(slug);

  if (!genre) {
    notFound();
  }

  const initialVideosWithProbe = await getVideosByGenre(genre, { offset: 0, limit: CATEGORY_INITIAL_PAGE_SIZE + 1 });

  const initialHasMore = initialVideosWithProbe.length > CATEGORY_INITIAL_PAGE_SIZE;
  const initialVideos = initialVideosWithProbe.slice(0, CATEGORY_INITIAL_PAGE_SIZE);
  return (
    <>
      <OverlayScrollReset />

      <CategoryVideosInfinite
        slug={slug}
        genre={genre}
        isAuthenticated={isAuthenticated}
        seenVideoIds={Array.from(seenVideoIds)}
        hiddenVideoIds={Array.from(hiddenVideoIds)}
        initialVideos={initialVideos}
        initialHasMore={initialHasMore}
        pageSize={CATEGORY_INITIAL_PAGE_SIZE}
      />
    </>
  );
}



import { notFound } from "next/navigation";

import { CategoryVideosInfinite } from "@/components/category-videos-infinite";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import {
  getGenreBySlug,
  getVideosByGenre,
} from "@/lib/catalog-data";
import { getShellRequestAuthState, getShellRequestVideoState } from "@/lib/shell-request-state";
const CATEGORY_INITIAL_PAGE_SIZE = 48;

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



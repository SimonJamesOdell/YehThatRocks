import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { CategoryVideosInfinite } from "@/components/category-videos-infinite";
import { CategoriesScrollReset } from "@/components/categories-scroll-reset";
import {
  getGenreBySlug,
  getGenres,
  getGenreSlug,
  getHiddenVideoIdsForUser,
  getSeenVideoIdsForUser,
  getVideosByGenre,
} from "@/lib/catalog-data";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export const revalidate = 3600;
const CATEGORY_INITIAL_PAGE_SIZE = 48;

export async function generateStaticParams() {
  const genres = await getGenres();
  return genres.map((genre) => ({ slug: getGenreSlug(genre) }));
}

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function CategoryDetailPage({ params }: CategoryPageProps) {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const user = await getCurrentAuthenticatedUser();

  const [seenVideoIds, hiddenVideoIds] = user
    ? await Promise.all([
      getSeenVideoIdsForUser(user.id),
      getHiddenVideoIdsForUser(user.id),
    ])
    : [new Set<string>(), new Set<string>()];

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
      <CategoriesScrollReset />

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



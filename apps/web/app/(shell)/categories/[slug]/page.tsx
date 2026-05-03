import { cookies } from "next/headers";
import Link from "next/link";
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
  try {
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
  } catch (error) {
    console.error("[categories/[slug]/page] hard-fail", {
      message: error instanceof Error ? error.message : "unknown error",
    });

    return (
      <main className="serviceFailureScreen" role="main" aria-label="Category unavailable">
        <div className="serviceFailureBackdrop" aria-hidden="true" />
        <section className="serviceFailurePanel" role="status" aria-live="polite" aria-label="Category unavailable">
          <p className="serviceFailureEyebrow">Category status</p>
          <h2 className="serviceFailureTitle">Category temporarily unavailable</h2>
          <p className="serviceFailureLead">
            The system cannot serve this request right now. Please try again later.
          </p>

          <div className="serviceFailureActions">
            <Link href="/categories" className="serviceFailureActionSecondary">
              Back to categories
            </Link>
          </div>
        </section>
      </main>
    );
  }
}



import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { CategoryVideosInfinite } from "@/components/category-videos-infinite";
import { CategoriesScrollReset } from "@/components/categories-scroll-reset";
import { CloseLink } from "@/components/close-link";
import {
  getGenreBySlug,
  getGenres,
  getGenreSlug,
  getVideosByGenre,
} from "@/lib/catalog-data";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";

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
      <div className="favouritesBlindBar">
        <strong>
          <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
            <span className="categoryHeaderIcon" aria-hidden="true">☣</span>
            <Link href="/categories" className="categoryHeaderBreadcrumbLink">
              Categories
            </Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{genre}</span>
          </span>
        </strong>
        <CloseLink />
      </div>

      <CategoryVideosInfinite
        slug={slug}
        genre={genre}
        isAuthenticated={isAuthenticated}
        initialVideos={initialVideos}
        initialHasMore={initialHasMore}
        pageSize={CATEGORY_INITIAL_PAGE_SIZE}
      />
    </>
  );
}



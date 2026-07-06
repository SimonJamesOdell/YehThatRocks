import { notFound } from "next/navigation";
import { getCategoriesNewCategorySnapshot } from "@/lib/categories-new-snapshots";
import { MobileCategoryArtistList } from "@/components/mobile/mobile-category-artist-list";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function MobileCategoryDetailPage({ params }: Props) {
  const { slug } = await params;
  const snapshot = await getCategoriesNewCategorySnapshot(slug);

  if (!snapshot) {
    notFound();
  }

  const { genre, totalArtists } = snapshot;
  const artists = snapshot.artists.filter((a) => a.videoCount > 0);

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">{genre}</h1>
        <p className="mobile-page-subtitle">
          {totalArtists.toLocaleString()} artist{totalArtists !== 1 ? "s" : ""}
        </p>
      </div>

      {artists.length === 0 ? (
        <div className="mobile-empty-state">
          <p>No artists found in this category.</p>
        </div>
      ) : (
        <MobileCategoryArtistList artists={artists} genre={genre} />
      )}
    </div>
  );
}

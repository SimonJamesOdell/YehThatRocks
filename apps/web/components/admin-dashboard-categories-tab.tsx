import type { CategoryRow } from "@/components/admin-dashboard-types";

type AdminDashboardCategoriesTabProps = {
  categories: CategoryRow[];
  onChangeGenre: (id: number, genre: string) => void;
  onChangeThumbnailVideoId: (id: number, thumbnailVideoId: string) => void;
  onSaveCategory: (row: CategoryRow) => void;
};

export function AdminDashboardCategoriesTab({
  categories,
  onChangeGenre,
  onChangeThumbnailVideoId,
  onSaveCategory,
}: AdminDashboardCategoriesTabProps) {
  return (
    <section className="panel featurePanel">
      <div className="panelHeading">
        <span>Edit Categories</span>
        <strong>{categories.length} rows</strong>
      </div>
      <div className="interactiveStack">
        {categories.slice(0, 30).map((row) => (
          <div key={row.id} className="authForm">
            <label>
              <span>Genre</span>
              <input
                value={row.genre}
                onChange={(event) => {
                  onChangeGenre(row.id, event.target.value);
                }}
              />
            </label>
            <label>
              <span>Thumbnail Video ID</span>
              <input
                value={row.thumbnailVideoId ?? ""}
                onChange={(event) => {
                  onChangeThumbnailVideoId(row.id, event.target.value);
                }}
              />
            </label>
            <button type="button" onClick={() => onSaveCategory(row)}>Save Category</button>
          </div>
        ))}
      </div>
    </section>
  );
}

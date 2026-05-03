import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";

export default function CategoriesLoading() {
  return (
    <div className="categoriesFilterSection" aria-busy="true">
      <OverlayHeader className="categoriesHeaderBar" close={false}>
        <div className="categoriesHeaderMain">
          <strong>
            <span className="categoryHeaderBreadcrumb">☣ Categories</span>
          </strong>
          <div className="categoriesFilterBar">
            <input
              type="text"
              className="categoriesFilterInput"
              placeholder="type to filter..."
              aria-label="Filter categories by prefix"
              autoComplete="off"
              spellCheck={false}
              disabled
            />
          </div>
        </div>
        <CloseLink />
      </OverlayHeader>

      <div className="catalogGrid categoriesCatalogGrid">
        <div className="playerLoadingFallback categoriesFilterEmptyState" role="status" aria-live="polite" aria-label="Loading categories">
          <div className="playerBootLoader">
            <div className="playerBootBars" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <p>Loading categories...</p>
          </div>
        </div>
      </div>
    </div>
  );
}

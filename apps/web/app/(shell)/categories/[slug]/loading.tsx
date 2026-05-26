import { OverlayScrollReset } from "@/components/overlay-scroll-reset";

export default function CategoryLoading() {
  return (
    <>
      <OverlayScrollReset />
      <article className="catalogCard categoryNoVideos" aria-busy="true">
        <p className="statusLabel">Categories</p>
        <div className="routeContractRow artistLoadingCenter" role="status" aria-live="polite" aria-label="Loading category">
          <div className="playerBootLoader" aria-hidden="true">
            <div className="playerBootBars">
              <span />
              <span />
              <span />
              <span />
            </div>
            <p>Loading category...</p>
          </div>
        </div>
      </article>
    </>
  );
}
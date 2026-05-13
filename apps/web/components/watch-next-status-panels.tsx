"use client";

type WatchNextStatusPanelsProps = {
  watchNextLoadFailed: boolean;
  hasVisibleVideos: boolean;
  onRetryLoadMore: () => void;
  shouldShowWatchNextGenreConstrainedHint: boolean;
  shouldShowWatchNextUnseenEmptyState: boolean;
  shouldShowWatchNextGenreConstrainedEmptyState: boolean;
  shouldShowWatchNextEmptyState: boolean;
  onOpenAutoplaySettings: () => void;
};

export function WatchNextStatusPanels({
  watchNextLoadFailed,
  hasVisibleVideos,
  onRetryLoadMore,
  shouldShowWatchNextGenreConstrainedHint,
  shouldShowWatchNextUnseenEmptyState,
  shouldShowWatchNextGenreConstrainedEmptyState,
  shouldShowWatchNextEmptyState,
  onOpenAutoplaySettings,
}: WatchNextStatusPanelsProps) {
  return (
    <>
      {watchNextLoadFailed && !hasVisibleVideos ? (
        <div className="rightRailStatus rightRailStatusError" role="status" aria-live="polite">
          <p>Watch Next is taking too long to load. Retrying now.</p>
          <button
            type="button"
            className="newPageSeenToggle"
            onClick={onRetryLoadMore}
          >
            Retry now
          </button>
        </div>
      ) : null}
      {shouldShowWatchNextGenreConstrainedHint ? (
        <div className="rightRailStatus rightRailStatusInfo" role="status" aria-live="polite">
          <p>
            Genre limit is active. Watch Next is showing fewer options for this account.
          </p>
          <button
            type="button"
            className="newPageSeenToggle"
            onClick={onOpenAutoplaySettings}
          >
            Configure autoplay
          </button>
        </div>
      ) : null}
      {shouldShowWatchNextUnseenEmptyState ? (
        <p className="rightRailStatus">No unseen videos in Watch Next right now.</p>
      ) : null}
      {shouldShowWatchNextGenreConstrainedEmptyState ? (
        <div className="rightRailStatus rightRailStatusInfo" role="status" aria-live="polite">
          <p>
            No Watch Next videos match your current autoplay genre limit.
          </p>
          <p>
            Open autoplay settings and disable limit-by-genre or widen your genre selection.
          </p>
          <button
            type="button"
            className="newPageSeenToggle"
            onClick={onOpenAutoplaySettings}
          >
            Open autoplay settings
          </button>
        </div>
      ) : null}
      {shouldShowWatchNextEmptyState && !shouldShowWatchNextGenreConstrainedEmptyState ? (
        <p className="rightRailStatus">No Watch Next videos available right now.</p>
      ) : null}
    </>
  );
}

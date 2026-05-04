"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { EVENT_NAMES, dispatchAppEvent, listenToAppEvent } from "@/lib/events-contract";
import { Top100VideoLink } from "@/components/top100-video-link";
import { CloseLink } from "@/components/close-link";
import { HideVideoConfirmModal } from "@/components/hide-video-confirm-modal";
import { SuggestNewModal } from "@/components/suggest-new-modal";
import { useOverlayScrollContainerRef } from "@/components/overlay-scroll-container-context";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { OverlayHeader } from "@/components/overlay-header";
import { RouteLoaderContractRow } from "@/components/route-loader-contract-row";
import { useActiveRowAutoScroll } from "@/components/use-active-row-auto-scroll";
import { useNewVideosDataLoader } from "@/components/use-new-videos-data-loader";
import { useNewVideosModeration } from "@/components/use-new-videos-moderation";
import { useNewVideosScrollPrefetch } from "@/components/use-new-videos-scroll-prefetch";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import { useSuggestNewVideo } from "@/components/use-suggest-new-video";
import { createPlaylistFromVideoList } from "@/lib/playlist-create-from-video-list";
import {
  VIDEO_QUALITY_FLAG_REASON_LABELS,
  VIDEO_QUALITY_FLAG_REASONS,
  type VideoQualityFlagReason,
} from "@/lib/video-quality-flags";

const NEW_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-new";
const NEW_ROUTE_QUEUE_SYNC_EVENT = "ytr:new-route-queue-sync";

type NewVideosApiPayload = {
  videos?: VideoRecord[];
  hasMore?: boolean;
  nextOffset?: number;
};

const NEW_INITIAL_BATCH_SIZE = 12;
const NEW_STARTUP_PREFETCH_TARGET = 100;
const NEW_SCROLL_BATCH_SIZE = 10;
const NEW_SCROLL_PREFETCH_THRESHOLD_PX = 1400;
const NEW_SCROLL_START_RATIO = 0.5;
const NEW_SCROLL_AGGRESSIVE_START_RATIO = 0.35;
const NEW_SCROLL_PREFETCH_EARLY_THRESHOLD_PX = 2200;
const NEW_SCROLL_TARGET_RUNWAY_PX = 2600;
const NEW_SCROLL_MAX_PREFETCH_BATCHES = 2;
const NEW_PLAYLIST_MAX_ITEMS = 100;
const NEW_FIRST_LOAD_TIMEOUT_MS = 6_500;
const NEW_HEAD_REFRESH_INTERVAL_MS = 90_000;

type NewVideoRowProps = {
  track: VideoRecord;
  index: number;
  isAuthenticated: boolean;
  isSeen: boolean;
  isActive: boolean;
  onHideVideo?: (track: VideoRecord) => void;
  isHidePending: boolean;
  onFlagVideo?: (track: VideoRecord) => void;
  isFlagPending: boolean;
};

const NewVideoRow = memo(function NewVideoRow({
  track,
  index,
  isAuthenticated,
  isSeen,
  isActive,
  onHideVideo,
  isHidePending,
  onFlagVideo,
  isFlagPending,
}: NewVideoRowProps) {
  return (
    <Top100VideoLink
      key={track.id}
      track={track}
      index={index}
      isAuthenticated={isAuthenticated}
      isSeen={isSeen}
      isActive={isActive}
      rowVariant="new"
      onHideVideo={onHideVideo}
      isHidePending={isHidePending}
      onFlagVideo={onFlagVideo}
      isFlagPending={isFlagPending}
    />
  );
}, (prev, next) => {
  return prev.track.id === next.track.id
    && prev.track.title === next.track.title
    && prev.track.channelTitle === next.track.channelTitle
    && prev.track.favourited === next.track.favourited
    && prev.index === next.index
    && prev.isAuthenticated === next.isAuthenticated
    && prev.isSeen === next.isSeen
    && prev.isActive === next.isActive
    && prev.isHidePending === next.isHidePending
    && prev.onHideVideo === next.onHideVideo
    && prev.isFlagPending === next.isFlagPending
    && prev.onFlagVideo === next.onFlagVideo;
});

export function NewVideosLoader({
  initialVideos,
  isAuthenticated,
  isAdminUser = false,
  seenVideoIds = [],
  hiddenVideoIds = [],
}: {
  initialVideos: VideoRecord[];
  isAuthenticated: boolean;
  isAdminUser?: boolean;
  seenVideoIds?: string[];
  hiddenVideoIds?: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeVideoId = searchParams.get("v");
  const previousActiveVideoIdRef = useRef<string | null>(activeVideoId);
  const endedActiveVideoIdRef = useRef<string | null>(null);
  const hiddenVideoIdsKey = useMemo(() => [...hiddenVideoIds].sort().join("|"), [hiddenVideoIds]);
  const seenVideoIdsKey = useMemo(() => [...seenVideoIds].sort().join("|"), [seenVideoIds]);
  const initialVideoIdsKey = useMemo(() => initialVideos.map((video) => video.id).join("|"), [initialVideos]);
  const hiddenVideoIdSet = useMemo(() => new Set(hiddenVideoIds), [hiddenVideoIdsKey]);
  const [clientSeenVideoIds, setClientSeenVideoIds] = useState(() => new Set(seenVideoIds));
  const [deferredSeenRemovalIds, setDeferredSeenRemovalIds] = useState<Set<string>>(() => new Set());
  const [playlistStatus, setPlaylistStatus] = useState<string | null>(null);
  const [isCreatingPlaylistFromNew, setIsCreatingPlaylistFromNew] = useState(false);
  const [hideSeen, setHideSeen] = useSeenTogglePreference({
    key: NEW_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated,
  });
  const {
    allVideos,
    allVideoIdsRef,
    hasMore,
    hasMoreRef,
    isLoadingMore,
    isLoadingMoreRef,
    lastPrefetchAtRef,
    loadBatch,
    loadBootstrapError,
    loadMoreError,
    loading,
    nextOffsetRef,
    prefetchInFlightRef,
    removeVideoById,
    retryInitialLoad,
    retryLoadMore,
  } = useNewVideosDataLoader({
    initialVideos,
    hiddenVideoIdSet,
    hiddenVideoIdsKey,
    initialVideoIdsKey,
    initialBatchSize: NEW_INITIAL_BATCH_SIZE,
    startupPrefetchTarget: NEW_STARTUP_PREFETCH_TARGET,
    scrollBatchSize: NEW_SCROLL_BATCH_SIZE,
    firstLoadTimeoutMs: NEW_FIRST_LOAD_TIMEOUT_MS,
    headRefreshIntervalMs: NEW_HEAD_REFRESH_INTERVAL_MS,
  });
  const {
    cancelHideVideo,
    confirmHideVideo,
    flagPendingVideoId,
    flagReason,
    flagStatus,
    flaggingVideo,
    handleCloseFlagDialog,
    handleHideVideo,
    handleOpenFlagDialog,
    handleSubmitFlag,
    hidingVideoIds,
    setFlagReason,
    videoPendingHideConfirm,
  } = useNewVideosModeration({
    isAuthenticated,
    isAdminUser,
    onRemoveVideoById: removeVideoById,
  });
  const {
    closeSuggestModal,
    isSuggestModalOpen,
    openSuggestModal,
    pendingConfirmation,
    refreshSuggestQuotaStatus,
    retryRejectedSuggestVideo,
    resetSuggestForAnother,
    setSuggestArtist,
    setSuggestSource,
    setSuggestTrack,
    submitSuggestNew,
    suggestArtist,
    suggestError,
    suggestOutcome,
    suggestPending,
    suggestRetryPending,
    suggestQuotaExhausted,
    suggestQuotaStatusPending,
    suggestSource,
    suggestTrack,
    watchSuggestedVideoNow,
  } = useSuggestNewVideo({
    isAuthenticated,
    isAdminUser,
    router,
  });
  const overlayScrollContainerRef = useOverlayScrollContainerRef();
  const seenVideoIdSet = clientSeenVideoIds;
  const visibleVideos = useMemo(
    () => (isAuthenticated && hideSeen
      ? allVideos.filter((video) => !seenVideoIdSet.has(video.id) || deferredSeenRemovalIds.has(video.id) || video.id === activeVideoId)
      : allVideos),
    [activeVideoId, allVideos, deferredSeenRemovalIds, hideSeen, isAuthenticated, seenVideoIdSet],
  );

  useEffect(() => {
    setClientSeenVideoIds(new Set(seenVideoIds));
  }, [seenVideoIdsKey]);

  useEffect(() => {
    const previousActiveVideoId = previousActiveVideoIdRef.current;
    if (previousActiveVideoId && previousActiveVideoId !== activeVideoId) {
      endedActiveVideoIdRef.current = null;
      setDeferredSeenRemovalIds((current) => {
        if (!current.has(previousActiveVideoId)) {
          return current;
        }

        const next = new Set(current);
        next.delete(previousActiveVideoId);
        return next;
      });
    }

    previousActiveVideoIdRef.current = activeVideoId;
  }, [activeVideoId]);

  useEffect(() => {
    if (!hideSeen || !activeVideoId || !seenVideoIdSet.has(activeVideoId) || endedActiveVideoIdRef.current === activeVideoId) {
      return;
    }

    setDeferredSeenRemovalIds((current) => {
      if (current.has(activeVideoId)) {
        return current;
      }

      const next = new Set(current);
      next.add(activeVideoId);
      return next;
    });
  }, [activeVideoId, hideSeen, seenVideoIdSet]);

  useActiveRowAutoScroll({
    activeVideoId,
    isLoading: loading,
    visibleVideoCount: visibleVideos.length,
    overlayScrollContainerRef,
  });

  useEffect(() => {
    const unsubscribeWatchHistory = listenToAppEvent(EVENT_NAMES.WATCH_HISTORY_UPDATED, ({ videoId }) => {
      if (!videoId) {
        return;
      }

      setClientSeenVideoIds((current) => {
        if (current.has(videoId)) {
          return current;
        }

        const next = new Set(current);
        next.add(videoId);
        return next;
      });

      if (!hideSeen || activeVideoId !== videoId || endedActiveVideoIdRef.current === videoId) {
        return;
      }

      setDeferredSeenRemovalIds((current) => {
        if (current.has(videoId)) {
          return current;
        }

        const next = new Set(current);
        next.add(videoId);
        return next;
      });
    });

    const unsubscribeVideoEnded = listenToAppEvent(EVENT_NAMES.VIDEO_ENDED, ({ videoId }) => {
      if (!videoId) {
        return;
      }

      endedActiveVideoIdRef.current = videoId;
      setDeferredSeenRemovalIds((current) => {
        if (!current.has(videoId)) {
          return current;
        }

        const next = new Set(current);
        next.delete(videoId);
        return next;
      });
    });

    return () => {
      unsubscribeWatchHistory();
      unsubscribeVideoEnded();
    };
  }, [activeVideoId, hideSeen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.dispatchEvent(new CustomEvent(NEW_ROUTE_QUEUE_SYNC_EVENT, {
      detail: {
        source: "new",
        videoIds: visibleVideos.map((video) => video.id),
      },
    }));
  }, [visibleVideos]);

  useEffect(() => {
    allVideoIdsRef.current = new Set(allVideos.map((video) => video.id));
  }, [allVideos]);

  useEffect(() => {
    function handleCatalogDeleted(event: Event) {
      const deletedId = (event as CustomEvent<{ videoId: string }>).detail?.videoId;
      if (!deletedId) {
        return;
      }

      removeVideoById(deletedId);
    }

    window.addEventListener("ytr:video-catalog-deleted", handleCatalogDeleted);
    return () => window.removeEventListener("ytr:video-catalog-deleted", handleCatalogDeleted);
  }, [removeVideoById]);

  useNewVideosScrollPrefetch({
    loading,
    hasMore,
    overlayScrollContainerRef,
    prefetchInFlightRef,
    lastPrefetchAtRef,
    isLoadingMoreRef,
    hasMoreRef,
    nextOffsetRef,
    loadBatch,
    scrollBatchSize: NEW_SCROLL_BATCH_SIZE,
    scrollStartRatio: NEW_SCROLL_START_RATIO,
    scrollPrefetchThresholdPx: NEW_SCROLL_PREFETCH_THRESHOLD_PX,
    scrollAggressiveStartRatio: NEW_SCROLL_AGGRESSIVE_START_RATIO,
    scrollPrefetchEarlyThresholdPx: NEW_SCROLL_PREFETCH_EARLY_THRESHOLD_PX,
    scrollTargetRunwayPx: NEW_SCROLL_TARGET_RUNWAY_PX,
    scrollMaxPrefetchBatches: NEW_SCROLL_MAX_PREFETCH_BATCHES,
  });

  const createPlaylistFromNew = async () => {
    if (isCreatingPlaylistFromNew) {
      return;
    }

    const sourceVideos = visibleVideos.slice(0, NEW_PLAYLIST_MAX_ITEMS);

    setIsCreatingPlaylistFromNew(true);

    const playlistName = `New ${hideSeen ? "Unseen " : ""}${new Date().toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;

    try {
      await createPlaylistFromVideoList({
        isAuthenticated,
        sourceVideos,
        playlistName,
        router,
        currentVideoId: searchParams.get("v"),
        telemetryComponent: "new-videos-loader",
        setStatus: setPlaylistStatus,
        emptyMessage: hideSeen ? "No unseen New videos to add." : "No New videos to add.",
        createFailedMessage: "Could not create playlist from New. Please try again.",
        optimisticMode: {
          kind: "immediate",
        },
        onBuildSuccessMessage: () => null,
      });
    } finally {
      setIsCreatingPlaylistFromNew(false);
    }
  };

  return (
    <>
      <OverlayScrollReset />
      <OverlayHeader close={false}>
        <div className="newPageHeaderLeft">
          <strong><span style={{filter: "brightness(0) invert(1)"}}>⭐</span> New</strong>
          {isAuthenticated ? (
            <button
              type="button"
              className={`newPageSeenToggle${hideSeen ? " newPageSeenToggleActive" : ""}`}
              onClick={() => setHideSeen((v) => !v)}
              aria-pressed={hideSeen}
            >
              {hideSeen ? "Showing unseen only" : "Show unseen only"}
            </button>
          ) : null}
          {isAuthenticated ? (
            <button
              type="button"
              className="newPageSeenToggle top100CreatePlaylistButton"
              onClick={openSuggestModal}
            >
              + Suggest New
            </button>
          ) : null}
          {isAuthenticated ? (
            <button
              type="button"
              className="newPageSeenToggle top100CreatePlaylistButton"
              onClick={() => {
                void createPlaylistFromNew();
              }}
              disabled={visibleVideos.length === 0 || isCreatingPlaylistFromNew}
            >
              {isCreatingPlaylistFromNew ? "+ Creating..." : "+ New Playlist"}
            </button>
          ) : null}
        </div>
        <CloseLink />
      </OverlayHeader>
      {playlistStatus ? <p className="rightRailStatus">{playlistStatus}</p> : null}
      <div className="trackStack spanTwoColumns">
      {visibleVideos.map((track, index) => (
        <NewVideoRow
          key={track.id}
          track={track}
          index={index}
          isAuthenticated={isAuthenticated}
          isSeen={seenVideoIdSet.has(track.id)}
          isActive={track.id === activeVideoId}
          onHideVideo={handleHideVideo}
          isHidePending={hidingVideoIds.includes(track.id)}
          onFlagVideo={isAuthenticated ? handleOpenFlagDialog : undefined}
          isFlagPending={flagPendingVideoId === track.id}
        />
      ))}
      {allVideos.length === 0 ? (
        <RouteLoaderContractRow
          isLoading={loading}
          loadingLabel="Loading new videos..."
          error={loadBootstrapError}
          onRetry={!loading && loadBootstrapError ? retryInitialLoad : null}
          endLabel={!loading && !loadBootstrapError && !hasMore ? "No new videos right now." : null}
        />
      ) : (
        <RouteLoaderContractRow
          isLoading={!loading && isLoadingMore}
          loadingLabel="Loading more new videos..."
          error={!loading ? loadMoreError : null}
          onRetry={!loading && loadMoreError ? retryLoadMore : null}
          endLabel={!loading && !hasMore && allVideos.length > 0 ? "End of new videos." : null}
        />
      )}

      {flaggingVideo ? (
        <div
          className="newFlagModalBackdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Flag video quality"
          onClick={handleCloseFlagDialog}
        >
          <div className="newFlagModalPanel" onClick={(event) => event.stopPropagation()}>
            <h3>Flag Low Quality Video</h3>
            <p className="newFlagModalMeta">{flaggingVideo.title}</p>
            <label className="newFlagModalField" htmlFor="new-flag-reason">
              Reason
            </label>
            <select
              id="new-flag-reason"
              value={flagReason}
              onChange={(event) => setFlagReason(event.target.value as VideoQualityFlagReason)}
              disabled={Boolean(flagPendingVideoId)}
            >
              {VIDEO_QUALITY_FLAG_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {VIDEO_QUALITY_FLAG_REASON_LABELS[reason]}
                </option>
              ))}
            </select>

            {flagStatus ? <p className="newFlagModalStatus">{flagStatus}</p> : null}

            <div className="newFlagModalActions">
              <button type="button" onClick={handleCloseFlagDialog} disabled={Boolean(flagPendingVideoId)}>
                Cancel
              </button>
              <button type="button" onClick={() => { void handleSubmitFlag(); }} disabled={Boolean(flagPendingVideoId)}>
                {flagPendingVideoId ? "Submitting..." : "Submit flag"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>

    <HideVideoConfirmModal
      isOpen={videoPendingHideConfirm !== null}
      video={videoPendingHideConfirm}
      isPending={videoPendingHideConfirm ? hidingVideoIds.includes(videoPendingHideConfirm.id) : false}
      onCancel={cancelHideVideo}
      onConfirm={() => {
        void confirmHideVideo();
      }}
    />

    <SuggestNewModal
      isOpen={isSuggestModalOpen}
      suggestSource={suggestSource}
      suggestArtist={suggestArtist}
      suggestTrack={suggestTrack}
      suggestPending={suggestPending}
      suggestQuotaStatusPending={suggestQuotaStatusPending}
      suggestQuotaExhausted={suggestQuotaExhausted}
      suggestError={suggestError}
      suggestOutcome={suggestOutcome}
      pendingConfirmation={pendingConfirmation}
      isAdminUser={isAdminUser}
      suggestRetryPending={suggestRetryPending}
      onClose={closeSuggestModal}
      onSuggestSourceChange={setSuggestSource}
      onSuggestArtistChange={setSuggestArtist}
      onSuggestTrackChange={setSuggestTrack}
      onSubmit={() => {
        void submitSuggestNew();
      }}
      onResetForAnother={resetSuggestForAnother}
      onWatchNow={watchSuggestedVideoNow}
      onRefreshQuotaStatus={() => {
        void refreshSuggestQuotaStatus();
      }}
      onRetryRejectedVideo={() => {
        void retryRejectedSuggestVideo();
      }}
    />
    </>
  );
}

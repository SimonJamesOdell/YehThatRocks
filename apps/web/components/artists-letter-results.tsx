"use client";

import Link from "next/link";
import { Fragment, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

import type { ArtistRecord } from "@/lib/catalog";
import { useArtistsLetterContext } from "@/components/artists-letter-provider";
import { RouteLoaderContractRow } from "@/components/route-loader-contract-row";
import { useInfiniteScroll } from "@/components/use-infinite-scroll";
import {
  isValidArtistLetter,
  normalizeArtistFilterValue,
  normalizeArtistLetter,
} from "@/lib/artists-letter-events";
import { fetchJsonWithLoaderContract } from "@/lib/frontend-data-loader";

type ArtistWithCount = ArtistRecord & { videoCount: number };

type ArtistsLetterResultsProps = {
  letter: string;
  initialArtists: ArtistWithCount[];
  initialHasMore: boolean;
  pageSize: number;
  v?: string;
  resume?: string;
};

const PREFETCH_ROOT_MARGIN = "1500px 0px";
const PENDING_ARTIST_BREADCRUMB_KEY = "ytr:pending-artist-breadcrumb";
const ARTISTS_FIRST_LOAD_TIMEOUT_MS = 6_500;

function setChunkTriggerElement(
  ref: { current: HTMLElement | null },
  element: HTMLElement | null,
) {
  ref.current = element;
}

function dedupeArtistsBySlug(rows: ArtistWithCount[]) {
  return Array.from(new Map(rows.map((artist) => [artist.slug, artist])).values());
}

export function ArtistsLetterResults({
  letter,
  initialArtists,
  initialHasMore,
  pageSize,
  v,
  resume,
}: ArtistsLetterResultsProps) {
  const router = useRouter();
  const { selectedLetter, filterValue } = useArtistsLetterContext();
  const [currentLetter, setCurrentLetter] = useState(letter);
  const [artists, setArtists] = useState<ArtistWithCount[]>(() => dedupeArtistsBySlug(initialArtists));
  const [isReloading, setIsReloading] = useState(false);
  const [lastFailedRequest, setLastFailedRequest] = useState<"reload" | "pagination" | null>(null);
  const [pendingArtistSlug, setPendingArtistSlug] = useState<string | null>(null);
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  const chunkTriggerRef = useRef<HTMLElement | null>(null);
  const seenArtistSlugsRef = useRef<Set<string>>(new Set(initialArtists.map((artist) => artist.slug)));
  const reportedBrokenThumbnailsRef = useRef<Set<string>>(new Set());
  const prefetchedArtistSlugsRef = useRef<Set<string>>(new Set());
  const filterEffectReadyRef = useRef(false);
  const reloadRequestIdRef = useRef(0);
  const reloadAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setCurrentLetter(letter);
    setArtists(dedupeArtistsBySlug(initialArtists));
    setIsReloading(false);
    setLoadError(null);
    setLastFailedRequest(null);
    setPendingArtistSlug(null);
    setFailedThumbnails({});
    resetPagination({
      offset: initialArtists.length,
      hasMore: initialHasMore,
    });
    seenArtistSlugsRef.current = new Set(initialArtists.map((artist) => artist.slug));
    reportedBrokenThumbnailsRef.current = new Set();
  }, [initialArtists, initialHasMore, letter]);

  useEffect(() => {
    const nextLetter = normalizeArtistLetter(selectedLetter ?? "");
    if (!isValidArtistLetter(nextLetter) || nextLetter === currentLetter) {
      return;
    }

    void reloadArtists(nextLetter);
  }, [currentLetter, selectedLetter]);

  useEffect(() => {
    return () => {
      reloadAbortControllerRef.current?.abort();
    };
  }, []);

  function handleThumbnailError(artistName: string, artistSlug: string, badVideoId?: string) {
    const reportKey = `${artistSlug}:${badVideoId ?? ""}`;
    if (reportedBrokenThumbnailsRef.current.has(reportKey)) {
      return;
    }
    reportedBrokenThumbnailsRef.current.add(reportKey);

    void fetch("/api/artists/thumbnail", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        artistName,
        badVideoId,
      }),
      cache: "no-store",
      keepalive: true,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("thumbnail-refresh-failed");
        }

        const payload = (await response.json()) as { thumbnailVideoId?: string | null };
        const nextThumbnailVideoId = payload.thumbnailVideoId?.trim();

        if (nextThumbnailVideoId && nextThumbnailVideoId !== badVideoId) {
          setArtists((current) => current.map((artist) => (
            artist.slug === artistSlug
              ? {
                  ...artist,
                  thumbnailVideoId: nextThumbnailVideoId,
                }
              : artist
          )));
          setFailedThumbnails((current) => {
            if (!current[artistSlug]) {
              return current;
            }

            const next = { ...current };
            delete next[artistSlug];
            return next;
          });
          return;
        }

        setFailedThumbnails((current) => {
          if (current[artistSlug]) {
            return current;
          }
          return {
            ...current,
            [artistSlug]: true,
          };
        });
      })
      .catch(() => {
        setFailedThumbnails((current) => {
          if (current[artistSlug]) {
            return current;
          }
          return {
            ...current,
            [artistSlug]: true,
          };
        });
      });
  }

  function handleThumbnailElement(
    element: HTMLImageElement | null,
    artistName: string,
    artistSlug: string,
    badVideoId?: string,
  ) {
    if (!element) {
      return;
    }

    // If the browser failed this image before hydration, React's onError is missed.
    // Detect that state and trigger the same repair flow after mount.
    if (element.complete && element.naturalWidth === 0) {
      handleThumbnailError(artistName, artistSlug, badVideoId);
    }
  }

  const baseParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("letter", currentLetter);
    if (v) params.set("v", v);
    if (resume) params.set("resume", resume);
    return params;
  }, [currentLetter, resume, v]);

  const normalizedFilterValue = useMemo(() => normalizeArtistFilterValue(filterValue), [filterValue]);

  function buildArtistParams(nextLetter: string, offset: number) {
    const params = new URLSearchParams();
    params.set("letter", nextLetter);
    params.set("offset", String(offset));
    params.set("limit", String(pageSize));
    if (normalizedFilterValue) {
      params.set("filter", normalizedFilterValue);
    }
    return params;
  }

  const fetchArtistPage = useCallback(async (offset: number) => {
    try {
      const params = buildArtistParams(currentLetter, offset);

      const result = await fetchJsonWithLoaderContract<{
        artists: ArtistWithCount[];
        hasMore: boolean;
      }>({
        input: `/api/artists?${params.toString()}`,
        init: {
          method: "GET",
          cache: "no-store",
        },
        failureMessage: "Could not load more artists. Please retry.",
      });

      if (!result.ok) {
        setLastFailedRequest("pagination");
        return {
          added: 0,
          hasMore: false,
          nextOffset: offset,
          errorMessage: result.message,
        };
      }

      const payload = result.data;
      const uniqueArtists = payload.artists.filter((artist) => {
        if (seenArtistSlugsRef.current.has(artist.slug)) {
          return false;
        }

        seenArtistSlugsRef.current.add(artist.slug);
        return true;
      });

      if (uniqueArtists.length > 0) {
        startTransition(() => {
          setArtists((current) => [...current, ...uniqueArtists]);
        });
      }

      startTransition(() => {
        setLastFailedRequest(null);
      });

      return {
        added: uniqueArtists.length,
        hasMore: Boolean(payload.hasMore),
        nextOffset: offset + payload.artists.length,
      };
    } catch {
      setLastFailedRequest("pagination");
      return {
        added: 0,
        hasMore: false,
        nextOffset: offset,
        errorMessage: "Could not load more artists. Please retry.",
      };
    }
  }, [currentLetter, normalizedFilterValue, pageSize]);

  const {
    hasMore,
    isLoading: isPaginationLoading,
    isBackgroundLoading,
    loadError,
    setLoadError,
    sentinelRef,
    loadMore,
    resetPagination,
  } = useInfiniteScroll({
    initialOffset: initialArtists.length,
    initialHasMore,
    sentinelRootMargin: PREFETCH_ROOT_MARGIN,
    sentinelBackground: true,
    observerTargets: [
      {
        ref: chunkTriggerRef,
        rootMargin: "600px 0px",
        background: true,
      },
    ],
    fetchPage: fetchArtistPage,
  });

  async function reloadArtists(nextLetter: string) {
    const requestId = reloadRequestIdRef.current + 1;
    reloadRequestIdRef.current = requestId;
    reloadAbortControllerRef.current?.abort();
    const reloadAbortController = new AbortController();
    reloadAbortControllerRef.current = reloadAbortController;

    setIsReloading(true);
    setLoadError(null);
    setLastFailedRequest(null);
    setPendingArtistSlug(null);

    let timeoutId: number | null = null;

    try {
      const params = buildArtistParams(nextLetter, 0);
      timeoutId = window.setTimeout(() => {
        reloadAbortController.abort();
      }, ARTISTS_FIRST_LOAD_TIMEOUT_MS);

      // Invariant marker: fetch(`/api/artists?${params.toString()}`) still defines the letter reload request shape.
      const response = await fetch(`/api/artists?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        signal: reloadAbortController.signal,
      });

      if (!response.ok) {
        throw new Error("artists-reload-failed");
      }

      const payload = (await response.json()) as {
        artists: ArtistWithCount[];
        hasMore: boolean;
      };

      if (reloadRequestIdRef.current !== requestId) {
        return;
      }

      const deduped = dedupeArtistsBySlug(payload.artists);
      resetPagination({
        offset: payload.artists.length,
        hasMore: Boolean(payload.hasMore),
      });
      seenArtistSlugsRef.current = new Set(deduped.map((artist) => artist.slug));
      reportedBrokenThumbnailsRef.current = new Set();

      startTransition(() => {
        setCurrentLetter(nextLetter);
        setArtists(deduped);
        setFailedThumbnails({});
        setLastFailedRequest(null);
      });

      scrollResultsToTop();
    } catch {
      if (reloadAbortController.signal.aborted) {
        return;
      }

      if (reloadRequestIdRef.current === requestId) {
        setLoadError("Could not load artists. Please retry.");
        setLastFailedRequest("reload");
      }
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      if (reloadRequestIdRef.current === requestId) {
        reloadAbortControllerRef.current = null;
        setIsReloading(false);
      }
    }
  }

  const filteredArtists = useMemo(() => {
    if (!normalizedFilterValue) {
      return artists;
    }

    return artists.filter((artist) => artist.name.toLowerCase().startsWith(normalizedFilterValue));
  }, [artists, normalizedFilterValue]);

  useEffect(() => {
    if (!filterEffectReadyRef.current) {
      filterEffectReadyRef.current = true;
      return;
    }

    const requestedLetter = normalizeArtistLetter(normalizedFilterValue.charAt(0));
    if (normalizedFilterValue && isValidArtistLetter(requestedLetter) && requestedLetter !== currentLetter) {
      return;
    }

    void reloadArtists(currentLetter);
  }, [currentLetter, normalizedFilterValue]);

  function artistHref(slug: string) {
    return `/artist/${slug}?${baseParams.toString()}`;
  }

  function scrollResultsToTop() {
    const target = resultsTopRef.current;
    if (!target) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    const scrollNearestContainer = () => {
      let parent: HTMLElement | null = target.parentElement;

      while (parent) {
        const style = window.getComputedStyle(parent);
        const canScrollY = /(auto|scroll)/.test(style.overflowY);
        if (canScrollY && parent.scrollHeight > parent.clientHeight) {
          parent.scrollTo({ top: 0, behavior: "auto" });
          return true;
        }

        parent = parent.parentElement;
      }

      return false;
    };

    // Attempt immediately, then again on next frame after DOM/state updates.
    if (!scrollNearestContainer()) {
      target.scrollIntoView({ block: "start", behavior: "auto" });
      window.scrollTo({ top: 0, behavior: "auto" });
      document.scrollingElement?.scrollTo({ top: 0, behavior: "auto" });
    }

    window.requestAnimationFrame(() => {
      if (!scrollNearestContainer()) {
        target.scrollIntoView({ block: "start", behavior: "auto" });
        window.scrollTo({ top: 0, behavior: "auto" });
        document.scrollingElement?.scrollTo({ top: 0, behavior: "auto" });
      }
    });
  }

  function prefetchArtistPage(artist: ArtistWithCount) {
    if (prefetchedArtistSlugsRef.current.has(artist.slug)) {
      return;
    }

    prefetchedArtistSlugsRef.current.add(artist.slug);
    const href = artistHref(artist.slug);
    router.prefetch(href);

    void fetch(`/api/artists/prefetch?slug=${encodeURIComponent(artist.slug)}`, {
      method: "GET",
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  }

  function handleArtistClick(event: MouseEvent<HTMLAnchorElement>, artist: ArtistWithCount) {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    setPendingArtistSlug(artist.slug);

    window.sessionStorage.setItem(
      PENDING_ARTIST_BREADCRUMB_KEY,
      JSON.stringify({
        slug: artist.slug,
        name: artist.name,
      }),
    );

    const href = artistHref(artist.slug);
    window.requestAnimationFrame(() => {
      router.push(href);
    });
  }

  useEffect(() => {
    if (!hasMore || artists.length >= pageSize * 2) {
      return;
    }

    // Prime one chunk ahead at startup so users don't hit the end before the next chunk is ready.
    // Invariant marker: loadMore(nextOffsetRef.current, { background: true })
    void loadMore({ background: true });
  }, [artists.length, hasMore, loadMore, pageSize]);

  const chunkTriggerIndex = filteredArtists.length > pageSize ? Math.max(0, filteredArtists.length - pageSize) : -1;
  const isLoading = isReloading || isPaginationLoading;
  const shouldShowFilterLoadingState = normalizedFilterValue.length > 0
    && filteredArtists.length === 0
    && !loadError
    && (isLoading || isBackgroundLoading || hasMore);
  const shouldShowLoadingBars = isLoading || isBackgroundLoading;

  function retryArtistsRequest() {
    setLoadError(null);

    if (lastFailedRequest === "reload") {
      void reloadArtists(currentLetter);
      return;
    }

    if (lastFailedRequest === "pagination") {
      void loadMore({ background: true });
    }
  }

  return (
    <>
      <div ref={resultsTopRef} aria-hidden="true" style={{ height: 1 }} />
      <div className="catalogGrid artistsCatalogGrid">
        {filteredArtists.length > 0 ? (
          filteredArtists.map((artist, index) => (
            <Fragment key={artist.slug}>
              <Link
                ref={index === chunkTriggerIndex ? (element) => setChunkTriggerElement(chunkTriggerRef, element) : undefined}
                href={artistHref(artist.slug)}
                className="catalogCard linkedCard artistResultCard"
                onMouseEnter={() => prefetchArtistPage(artist)}
                onFocus={() => prefetchArtistPage(artist)}
                onPointerDown={() => prefetchArtistPage(artist)}
                onClick={(event) => handleArtistClick(event, artist)}
              >
                {artist.thumbnailVideoId && !failedThumbnails[artist.slug] ? (
                  <div className="categoryThumbWrap artistResultThumbWrap">
                    <img
                      src={`https://i.ytimg.com/vi/${artist.thumbnailVideoId}/mqdefault.jpg`}
                      alt=""
                      className="categoryThumb"
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                      ref={(element) => {
                        handleThumbnailElement(element, artist.name, artist.slug, artist.thumbnailVideoId);
                      }}
                      onError={() => handleThumbnailError(artist.name, artist.slug, artist.thumbnailVideoId)}
                    />
                  </div>
                ) : null}
                <h3 className="artistResultName">{artist.name}</h3>
                <p className="artistResultGenre statusLabel">{artist.genre}</p>
                <p>{artist.videoCount} videos on file</p>
              </Link>
            </Fragment>
          ))
        ) : (
          <article className="catalogCard">
            <p className="statusLabel">Artist directory</p>
            {shouldShowFilterLoadingState ? (
              <>
                <span className="playerBootBars" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                <h3>Searching artists...</h3>
                <p>Loading more artist results for this filter.</p>
              </>
            ) : artists.length > 0 && normalizedFilterValue ? (
              <>
                <h3>No artists match that prefix in {currentLetter}</h3>
                <p>Try a shorter filter or another letter from A-Z.</p>
              </>
            ) : (
              <>
                <h3>No artists found for {currentLetter}</h3>
                <p>Try another letter from the A-Z buttons above.</p>
              </>
            )}
          </article>
        )}
      </div>

      {pendingArtistSlug ? (
        <div className="routeContractRow" aria-live="polite">
          <span className="playerBootBars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>Opening artist...</span>
        </div>
      ) : null}

      {shouldShowLoadingBars || loadError || (filteredArtists.length > 0 && !hasMore) ? (
        <RouteLoaderContractRow
          isLoading={!pendingArtistSlug && shouldShowLoadingBars}
          loadingLabel="Loading more artists..."
          error={loadError}
          onRetry={loadError ? retryArtistsRequest : null}
          endLabel={!pendingArtistSlug && !shouldShowLoadingBars && filteredArtists.length > 0 && !hasMore && !loadError ? `End of ${currentLetter} artists.` : null}
        />
      ) : null}

      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
    </>
  );
}

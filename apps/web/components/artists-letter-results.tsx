"use client";

import Link from "next/link";
import { Fragment, startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

import type { ArtistRecord } from "@/lib/catalog";
import {
  ARTISTS_FILTER_CHANGE_EVENT,
  ARTISTS_LETTER_CHANGE_EVENT,
  isValidArtistLetter,
  normalizeArtistFilterValue,
  normalizeArtistLetter,
  type ArtistsFilterChangeDetail,
  type ArtistsLetterChangeDetail,
} from "@/lib/artists-letter-events";
import { EVENT_NAMES, listenToAppEvent } from "@/lib/events-contract";

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
  const [currentLetter, setCurrentLetter] = useState(letter);
  const [artists, setArtists] = useState<ArtistWithCount[]>(() => dedupeArtistsBySlug(initialArtists));
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [filterValue, setFilterValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingArtistSlug, setPendingArtistSlug] = useState<string | null>(null);
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const chunkTriggerRef = useRef<HTMLElement | null>(null);
  const requestedOffsetsRef = useRef<Set<number>>(new Set());
  const seenArtistSlugsRef = useRef<Set<string>>(new Set(initialArtists.map((artist) => artist.slug)));
  const switchingLetterRef = useRef(false);
  const reportedBrokenThumbnailsRef = useRef<Set<string>>(new Set());
  const prefetchedArtistSlugsRef = useRef<Set<string>>(new Set());
  const nextOffsetRef = useRef<number>(initialArtists.length);
  const backgroundLoadCountRef = useRef(0);
  const filterEffectReadyRef = useRef(false);
  const reloadRequestIdRef = useRef(0);

  useEffect(() => {
    setCurrentLetter(letter);
    setArtists(dedupeArtistsBySlug(initialArtists));
    setHasMore(initialHasMore);
    setIsLoading(false);
    setIsBackgroundLoading(false);
    setLoadError(null);
    setPendingArtistSlug(null);
    setFailedThumbnails({});
    nextOffsetRef.current = initialArtists.length;
    requestedOffsetsRef.current = new Set();
    seenArtistSlugsRef.current = new Set(initialArtists.map((artist) => artist.slug));
    switchingLetterRef.current = false;
    backgroundLoadCountRef.current = 0;
    reportedBrokenThumbnailsRef.current = new Set();
  }, [initialArtists, initialHasMore, letter]);

  useEffect(() => {
    const handler = (payload: { letter: string }) => {
      const nextLetterRaw = payload.letter;
      const nextLetter = normalizeArtistLetter(nextLetterRaw ?? "");

      if (!isValidArtistLetter(nextLetter) || nextLetter === currentLetter || switchingLetterRef.current) {
        return;
      }

      switchingLetterRef.current = true;
      void reloadArtists(nextLetter).finally(() => {
        switchingLetterRef.current = false;
      });
    };

    const unsubscribe = listenToAppEvent(EVENT_NAMES.ARTISTS_LETTER_CHANGE, handler);
    return () => {
      unsubscribe();
    };
  }, [currentLetter, pageSize]);

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

  async function reloadArtists(nextLetter: string) {
    const requestId = reloadRequestIdRef.current + 1;
    reloadRequestIdRef.current = requestId;

    setIsLoading(true);
    setLoadError(null);
    setPendingArtistSlug(null);

    try {
      const response = await fetch(`/api/artists?${buildArtistParams(nextLetter, 0).toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load artists");
      }

      const payload = (await response.json()) as {
        artists: ArtistWithCount[];
        hasMore: boolean;
      };

      if (reloadRequestIdRef.current !== requestId) {
        return;
      }

      const deduped = dedupeArtistsBySlug(payload.artists);

      nextOffsetRef.current = payload.artists.length;
      requestedOffsetsRef.current = new Set();
      seenArtistSlugsRef.current = new Set(deduped.map((artist) => artist.slug));
      reportedBrokenThumbnailsRef.current = new Set();
      backgroundLoadCountRef.current = 0;

      startTransition(() => {
        setCurrentLetter(nextLetter);
        setArtists(deduped);
        setHasMore(Boolean(payload.hasMore));
        setFailedThumbnails({});
        setIsBackgroundLoading(false);
      });

      scrollResultsToTop();
    } catch {
      if (reloadRequestIdRef.current === requestId) {
        setLoadError("Could not load artists. Please try again.");
      }
    } finally {
      if (reloadRequestIdRef.current === requestId) {
        setIsLoading(false);
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
    const handler = (payload: { value: string }) => {
      setFilterValue(payload.value ?? "");
    };

    const unsubscribe = listenToAppEvent(EVENT_NAMES.ARTISTS_FILTER_CHANGE, handler);
    return () => {
      unsubscribe();
    };
  }, []);

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
  }, [normalizedFilterValue]);

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

  async function loadMore(
    offset: number,
    options?: { background?: boolean },
  ): Promise<{ added: number; hasMore: boolean }> {
    if (requestedOffsetsRef.current.has(offset)) {
      return { added: 0, hasMore };
    }

    const isBackground = options?.background === true;

    requestedOffsetsRef.current.add(offset);
    if (!isBackground) {
      setIsLoading(true);
      setLoadError(null);
    } else {
      backgroundLoadCountRef.current += 1;
      setIsBackgroundLoading(true);
    }

    try {
      const params = buildArtistParams(currentLetter, offset);

      const response = await fetch(`/api/artists?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load artists");
      }

      const payload = (await response.json()) as {
        artists: ArtistWithCount[];
        hasMore: boolean;
      };

      nextOffsetRef.current = offset + payload.artists.length;

      const uniqueArtists = payload.artists.filter((artist) => {
        if (seenArtistSlugsRef.current.has(artist.slug)) {
          return false;
        }

        seenArtistSlugsRef.current.add(artist.slug);
        return true;
      });

      if (uniqueArtists.length > 0) {
        // Keep background prefetch appends lower-priority than scroll/paint work.
        startTransition(() => {
          setArtists((current) => [...current, ...uniqueArtists]);
        });
      }

      startTransition(() => {
        setHasMore(Boolean(payload.hasMore));
      });

      return {
        added: uniqueArtists.length,
        hasMore: Boolean(payload.hasMore),
      };
    } catch {
      requestedOffsetsRef.current.delete(offset);
      if (!isBackground) {
        setLoadError("Could not load more artists. Scroll again to retry.");
      }
      return {
        added: 0,
        hasMore,
      };
    } finally {
      if (!isBackground) {
        setIsLoading(false);
      } else {
        backgroundLoadCountRef.current = Math.max(0, backgroundLoadCountRef.current - 1);
        if (backgroundLoadCountRef.current === 0) {
          setIsBackgroundLoading(false);
        }
      }
    }
  }

  useEffect(() => {
    if (!hasMore || artists.length >= pageSize * 2) {
      return;
    }

    // Prime one chunk ahead at startup so users don't hit the end before the next chunk is ready.
    void loadMore(nextOffsetRef.current, { background: true });
  }, [artists.length, currentLetter, hasMore, pageSize]);

  useEffect(() => {
    if (!hasMore) {
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || isLoading || !hasMore) {
          return;
        }

        void loadMore(nextOffsetRef.current, { background: true });
      },
      {
        root: null,
        rootMargin: PREFETCH_ROOT_MARGIN,
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [artists.length, currentLetter, hasMore, isLoading, pageSize]);

  useEffect(() => {
    if (!hasMore) {
      return;
    }

    const trigger = chunkTriggerRef.current;
    if (!trigger) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || isLoading || !hasMore) {
          return;
        }

        void loadMore(nextOffsetRef.current, { background: true });
      },
      {
        root: null,
        rootMargin: "600px 0px",
        threshold: 0,
      },
    );

    observer.observe(trigger);

    return () => {
      observer.disconnect();
    };
  }, [artists.length, currentLetter, hasMore, isLoading, pageSize]);

  const chunkTriggerIndex = filteredArtists.length > pageSize ? Math.max(0, filteredArtists.length - pageSize) : -1;
  const shouldShowFilterLoadingState = normalizedFilterValue.length > 0
    && filteredArtists.length === 0
    && !loadError
    && (isLoading || isBackgroundLoading || hasMore);
  const shouldShowLoadingBars = isLoading || isBackgroundLoading;

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

      {filteredArtists.length > 0 ? (
        <div className="routeContractRow" aria-live="polite">
          {pendingArtistSlug ? (
            <>
              <span className="playerBootBars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
              <span>Opening artist...</span>
            </>
          ) : null}
          {!pendingArtistSlug && shouldShowLoadingBars ? (
            <span className="playerBootBars" role="status" aria-label="Loading more artists">
              <span />
              <span />
              <span />
              <span />
            </span>
          ) : null}
          {loadError ? <span>{loadError}</span> : null}
          {!pendingArtistSlug && !shouldShowLoadingBars && !hasMore && !loadError ? <span>End of {currentLetter} artists.</span> : null}
        </div>
      ) : null}

      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
    </>
  );
}

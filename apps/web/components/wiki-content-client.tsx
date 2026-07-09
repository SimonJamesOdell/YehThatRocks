"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import type { ArtistWikiDocument } from "@/lib/artist-wiki";
import { getArtistPagePath, withVideoContext } from "@/lib/artist-routing";

type WikiContentClientProps = {
  artistName: string;
  slug: string;
  cachedWiki: ArtistWikiDocument | null;
  generationEnabled: boolean;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; wiki: ArtistWikiDocument }
  | { kind: "error"; message: string; retryable: boolean };

function renderList(items: string[], emptyLabel = "No verified entries yet.") {
  if (items.length === 0) {
    return <p>{emptyLabel}</p>;
  }

  return (
    <ul className="artistWikiList">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function resolveInternalWikiHref(rawUrl: string) {
  if (!rawUrl) {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const isKnownInternalHost =
      host === "localhost"
      || host === "127.0.0.1"
      || host === "yehthatrocks.com"
      || host === "www.yehthatrocks.com";

    if (!isKnownInternalHost) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function WikiContentClient({ artistName, slug, cachedWiki, generationEnabled }: WikiContentClientProps) {
  const searchParams = useSearchParams();
  const videoId = searchParams.get("v");
  const resume = searchParams.get("resume") === "1";

  const isGenerating = useRef(false);
  const [state, setState] = useState<LoadState>(
    cachedWiki
      ? { kind: "loaded", wiki: cachedWiki }
      : generationEnabled
        ? { kind: "loading" }
        : { kind: "error", message: "Wiki generation is currently disabled.", retryable: false },
  );

  const generate = useCallback(async () => {
    if (isGenerating.current) return;
    isGenerating.current = true;
    setState({ kind: "loading" });

    try {
      const response = await fetch("/api/artist-wiki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistName, slug }),
      });

      const payload = await response.json();

      if (payload.wiki) {
        setState({ kind: "loaded", wiki: payload.wiki });
      } else {
        setState({
          kind: "error",
          message: payload.error || "Failed to generate wiki.",
          retryable: payload.retryable !== false,
        });
      }
    } catch {
      setState({
        kind: "error",
        message: "Network error. Check your connection and try again.",
        retryable: true,
      });
    } finally {
      isGenerating.current = false;
    }
  }, [artistName, slug]);

  // Auto-trigger generation when component mounts with no cached wiki and generation is enabled
  useEffect(() => {
    if (!cachedWiki && generationEnabled && !isGenerating.current) {
      generate();
    }
  }, [cachedWiki, generationEnabled, generate]);

  const artistPagePath = getArtistPagePath(artistName);
  const artistPageHref = artistPagePath ? withVideoContext(artistPagePath, videoId, resume) : "/artists";

  // ─── Loading state ───────────────────────────────────────────────────────
  if (state.kind === "loading") {
    return (
      <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy="true">
        <span className="playerBootBars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span>Generating artist wiki...</span>
        <p className="artistWikiGenerationNote">
          This may take 15–30 seconds while we research {artistName}. The wiki will be cached for future visits.
        </p>
      </div>
    );
  }

  // ─── Error state ─────────────────────────────────────────────────────────
  if (state.kind === "error") {
    return (
      <section className="artistWikiPage" aria-label="Artist wiki generation failed">
        <article className="artistWikiSection artistWikiOverviewSection">
          <h2>Wiki unavailable</h2>
          <p>We could not generate a wiki page for {artistName} right now.</p>
          <p className="artistWikiNote">{state.message}</p>
          {state.retryable ? (
            <button
              type="button"
              className="artistWikiRetryButton"
              onClick={generate}
            >
              Try again
            </button>
          ) : (
            <p>
              <Link href={artistPageHref} className="artistWikiOverviewAction">
                Back to {artistName} &gt;
              </Link>
            </p>
          )}
        </article>
      </section>
    );
  }

  // ─── Loaded state ────────────────────────────────────────────────────────
  const wiki = state.wiki;
  const filteredSources = wiki.sources.filter((source) => {
    const internalHref = resolveInternalWikiHref(source.url);
    const title = source.title.trim().toLowerCase();
    return !internalHref && !title.startsWith("yehthatrocks:");
  });

  return (
    <section className="artistWikiPage" aria-label={`${artistName} wiki`}>
      <div className="artistWikiFlow">
        <div className="artistWikiTopRow">
          <article className="artistWikiSection artistWikiOverviewSection">
            <h2>Overview</h2>
            <p>{wiki.sections.overview}</p>
            <Link href={artistPageHref} className="artistWikiOverviewAction">
              More by {artistName} &gt;
            </Link>
          </article>

          {wiki.images[0] ? (
            <figure className="artistWikiLeadFigure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={wiki.images[0].url}
                alt={`${wiki.artistName} photo`}
                loading="eager"
                fetchPriority="high"
                className="artistWikiLeadImage"
              />
            </figure>
          ) : null}
        </div>

        <article className="artistWikiSection">
          <h2>Formation and Backstory</h2>
          <p>{wiki.sections.formationAndBackstory}</p>
        </article>

        <article className="artistWikiSection">
          <h2>Style and Influences</h2>
          <p>{wiki.sections.styleAndInfluences}</p>
        </article>

        <article className="artistWikiSection">
          <h2>Members</h2>
          <h3>Current</h3>
          {renderList(wiki.sections.members.current)}
          <h3>Former</h3>
          {renderList(wiki.sections.members.former)}
          <p className="artistWikiNote">{wiki.sections.members.notes}</p>
        </article>

        <article className="artistWikiSection">
          <h2>Discography</h2>
          <h3>Studio Albums</h3>
          {renderList(wiki.sections.discography.studioAlbums)}
          <h3>Live Albums</h3>
          {renderList(wiki.sections.discography.liveAlbums)}
          <h3>EPs and Compilations</h3>
          {renderList(wiki.sections.discography.epsAndCompilations)}
          <h3>Notable Tracks</h3>
          {renderList(wiki.sections.discography.notableTracks)}
        </article>

        <article className="artistWikiSection">
          <h2>Legacy and Notes</h2>
          <p>{wiki.sections.legacyAndNotes}</p>
        </article>

        <article className="artistWikiSection">
          <h2>Sources</h2>
          {filteredSources.length > 0 ? (
            <ul className="artistWikiSourceList">
              {filteredSources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No external references were available during generation.</p>
          )}
        </article>
      </div>
    </section>
  );
}

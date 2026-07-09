#!/usr/bin/env node

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  assertNotContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  wikiLib: path.join(ROOT, "apps/web/lib/artist-wiki.ts"),
  wikiPage: path.join(ROOT, "apps/web/app/(shell)/artist/[slug]/wiki/page.tsx"),
  wikiApi: path.join(ROOT, "apps/web/app/api/artist-wiki/route.ts"),
  wikiClient: path.join(ROOT, "apps/web/components/wiki-content-client.tsx"),
  wikiLink: path.join(ROOT, "apps/web/components/artist-wiki-link.tsx"),
  wikiCss: path.join(ROOT, "apps/web/app/styles/browse.css"),
  wikiNotfound: path.join(ROOT, "apps/web/app/(shell)/artist/[slug]/wiki/not-found.tsx"),
  wikiError: path.join(ROOT, "apps/web/app/(shell)/artist/[slug]/wiki/error.tsx"),
  artistRouting: path.join(ROOT, "apps/web/lib/artist-routing.ts"),
};

function main() {
  const failures = [];

  const wikiLibSource = readFileStrict(files.wikiLib, ROOT);
  const wikiPageSource = readFileStrict(files.wikiPage, ROOT);
  const wikiApiSource = readFileStrict(files.wikiApi, ROOT);
  const wikiClientSource = readFileStrict(files.wikiClient, ROOT);
  const wikiLinkSource = readFileStrict(files.wikiLink, ROOT);
  const wikiCssSource = readFileStrict(files.wikiCss, ROOT);
  const wikiNotfoundSource = readFileStrict(files.wikiNotfound, ROOT);
  const wikiErrorSource = readFileStrict(files.wikiError, ROOT);
  const artistRoutingSource = readFileStrict(files.artistRouting, ROOT);

  // ── Library: source collection ───────────────────────────────────────────

  assertContains(
    wikiLibSource,
    "fetchDuckDuckGoSource",
    "artist-wiki.ts includes DuckDuckGo source collection",
    failures,
  );

  assertContains(
    wikiLibSource,
    "https://api.duckduckgo.com/",
    "artist-wiki.ts fetches DuckDuckGo Instant Answer API",
    failures,
  );

  assertContains(
    wikiLibSource,
    "fetchWikipediaSource",
    "artist-wiki.ts still includes Wikipedia source collection",
    failures,
  );

  assertContains(
    wikiLibSource,
    "fetchMusicBrainzSource",
    "artist-wiki.ts still includes MusicBrainz source collection",
    failures,
  );

  // ── Library: trusted source check ────────────────────────────────────────

  assertContains(
    wikiLibSource,
    "hasDuckDuckGo",
    "hasTrustedExternalSource accepts DuckDuckGo sources",
    failures,
  );

  assertContains(
    wikiLibSource,
    's.title.startsWith("DuckDuckGo:")',
    "hasTrustedExternalSource checks for DuckDuckGo prefix",
    failures,
  );

  // ── Library: new public API ──────────────────────────────────────────────

  assertContains(
    wikiLibSource,
    "export async function generateAndCacheWiki",
    "artist-wiki.ts exports generateAndCacheWiki for API route use",
    failures,
  );

  assertContains(
    wikiLibSource,
    "export async function getCachedWikiOnly",
    "artist-wiki.ts exports getCachedWikiOnly for fast cache reads",
    failures,
  );

  assertContains(
    wikiLibSource,
    "export function isWikiGenerationEnabled",
    "artist-wiki.ts exports isWikiGenerationEnabled check",
    failures,
  );

  assertContains(
    wikiLibSource,
    "export async function getOrCreateArtistWiki",
    "artist-wiki.ts still exports getOrCreateArtistWiki",
    failures,
  );

  // ── Library: throw on failure (not silent null) ──────────────────────────

  // After the generation-disabled check, the function must NOT wrap
  // generateWikiDocument in try/catch — it should throw on failure.
  assertContains(
    wikiLibSource,
    "const generated = await generateWikiDocument(artistName, slug);",
    "getOrCreateArtistWiki calls generateWikiDocument directly (no try/catch wrapper)",
    failures,
  );

  assertContains(
    wikiLibSource,
    "return generated;",
    "getOrCreateArtistWiki returns generated wiki (not null) on success",
    failures,
  );

  // ── API endpoint ─────────────────────────────────────────────────────────

  assertContains(
    wikiApiSource,
    "export async function POST",
    "Wiki API route handles POST for generation",
    failures,
  );

  assertContains(
    wikiApiSource,
    "export async function GET",
    "Wiki API route handles GET for cache check",
    failures,
  );

  assertContains(
    wikiApiSource,
    "generateAndCacheWiki",
    "Wiki API route calls generateAndCacheWiki",
    failures,
  );

  assertContains(
    wikiApiSource,
    "verifySameOrigin",
    "Wiki API route enforces same-origin CSRF check",
    failures,
  );

  assertContains(
    wikiApiSource,
    "maxDuration = 60",
    "Wiki API route allows 60-second generation timeout",
    failures,
  );

  // ── Page: metadata export ────────────────────────────────────────────────

  assertContains(
    wikiPageSource,
    "export async function generateMetadata",
    "Wiki page exports generateMetadata for SEO",
    failures,
  );

  assertContains(
    wikiPageSource,
    "openGraph",
    "Wiki page metadata includes OpenGraph tags",
    failures,
  );

  assertContains(
    wikiPageSource,
    "Artist Wiki | YehThatRocks",
    "Wiki page metadata title includes site name",
    failures,
  );

  // ── Page: client component integration ───────────────────────────────────

  assertContains(
    wikiPageSource,
    "WikiContentClient",
    "Wiki page renders WikiContentClient for generation handling",
    failures,
  );

  assertContains(
    wikiPageSource,
    "getCachedWikiOnly",
    "Wiki page uses getCachedWikiOnly for server cache check",
    failures,
  );

  assertContains(
    wikiPageSource,
    "isWikiGenerationEnabled",
    "Wiki page checks generation status via isWikiGenerationEnabled",
    failures,
  );

  assertContains(
    wikiPageSource,
    "cachedWiki=",
    "Wiki page passes cachedWiki prop to client component",
    failures,
  );

  assertContains(
    wikiPageSource,
    "generationEnabled=",
    "Wiki page passes generationEnabled prop to client component",
    failures,
  );

  // ── Page: should NOT call getOrCreateArtistWiki on the server ────────────

  assertNotContains(
    wikiPageSource,
    "getOrCreateArtistWiki",
    "Wiki page does not block on server-side wiki generation",
    failures,
  );

  // ── Client component: states ─────────────────────────────────────────────

  assertContains(
    wikiClientSource,
    'kind: "loading"',
    "WikiContentClient has loading state",
    failures,
  );

  assertContains(
    wikiClientSource,
    'kind: "loaded"',
    "WikiContentClient has loaded state",
    failures,
  );

  assertContains(
    wikiClientSource,
    'kind: "error"',
    "WikiContentClient has error state",
    failures,
  );

  assertContains(
    wikiClientSource,
    "Generating artist wiki",
    "WikiContentClient shows generation message during loading",
    failures,
  );

  assertContains(
    wikiClientSource,
    "Try again",
    "WikiContentClient shows retry button on error",
    failures,
  );

  assertContains(
    wikiClientSource,
    "/api/artist-wiki",
    "WikiContentClient calls API endpoint for generation",
    failures,
  );

  assertContains(
    wikiClientSource,
    "Auto-trigger generation",
    "WikiContentClient auto-triggers generation on mount",
    failures,
  );

  // ── Client component: renders full wiki ─────────────────────────────────

  assertContains(
    wikiClientSource,
    "Formation and Backstory",
    "WikiContentClient renders formation section",
    failures,
  );

  assertContains(
    wikiClientSource,
    "Style and Influences",
    "WikiContentClient renders style section",
    failures,
  );

  assertContains(
    wikiClientSource,
    "Discography",
    "WikiContentClient renders discography section",
    failures,
  );

  assertContains(
    wikiClientSource,
    "Sources",
    "WikiContentClient renders sources section",
    failures,
  );

  // ── CSS: new classes ─────────────────────────────────────────────────────

  assertContains(
    wikiCssSource,
    "artistWikiGenerationNote",
    "browse.css includes artistWikiGenerationNote styles",
    failures,
  );

  assertContains(
    wikiCssSource,
    "artistWikiRetryButton",
    "browse.css includes artistWikiRetryButton styles",
    failures,
  );

  // ── CSS: responsive layout ──────────────────────────────────────────────

  assertContains(
    wikiCssSource,
    "artistWikiTopRow",
    "browse.css defines responsive wiki top row",
    failures,
  );

  assertContains(
    wikiCssSource,
    "max-width: 900px",
    "browse.css has mobile breakpoint for wiki layout",
    failures,
  );

  assertContains(
    wikiCssSource,
    "grid-template-columns: 1fr",
    "browse.css stacks wiki top row on mobile",
    failures,
  );

  // ── Wiki link component ──────────────────────────────────────────────────

  assertContains(
    wikiLinkSource,
    "router.push(targetHref)",
    "Wiki link navigates via router.push for client-side transition",
    failures,
  );

  assertContains(
    wikiLinkSource,
    "withVideoContext",
    "Wiki link preserves video context in URL",
    failures,
  );

  // ── Not-found: only for genuine missing artists ──────────────────────────

  assertContains(
    wikiNotfoundSource,
    "Wiki unavailable",
    "Wiki not-found page exists for genuine 404s",
    failures,
  );

  // ── Error boundary: should NOT be the primary error handler ──────────────

  assertContains(
    wikiErrorSource,
    "Artist wiki temporarily unavailable",
    "Wiki error boundary handles unexpected server errors",
    failures,
  );

  // ── Routing ──────────────────────────────────────────────────────────────

  assertContains(
    artistRoutingSource,
    "getArtistWikiPath",
    "Artist routing exposes wiki path helper",
    failures,
  );

  finishInvariantCheck({
    failures,
    failureHeader: "Artist wiki invariant check failed.",
    successMessage: "Artist wiki invariant check passed.",
  });
}

main();

#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { isRockMetalGenre } = require("./lib/genre-scope");
const { assertContains, assertNotContains, assertInvariant, finishInvariantCheck, readFileStrict } = require("./lib/test-harness");
const { asNumber, readArg } = require("./lib/cli");

const ROOT = process.cwd();
const SOURCE_FILES = {
  categoriesParentPage: path.join(ROOT, "apps/web/app/(shell)/categories/page.tsx"),
  topLevelCardsApi: path.join(ROOT, "apps/web/app/api/categories/top-level-cards/route.ts"),
  categoryPage: path.join(ROOT, "apps/web/app/(shell)/categories/[slug]/page.tsx"),
  categoryPageLoading: path.join(ROOT, "apps/web/app/(shell)/categories/[slug]/loading.tsx"),
  categoryArtistPage: path.join(ROOT, "apps/web/app/(shell)/categories/[slug]/artists/[artistSlug]/page.tsx"),
  categoryArtistsApi: path.join(ROOT, "apps/web/app/api/categories/[slug]/artists/route.ts"),
  categoryArtistVideosApi: path.join(ROOT, "apps/web/app/api/categories/[slug]/artists/[artistSlug]/route.ts"),
  categoryVideosInfinite: path.join(ROOT, "apps/web/components/category-videos-infinite.tsx"),
  categoryCardsSessionCache: path.join(ROOT, "apps/web/lib/category-cards-session-cache.ts"),
  categoryArtistsSessionCache: path.join(ROOT, "apps/web/lib/category-artists-session-cache.ts"),
  categoriesNewParentPage: path.join(ROOT, "apps/web/app/(shell)/categories_new/page.tsx"),
  categoriesNewCategoryPage: path.join(ROOT, "apps/web/app/(shell)/categories_new/[slug]/page.tsx"),
  categoriesNewGrid: path.join(ROOT, "apps/web/components/categories-new-grid.tsx"),
  categoriesNewArtistsBrowser: path.join(ROOT, "apps/web/components/category-new-artists-browser.tsx"),
  categoriesNewSnapshots: path.join(ROOT, "apps/web/lib/categories-new-snapshots.ts"),
  thumbnailPinClientSync: path.join(ROOT, "apps/web/lib/thumbnail-pin-client-sync.ts"),
  artistVideoLink: path.join(ROOT, "apps/web/components/artist-video-link.tsx"),
  catalogDataCore: path.join(ROOT, "apps/web/lib/catalog-data-core.ts"),
  catalogDataGenres: path.join(ROOT, "apps/web/lib/catalog-data-genres.ts"),
  warmCategoryCaches: path.join(ROOT, "scripts/warm-category-caches.js"),
  adminThumbnailPinsRoute: path.join(ROOT, "apps/web/app/api/admin/thumbnail-pins/route.ts"),
  genreBuckets: path.join(ROOT, "apps/web/lib/genre-buckets.ts"),
};

const TOP_LEVEL_BUCKET_LABELS = new Set([
  "Rock & Alternative",
  "Punk & Hardcore",
  "Classic and Symphonic Metal",
  "Thrash & Power Metal",
  "Black and Death Metal",
  "Doom & Sludge",
  "Nu-metal & Metalcore",
  "Progressive & Experimental",
].map((value) => value.toLowerCase()));

function loadDatabaseEnv() {
  const envPath = path.resolve(process.cwd(), "apps/web/.env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key]) {
      continue;
    }

    process.env[key] = rawValue.replace(/^"/, "").replace(/"$/, "");
  }
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getInvariantDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return databaseUrl;
  }

  try {
    const url = new URL(databaseUrl);
    if (!url.searchParams.has("connectionLimit")) {
      url.searchParams.set("connectionLimit", process.env.PRISMA_CONNECTION_LIMIT || "10");
    }
    if (!url.searchParams.has("acquireTimeout")) {
      url.searchParams.set("acquireTimeout", process.env.PRISMA_POOL_TIMEOUT_MS || "30000");
    }
    if (!url.searchParams.has("connectTimeout")) {
      url.searchParams.set("connectTimeout", process.env.PRISMA_CONNECT_TIMEOUT_MS || "5000");
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

function getMySqlConnectionConfig() {
  const databaseUrl = getInvariantDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    connectTimeout: Number(parsed.searchParams.get("connectTimeout") || 5000),
  };
}

function isTransientPoolError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("pool timeout")
    || error.message.includes("failed to retrieve a connection from pool")
    || error.message.includes("Connection timed out")
  );
}

async function queryWithRetry(runQuery, queryName, attempts = 3) {
  let attempt = 1;
  let waitMs = 400;

  while (attempt <= attempts) {
    try {
      return await runQuery();
    } catch (error) {
      const retryable = isTransientPoolError(error);
      if (!retryable || attempt >= attempts) {
        throw error;
      }

      console.warn(`[warn] ${queryName} transient DB timeout (attempt ${attempt}/${attempts}); retrying in ${waitMs}ms`);
      await sleep(waitMs);
      waitMs *= 2;
      attempt += 1;
    }
  }

  throw new Error(`Unexpected retry state for ${queryName}`);
}

async function runSqlQuery(connection, sql) {
  const [rows] = await connection.query(sql);
  return rows;
}

function getGenreSlug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function runSourceChecks(failures) {
  const categoriesParentPageSource = readFileStrict(SOURCE_FILES.categoriesParentPage, ROOT);
  const topLevelCardsApiSource = readFileStrict(SOURCE_FILES.topLevelCardsApi, ROOT);
  const categoryPageSource = readFileStrict(SOURCE_FILES.categoryPage, ROOT);
  const categoryPageLoadingSource = readFileStrict(SOURCE_FILES.categoryPageLoading, ROOT);
  const categoryArtistPageSource = readFileStrict(SOURCE_FILES.categoryArtistPage, ROOT);
  const categoryArtistsApiSource = readFileStrict(SOURCE_FILES.categoryArtistsApi, ROOT);
  const categoryArtistVideosApiSource = readFileStrict(SOURCE_FILES.categoryArtistVideosApi, ROOT);
  const categoryVideosInfiniteSource = readFileStrict(SOURCE_FILES.categoryVideosInfinite, ROOT);
  const categoryCardsSessionCacheSource = readFileStrict(SOURCE_FILES.categoryCardsSessionCache, ROOT);
  const categoryArtistsSessionCacheSource = readFileStrict(SOURCE_FILES.categoryArtistsSessionCache, ROOT);
  const categoriesNewParentPageSource = readFileStrict(SOURCE_FILES.categoriesNewParentPage, ROOT);
  const categoriesNewCategoryPageSource = readFileStrict(SOURCE_FILES.categoriesNewCategoryPage, ROOT);
  const categoriesNewGridSource = readFileStrict(SOURCE_FILES.categoriesNewGrid, ROOT);
  const categoriesNewArtistsBrowserSource = readFileStrict(SOURCE_FILES.categoriesNewArtistsBrowser, ROOT);
  const categoriesNewSnapshotsSource = readFileStrict(SOURCE_FILES.categoriesNewSnapshots, ROOT);
  const thumbnailPinClientSyncSource = readFileStrict(SOURCE_FILES.thumbnailPinClientSync, ROOT);
  const artistVideoLinkSource = readFileStrict(SOURCE_FILES.artistVideoLink, ROOT);
  const catalogDataCoreSource = readFileStrict(SOURCE_FILES.catalogDataCore, ROOT);
  const catalogDataGenresSource = readFileStrict(SOURCE_FILES.catalogDataGenres, ROOT);
  const warmCategoryCachesSource = readFileStrict(SOURCE_FILES.warmCategoryCaches, ROOT);
  const adminThumbnailPinsRouteSource = readFileStrict(SOURCE_FILES.adminThumbnailPinsRoute, ROOT);
  const genreBucketsSource = readFileStrict(SOURCE_FILES.genreBuckets, ROOT);

  assertContains(categoriesParentPageSource, "getCategoriesNewTopLevelSnapshot", "Categories parent page reads snapshot-backed top-level categories", failures);
  assertContains(categoriesParentPageSource, "<CategoriesNewGrid cards={cards} basePath=\"/categories\" />", "Categories parent page renders snapshot-backed grid as canonical categories UI", failures);

  assertContains(topLevelCardsApiSource, "getRuntimeCachedTopLevelGenreCards", "Top-level cards API reads runtime cache source", failures);
  assertNotContains(topLevelCardsApiSource, "getGenreCards", "Top-level cards API avoids request-time genre-card rebuilds", failures);
  assertContains(topLevelCardsApiSource, "Cache-Control", "Top-level cards API emits cache headers", failures);

  assertContains(categoryCardsSessionCacheSource, "readCategoryCardsSessionCache", "Category cards session cache exposes read helper", failures);
  assertContains(categoryCardsSessionCacheSource, "prefetchCategoryCardsSessionCache", "Category cards session cache exposes prefetch helper", failures);
  assertContains(categoryCardsSessionCacheSource, "CATEGORY_CARDS_PIN_OVERRIDES_KEY", "Category cards cache persists admin pin overrides separately", failures);
  assertContains(categoryCardsSessionCacheSource, "applyCategoryCardThumbnailPinOverrides", "Category cards cache applies persisted pin overrides during hydration", failures);
  assertContains(categoryCardsSessionCacheSource, "writeCategoryCardThumbnailPinOverride", "Category cards cache can persist override writes even without full cards cache", failures);

  assertContains(categoryArtistsSessionCacheSource, "prefetchCategoryArtistsFirstPayloadForSlugs", "Category artists session cache supports batch slug prefetch", failures);
  assertContains(categoryArtistsSessionCacheSource, "FIRST_PAGE_LIMIT = 50", "Category artists session cache prefetch uses bounded first page payload", failures);
  assertContains(categoryArtistsSessionCacheSource, "fetchCategoryArtistsFullPayload", "Category artists session cache can hydrate full category payloads in one request", failures);
  assertContains(categoryArtistsSessionCacheSource, "FULL_PAYLOAD_LIMIT = 25_000", "Category artists full payload fetch has a bounded but comprehensive limit", failures);
  assertContains(categoryArtistsSessionCacheSource, "patchCategoryArtistThumbnailInCaches", "Category artists cache supports immediate thumbnail patch after admin pin", failures);

  assertContains(categoryArtistsApiSource, "full\") === \"1\"", "Category artists API supports full cached payload requests", failures);
  assertContains(categoryArtistsApiSource, "warm\") === \"1\"", "Category artists API supports awaited runtime cache warming", failures);
  assertContains(categoryArtistsApiSource, "getCachedCategoryArtistsByGenre", "Category artists API uses cache-only reads for normal full payload requests", failures);
  assertContains(catalogDataCoreSource, "scheduleCategoriesNewSnapshotBuild", "Catalog cache invalidation triggers categories_new snapshot builds", failures);
  assertContains(categoriesNewSnapshotsSource, "category_page_snapshots", "Categories_new snapshot store persists versioned page payloads", failures);
  assertContains(categoriesNewSnapshotsSource, "category_page_snapshot_state", "Categories_new snapshot store keeps an active build pointer for atomic publish", failures);
  assertContains(categoriesNewSnapshotsSource, "scheduleCategoriesNewSnapshotBuild", "Categories_new snapshot store exposes a shared background build trigger", failures);
  assertContains(categoriesNewSnapshotsSource, "getCategoriesNewTopLevelSnapshot", "Categories_new snapshot store exposes top-level snapshot reads", failures);
  assertContains(categoriesNewSnapshotsSource, "getCategoriesNewCategorySnapshot", "Categories_new snapshot store exposes per-category snapshot reads", failures);
  assertContains(categoriesNewSnapshotsSource, "SNAPSHOT_ARTIST_LIMIT = 25_000", "Categories_new snapshot builds capture comprehensive artist grids", failures);
  assertContains(catalogDataGenresSource, "warmCategoryArtistRuntimeCacheByGenre", "Catalog genre data exposes category artist runtime cache warmer", failures);
  assertContains(catalogDataGenresSource, "CATEGORY_ARTIST_RUNTIME_CACHE_REBUILD_LIMIT = 25_000", "Category artist runtime cache rebuild limit is comprehensive", failures);
  assertContains(warmCategoryCachesSource, "full=1&warm=1", "Category warmup refreshes full category artist runtime caches", failures);

  assertContains(categoriesNewParentPageSource, "redirect(\"/categories\")", "Categories_new parent route redirects to canonical /categories", failures);
  assertContains(categoriesNewGridSource, "href={`${basePath}/${encodeURIComponent(card.slug)}`}", "Categories snapshot grid deep-links into canonical category detail routes", failures);
  assertContains(categoriesNewCategoryPageSource, "redirect(`/categories/${encodeURIComponent(slug)}`)", "Categories_new detail route redirects to canonical /categories detail", failures);
  assertContains(categoriesNewArtistsBrowserSource, "Categories New", "Categories_new category browser presents the snapshot-backed breadcrumb", failures);
  assertContains(categoriesNewArtistsBrowserSource, "categoryBrowserArtistTotal", "Categories_new category browser shows embedded total artist counts immediately", failures);
  assertContains(categoriesNewArtistsBrowserSource, "VIRTUAL_OVERSCAN_ROWS", "Categories_new category browser virtualizes the precomputed artist grid", failures);

  assertContains(thumbnailPinClientSyncSource, "THUMBNAIL_PIN_UPDATED_EVENT", "Thumbnail pin client sync event constant exists", failures);
  assertContains(thumbnailPinClientSyncSource, "dispatchThumbnailPinUpdated", "Thumbnail pin client sync dispatcher exists", failures);

  assertContains(categoryPageSource, "getCategoriesNewCategorySnapshot", "Category page reads snapshot-backed category detail", failures);
  assertContains(categoryPageSource, "CategoryNewArtistsBrowser", "Category page renders snapshot-backed category browser", failures);
  assertContains(categoryPageLoadingSource, "Loading category...", "Category detail route exposes an immediate loading state", failures);
  assertContains(categoryPageLoadingSource, "OverlayScrollReset", "Category detail loading state preserves overlay scroll reset behavior", failures);
  assertContains(categoryPageLoadingSource, "playerBootLoader", "Category detail loading state uses the shared boot loader styling", failures);
  assertContains(categoryArtistPageSource, "getVideosByGenreAndArtist", "Category artist page resolves artist-scoped videos", failures);
  assertContains(categoryArtistPageSource, "CategoryVideosInfinite", "Category artist page renders category video infinite view", failures);
  assertContains(categoryArtistsApiSource, "getCategoryArtistsByGenre", "Category artists API resolves category artists", failures);
  assertContains(categoryArtistsApiSource, "nextOffset: offset + artists.length", "Category artists API computes nextOffset from returned artists", failures);
  assertContains(categoryArtistVideosApiSource, "getVideosByGenreAndArtist", "Category artist videos API resolves artist-scoped videos", failures);
  assertContains(categoryArtistVideosApiSource, "getOptionalApiAuth", "Category artist videos API supports optional auth context", failures);
  assertContains(categoryArtistVideosApiSource, "filterHiddenVideos", "Category artist videos API filters hidden videos for authenticated users", failures);
  assertContains(categoriesNewArtistsBrowserSource, "/categories/${encodeURIComponent(slug)}/artists/${encodeURIComponent(artist.slug)}", "Category artists cards deep-link into category artist video routes", failures);
  assertContains(categoryVideosInfiniteSource, "const isArtistCategoryRoute = Boolean(artistSlug && artistName);", "Category videos view distinguishes category artist route mode", failures);
  assertContains(categoryVideosInfiniteSource, "? `/api/categories/${encodeURIComponent(slug)}/artists/${encodeURIComponent(artistSlug ?? \"\")}`", "Category videos view fetches from artist-scoped API on artist route", failures);
  assertContains(artistVideoLinkSource, "target: adminThumbnailPinTarget", "Artist video card pin button submits explicit thumbnail pin target", failures);
  assertContains(artistVideoLinkSource, "patchCategoryArtistThumbnailInCaches", "Artist video card pin flow patches category artist caches immediately", failures);
  assertContains(artistVideoLinkSource, "patchCategoryCardThumbnailInSessionCache", "Artist video card pin flow patches top-level category cards cache", failures);
  assertContains(artistVideoLinkSource, "dispatchThumbnailPinUpdated", "Artist video card pin flow dispatches thumbnail pin update events", failures);

  assertContains(categoriesNewArtistsBrowserSource, "THUMBNAIL_PIN_UPDATED_EVENT", "Category artists browser listens for thumbnail pin update events", failures);

  assertContains(catalogDataGenresSource, "setTopLevelCategoryThumbnailPin", "Genre data layer exports dedicated top-level category thumbnail pin helper", failures);
  assertContains(catalogDataGenresSource, "await prisma.genreCard.upsert({", "Top-level category thumbnail pin persists via upsert", failures);
  assertContains(catalogDataGenresSource, "persistTopLevelCategoryPreview", "Category artist pin pipeline reuses shared persistence helper", failures);
  assertContains(catalogDataGenresSource, "applyPinnedCategoryArtistPreviews", "Genre card rebuild path reapplies pinned previews before caching", failures);
  assertContains(adminThumbnailPinsRouteSource, "setTopLevelCategoryThumbnailPin", "Admin thumbnail pin API uses robust top-level pin helper", failures);

  assertContains(genreBucketsSource, 'label: "Rock & Alternative"', "Top-level category bucket list includes Rock & Alternative", failures);
  assertContains(genreBucketsSource, 'label: "Punk & Hardcore"', "Top-level category bucket list includes Punk & Hardcore", failures);
  assertContains(genreBucketsSource, 'label: "Classic and Symphonic Metal"', "Top-level category bucket list includes Classic and Symphonic Metal", failures);
  assertContains(genreBucketsSource, 'label: "Thrash & Power Metal"', "Top-level category bucket list includes Thrash & Power Metal", failures);
  assertContains(genreBucketsSource, 'label: "Black and Death Metal"', "Top-level category bucket list includes Black and Death Metal", failures);
  assertContains(genreBucketsSource, 'label: "Doom & Sludge"', "Top-level category bucket list includes Doom & Sludge", failures);
  assertContains(genreBucketsSource, 'label: "Nu-metal & Metalcore"', "Top-level category bucket list includes Nu-metal & Metalcore", failures);
  assertContains(genreBucketsSource, 'label: "Progressive & Experimental"', "Top-level category bucket list includes Progressive & Experimental", failures);

  const topLevelBucketCount = (genreBucketsSource.match(/label:\s*"/g) || []).length;
  assertInvariant(topLevelBucketCount === 8, "Top-level category bucket list defines exactly 8 categories", `count=${topLevelBucketCount}`, failures);
}

async function runApiChecks({ baseUrl, maxApiDurationMs, minCoverage }, failures) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const url = `${normalizedBaseUrl}/api/categories`;

  async function fetchCategoriesSample() {
    const startedAt = Date.now();
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache",
      },
    });
    const networkDurationMs = Date.now() - startedAt;

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`);
    }

    const durationMs = Number(payload?.meta?.durationMs ?? NaN);
    return {
      response,
      payload,
      durationMs,
      networkDurationMs,
    };
  }

  try {
    // Warm the API route once to avoid one-off cold-start variance in full-suite checks.
    await fetchCategoriesSample();
  } catch {
    // Continue to measured attempts where failures are reported with details.
  }

  const samples = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const sample = await fetchCategoriesSample();
      samples.push(sample);
    } catch (error) {
      failures.push({
        description: `API /api/categories attempt ${attempt} reachable and parseable`,
        details: `request failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      console.error(`[fail] API /api/categories attempt ${attempt} reachable and parseable`);
    }
  }

  if (samples.length === 0) {
    return;
  }

  const primarySample = samples[0];
  const response = primarySample.response;
  const payload = primarySample.payload;

  assertInvariant(response.ok, "API /api/categories returns 2xx", `status=${response.status}`, failures);

  const categories = Array.isArray(payload?.categories) ? payload.categories : [];
  const count = Number(payload?.meta?.count ?? 0);
  const withThumb = categories.filter(
    (entry) => typeof entry?.previewVideoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(entry.previewVideoId),
  ).length;

  const bestDurationMs = samples
    .map((sample) => sample.durationMs)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0];
  const bestNetworkDurationMs = samples
    .map((sample) => sample.networkDurationMs)
    .sort((a, b) => a - b)[0];

  assertInvariant(categories.length === count, "API meta count matches payload size", `meta.count=${count} categories=${categories.length}`, failures);
  assertInvariant(
    Number.isFinite(bestDurationMs) && bestDurationMs <= maxApiDurationMs,
    "API reports fast compute duration",
    `bestDurationMs=${bestDurationMs} max=${maxApiDurationMs} samples=${samples.map((sample) => sample.durationMs).join(",")}`,
    failures,
  );
  assertInvariant(
    bestNetworkDurationMs <= Math.max(maxApiDurationMs * 4, 1200),
    "API network response is responsive",
    `bestNetworkMs=${bestNetworkDurationMs} samples=${samples.map((sample) => sample.networkDurationMs).join(",")}`,
    failures,
  );

  const coverage = categories.length > 0 ? withThumb / categories.length : 0;
  assertInvariant(
    coverage >= minCoverage,
    "API thumbnail coverage meets threshold",
    `coverage=${(coverage * 100).toFixed(2)}% threshold=${(minCoverage * 100).toFixed(2)}%`,
    failures,
  );

  if (categories.length === 0) {
    assertInvariant(true, "API category slug checks skipped when no categories exist", "", failures);
    return;
  }

  const firstGenre = String(categories[0]?.genre ?? "").trim();
  const firstSlug = getGenreSlug(firstGenre);
  assertInvariant(Boolean(firstSlug), "API category slug derivation yields non-empty slug", `genre=${firstGenre}`, failures);
  if (!firstSlug) {
    return;
  }

  const categoryUrl = `${normalizedBaseUrl}/api/categories/${encodeURIComponent(firstSlug)}?limit=24&offset=0`;
  let categoryResponse;
  try {
    categoryResponse = await fetch(categoryUrl, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    failures.push({
      description: "API /api/categories/[slug] reachable",
      details: `request failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error("[fail] API /api/categories/[slug] reachable");
    return;
  }

  assertInvariant(
    categoryResponse.status !== 500,
    "API /api/categories/[slug] never returns raw 500",
    `status=${categoryResponse.status}`,
    failures,
  );

  let categoryPayload;
  try {
    categoryPayload = await categoryResponse.json();
  } catch (error) {
    failures.push({
      description: "API /api/categories/[slug] returns valid JSON",
      details: error instanceof Error ? error.message : String(error),
    });
    console.error("[fail] API /api/categories/[slug] returns valid JSON");
    return;
  }

  if (categoryResponse.status === 200) {
    assertInvariant(typeof categoryPayload?.genre === "string" && categoryPayload.genre.length > 0, "API /api/categories/[slug] returns canonical genre name", `genre=${String(categoryPayload?.genre)}`, failures);
    assertInvariant(Array.isArray(categoryPayload?.videos), "API /api/categories/[slug] returns videos array", `videosType=${typeof categoryPayload?.videos}`, failures);
    assertInvariant(typeof categoryPayload?.hasMore === "boolean", "API /api/categories/[slug] returns hasMore boolean", `hasMore=${String(categoryPayload?.hasMore)}`, failures);
    assertInvariant(Number.isFinite(Number(categoryPayload?.nextOffset)), "API /api/categories/[slug] returns numeric nextOffset", `nextOffset=${String(categoryPayload?.nextOffset)}`, failures);
  } else {
    assertInvariant(categoryResponse.status === 503, "API /api/categories/[slug] hard-fails with 503 when canonical data is unavailable", `status=${categoryResponse.status}`, failures);
    assertInvariant(
      categoryPayload?.error === "The system cannot serve this request right now. Please try again later.",
      "API /api/categories/[slug] returns explicit retry message on hard-fail",
      `error=${String(categoryPayload?.error)}`,
      failures,
    );
  }

  const categoryArtistsUrl = `${normalizedBaseUrl}/api/categories/${encodeURIComponent(firstSlug)}/artists?limit=24&offset=0`;
  let categoryArtistsResponse;
  try {
    categoryArtistsResponse = await fetch(categoryArtistsUrl, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {

  const topLevelCardsUrl = `${normalizedBaseUrl}/api/categories/top-level-cards`;
  let topLevelCardsResponse;
  try {
    topLevelCardsResponse = await fetch(topLevelCardsUrl, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    failures.push({
      description: "API /api/categories/top-level-cards reachable",
      details: `request failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error("[fail] API /api/categories/top-level-cards reachable");
    return;
  }

  assertInvariant(topLevelCardsResponse.ok, "API /api/categories/top-level-cards returns 2xx", `status=${topLevelCardsResponse.status}`, failures);

  let topLevelCardsPayload;
  try {
    topLevelCardsPayload = await topLevelCardsResponse.json();
  } catch (error) {
    failures.push({
      description: "API /api/categories/top-level-cards returns valid JSON",
      details: error instanceof Error ? error.message : String(error),
    });
    console.error("[fail] API /api/categories/top-level-cards returns valid JSON");
    return;
  }

  const topLevelCards = Array.isArray(topLevelCardsPayload?.cards) ? topLevelCardsPayload.cards : [];
  assertInvariant(topLevelCards.length === 8, "API /api/categories/top-level-cards returns 8 top-level categories", `count=${topLevelCards.length}`, failures);
  assertInvariant(topLevelCards.every((card) => typeof card?.genre === "string" && card.genre.length > 0), "API /api/categories/top-level-cards returns cards with genre labels", "missing genre labels", failures);
  assertInvariant(topLevelCards.every((card) => Number.isFinite(Number(card?.artistCount ?? NaN))), "API /api/categories/top-level-cards returns numeric artist counts", "non-numeric artistCount detected", failures);
    failures.push({
      description: "API /api/categories/[slug]/artists reachable",
      details: `request failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error("[fail] API /api/categories/[slug]/artists reachable");
    return;
  }

  assertInvariant(
    categoryArtistsResponse.status !== 500,
    "API /api/categories/[slug]/artists never returns raw 500",
    `status=${categoryArtistsResponse.status}`,
    failures,
  );

  let categoryArtistsPayload;
  try {
    categoryArtistsPayload = await categoryArtistsResponse.json();
  } catch (error) {
    failures.push({
      description: "API /api/categories/[slug]/artists returns valid JSON",
      details: error instanceof Error ? error.message : String(error),
    });
    console.error("[fail] API /api/categories/[slug]/artists returns valid JSON");
    return;
  }

  if (categoryArtistsResponse.status === 200) {
    assertInvariant(typeof categoryArtistsPayload?.genre === "string" && categoryArtistsPayload.genre.length > 0, "API /api/categories/[slug]/artists returns canonical genre name", `genre=${String(categoryArtistsPayload?.genre)}`, failures);
    assertInvariant(Array.isArray(categoryArtistsPayload?.artists), "API /api/categories/[slug]/artists returns artists array", `artistsType=${typeof categoryArtistsPayload?.artists}`, failures);
    assertInvariant(typeof categoryArtistsPayload?.hasMore === "boolean", "API /api/categories/[slug]/artists returns hasMore boolean", `hasMore=${String(categoryArtistsPayload?.hasMore)}`, failures);
    assertInvariant(Number.isFinite(Number(categoryArtistsPayload?.nextOffset)), "API /api/categories/[slug]/artists returns numeric nextOffset", `nextOffset=${String(categoryArtistsPayload?.nextOffset)}`, failures);

    const artists = Array.isArray(categoryArtistsPayload?.artists) ? categoryArtistsPayload.artists : [];
    const firstArtist = artists.find((artist) => typeof artist?.slug === "string" && artist.slug.length > 0);

    if (firstArtist) {
      const artistName = String(firstArtist.name ?? "").trim();
      const artistSlug = String(firstArtist.slug ?? "").trim();
      const categoryArtistVideosUrl = `${normalizedBaseUrl}/api/categories/${encodeURIComponent(firstSlug)}/artists/${encodeURIComponent(artistSlug)}?limit=24&offset=0${artistName ? `&name=${encodeURIComponent(artistName)}` : ""}`;

      let categoryArtistVideosResponse;
      try {
        categoryArtistVideosResponse = await fetch(categoryArtistVideosUrl, {
          method: "GET",
          headers: {
            "Cache-Control": "no-cache",
          },
        });
      } catch (error) {
        failures.push({
          description: "API /api/categories/[slug]/artists/[artistSlug] reachable",
          details: `request failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        console.error("[fail] API /api/categories/[slug]/artists/[artistSlug] reachable");
        return;
      }

      assertInvariant(
        categoryArtistVideosResponse.status !== 500,
        "API /api/categories/[slug]/artists/[artistSlug] never returns raw 500",
        `status=${categoryArtistVideosResponse.status}`,
        failures,
      );

      let categoryArtistVideosPayload;
      try {
        categoryArtistVideosPayload = await categoryArtistVideosResponse.json();
      } catch (error) {
        failures.push({
          description: "API /api/categories/[slug]/artists/[artistSlug] returns valid JSON",
          details: error instanceof Error ? error.message : String(error),
        });
        console.error("[fail] API /api/categories/[slug]/artists/[artistSlug] returns valid JSON");
        return;
      }

      if (categoryArtistVideosResponse.status === 200) {
        assertInvariant(typeof categoryArtistVideosPayload?.genre === "string" && categoryArtistVideosPayload.genre.length > 0, "API /api/categories/[slug]/artists/[artistSlug] returns canonical genre", `genre=${String(categoryArtistVideosPayload?.genre)}`, failures);
        assertInvariant(typeof categoryArtistVideosPayload?.artistName === "string" && categoryArtistVideosPayload.artistName.length > 0, "API /api/categories/[slug]/artists/[artistSlug] returns canonical artistName", `artistName=${String(categoryArtistVideosPayload?.artistName)}`, failures);
        assertInvariant(Array.isArray(categoryArtistVideosPayload?.videos), "API /api/categories/[slug]/artists/[artistSlug] returns videos array", `videosType=${typeof categoryArtistVideosPayload?.videos}`, failures);
        assertInvariant(typeof categoryArtistVideosPayload?.hasMore === "boolean", "API /api/categories/[slug]/artists/[artistSlug] returns hasMore boolean", `hasMore=${String(categoryArtistVideosPayload?.hasMore)}`, failures);
        assertInvariant(Number.isFinite(Number(categoryArtistVideosPayload?.nextOffset)), "API /api/categories/[slug]/artists/[artistSlug] returns numeric nextOffset", `nextOffset=${String(categoryArtistVideosPayload?.nextOffset)}`, failures);
      } else {
        assertInvariant(categoryArtistVideosResponse.status === 503, "API /api/categories/[slug]/artists/[artistSlug] hard-fails with 503 when canonical data is unavailable", `status=${categoryArtistVideosResponse.status}`, failures);
        assertInvariant(
          categoryArtistVideosPayload?.error === "The system cannot serve this request right now. Please try again later.",
          "API /api/categories/[slug]/artists/[artistSlug] returns explicit retry message on hard-fail",
          `error=${String(categoryArtistVideosPayload?.error)}`,
          failures,
        );
      }
    } else {
      assertInvariant(true, "API category artist detail checks skipped when category has no artists", "", failures);
    }
  } else {
    assertInvariant(categoryArtistsResponse.status === 503, "API /api/categories/[slug]/artists hard-fails with 503 when canonical data is unavailable", `status=${categoryArtistsResponse.status}`, failures);
    assertInvariant(
      categoryArtistsPayload?.error === "The system cannot serve this request right now. Please try again later.",
      "API /api/categories/[slug]/artists returns explicit retry message on hard-fail",
      `error=${String(categoryArtistsPayload?.error)}`,
      failures,
    );
  }
}

async function main() {
  if (hasFlag("help")) {
    console.log([
      "Usage: node scripts/verify-categories-invariants.js [options]",
      "",
      "Options:",
      "  --check-api                 Also verify live /api/categories endpoint",
      "  --base-url=http://localhost:3000",
      "  --min-coverage=0.94         Minimum required thumbnail coverage",
      "  --max-api-duration-ms=350   Max API-reported compute duration",
      "  --help",
    ].join("\n"));
    process.exit(0);
  }

  loadDatabaseEnv();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or your shell.");
    process.exit(1);
  }

  const checkApi = hasFlag("check-api");
  const baseUrl = readArg("base-url", "http://localhost:3000");
  const minCoverage = asNumber(readArg("min-coverage", "0.94"), 0.94);
  const maxApiDurationMs = asNumber(readArg("max-api-duration-ms", "350"), 350);

  const mysqlConfig = getMySqlConnectionConfig();
  if (!mysqlConfig) {
    console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or your shell.");
    process.exit(1);
  }

  const connection = await mysql.createConnection(mysqlConfig);
  const failures = [];

  try {
    runSourceChecks(failures);

    const cardCountRows = await queryWithRetry(
      () => runSqlQuery(connection, "SELECT COUNT(*) AS count FROM genre_cards"),
      "genre_cards count",
    );
    const duplicateRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT genre, COUNT(*) AS c
        FROM genre_cards
        GROUP BY genre
        HAVING COUNT(*) > 1
      `),
      "duplicate genre rows",
    );
    const invalidVideoIdRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT genre, thumbnail_video_id AS thumbnailVideoId
        FROM genre_cards
        WHERE thumbnail_video_id IS NOT NULL
          AND thumbnail_video_id NOT REGEXP '^[A-Za-z0-9_-]{11}$'
        LIMIT 20
      `),
      "invalid thumbnail IDs",
    );
    const withThumbRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT COUNT(*) AS count
        FROM genre_cards
        WHERE thumbnail_video_id IS NOT NULL
          AND thumbnail_video_id <> ''
      `),
      "thumbnail coverage count",
    );
    const canonicalGenreRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT name
        FROM genres
        WHERE name IS NOT NULL AND TRIM(name) <> ''
      `),
      "canonical genre rows",
    );
    const cardGenreRows = await queryWithRetry(
      () => runSqlQuery(connection, `
        SELECT genre
        FROM genre_cards
        WHERE genre IS NOT NULL AND TRIM(genre) <> ''
      `),
      "genre_cards genre rows",
    );

    const cardCount = Number(cardCountRows[0]?.count ?? 0);
    const withThumb = Number(withThumbRows[0]?.count ?? 0);
    const coverage = cardCount > 0 ? withThumb / cardCount : 0;
    const canonicalGenres = canonicalGenreRows
      .map((row) => String(row.name).trim())
      .filter((genre) => genre);
    const scopedCanonicalGenres = canonicalGenres
      .filter((genre) => isRockMetalGenre(genre));
    const nonScopedCanonicalGenres = canonicalGenres
      .filter((genre) => genre && !isRockMetalGenre(genre));
    const cardGenres = cardGenreRows
      .map((row) => String(row.genre).trim())
      .filter((genre) => genre);
    const nonScopedCardGenres = cardGenres
      .filter((genre) => genre && !isRockMetalGenre(genre));
    const scopedCanonicalGenreSet = new Set(scopedCanonicalGenres.map((genre) => genre.toLowerCase()));
    const missingScopedCanonicalGenres = cardGenres
      .filter((genre) => {
        const normalizedGenre = genre.toLowerCase();
        return !scopedCanonicalGenreSet.has(normalizedGenre)
          && !TOP_LEVEL_BUCKET_LABELS.has(normalizedGenre);
      });

    console.log("Categories invariant audit\n");
    console.log(`genres_scoped=${scopedCanonicalGenres.length} genre_cards=${cardCount} with_thumb=${withThumb} coverage=${(coverage * 100).toFixed(2)}%\n`);

    assertInvariant(cardCount > 0, "genre_cards contains categories", `cards=${cardCount}`, failures);
    assertInvariant(duplicateRows.length === 0, "No duplicate genres in genre_cards", duplicateRows.length ? `examples=${JSON.stringify(duplicateRows.slice(0, 3))}` : "", failures);
    assertInvariant(invalidVideoIdRows.length === 0, "All thumbnail_video_id values use valid YouTube ID format", invalidVideoIdRows.length ? `examples=${JSON.stringify(invalidVideoIdRows.slice(0, 3))}` : "", failures);
    assertInvariant(
      missingScopedCanonicalGenres.length === 0,
      "genre_cards rows map to scoped canonical genres or top-level buckets",
      missingScopedCanonicalGenres.length ? `examples=${JSON.stringify(missingScopedCanonicalGenres.slice(0, 8))}` : "",
      failures,
    );
    assertInvariant(
      nonScopedCardGenres.length === 0,
      "genre_cards rows are strictly rock/metal scoped",
      nonScopedCardGenres.length ? `examples=${JSON.stringify(nonScopedCardGenres.slice(0, 8))}` : "",
      failures,
    );
    if (nonScopedCanonicalGenres.length > 0) {
      console.warn(`[warn] canonical genres include non-rock/metal values that are excluded from scoped checks: ${JSON.stringify(nonScopedCanonicalGenres.slice(0, 8))}`);
    }
    assertInvariant(
      coverage >= minCoverage,
      "Thumbnail coverage meets threshold",
      `coverage=${(coverage * 100).toFixed(2)}% threshold=${(minCoverage * 100).toFixed(2)}%`,
      failures,
    );

    if (checkApi) {
      console.log("\nRunning live API checks\n");
      await runApiChecks({ baseUrl, maxApiDurationMs, minCoverage }, failures);
    }

    finishInvariantCheck({
      failures,
      failureHeader: `\nInvariant check failed: ${failures.length} issue(s).`,
      successMessage: "\nAll category invariants passed.",
    });
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Fatal error in category invariant checker:", error);
  process.exit(1);
});

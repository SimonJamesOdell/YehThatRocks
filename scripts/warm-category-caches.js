#!/usr/bin/env node

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "YehThatRocks-Warmup/1.0" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function waitForStatus(baseUrl, maxWaitMs, pollMs) {
  const startedAt = Date.now();
  const statusUrl = `${baseUrl}/api/status`;

  while (Date.now() - startedAt < maxWaitMs) {
    try {
      await fetchJson(statusUrl, 4_000);
      return true;
    } catch {
      await sleep(pollMs);
    }
  }

  return false;
}

async function warmCategoryCaches() {
  const baseUrl = (process.env.WARMUP_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  const maxWaitMs = Math.max(5_000, Number(process.env.WARMUP_MAX_WAIT_MS || 90_000));
  const requestTimeoutMs = Math.max(1_000, Number(process.env.WARMUP_REQUEST_TIMEOUT_MS || 12_000));
  const categoryRefreshTimeoutMs = Math.max(requestTimeoutMs, Number(process.env.WARMUP_CATEGORY_REFRESH_TIMEOUT_MS || 120_000));
  const pollMs = Math.max(250, Number(process.env.WARMUP_POLL_MS || 1_000));
  const includeTabCounts = process.env.WARMUP_INCLUDE_TAB_COUNTS !== "0";
  const fullPayloadLimit = Math.max(1, Math.min(25_000, Number(process.env.WARMUP_CATEGORY_FULL_PAYLOAD_LIMIT || 25_000)));
  const snapshotWaitMs = Math.max(0, Number(process.env.WARMUP_SNAPSHOT_WAIT_MS || 180_000));

  console.log(`[warmup] Waiting for app readiness at ${baseUrl}...`);
  const ready = await waitForStatus(baseUrl, maxWaitMs, pollMs);
  if (!ready) {
    throw new Error(`Timed out waiting for ${baseUrl}/api/status`);
  }

  console.log("[warmup] Ensuring categories snapshot is ready...");
  const topLevelCardsPayload = await fetchJson(
    `${baseUrl}/api/categories/top-level-cards?ensureSnapshot=1&waitForSnapshot=1&snapshotWaitMs=${encodeURIComponent(String(snapshotWaitMs))}`,
    Math.max(requestTimeoutMs, snapshotWaitMs + 5_000),
  );
  const categories = Array.isArray(topLevelCardsPayload?.cards) ? topLevelCardsPayload.cards : [];

  const slugs = Array.from(new Set(
    categories
      .map((entry) => slugify(entry?.genre || ""))
      .filter((value) => value.length > 0),
  ));

  if (slugs.length === 0) {
    console.log("[warmup] No category slugs found; warmup complete.");
    return;
  }

  console.log(`[warmup] Refreshing ${slugs.length} category artist runtime caches...`);
  const query = includeTabCounts
    ? `offset=0&limit=${fullPayloadLimit}&full=1&warm=1&includeTabCounts=1`
    : `offset=0&limit=${fullPayloadLimit}&full=1&warm=1`;

  for (const slug of slugs) {
    const url = `${baseUrl}/api/categories/${encodeURIComponent(slug)}/artists?${query}`;
    try {
      await fetchJson(url, categoryRefreshTimeoutMs);
      console.log(`[warmup] OK ${slug}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[warmup] WARN ${slug}: ${message}`);
    }
  }

  console.log("[warmup] Category cache warmup finished.");
}

warmCategoryCaches().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[warmup] Failed: ${message}`);
  process.exit(1);
});

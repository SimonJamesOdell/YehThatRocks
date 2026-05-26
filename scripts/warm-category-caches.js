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
  const pollMs = Math.max(250, Number(process.env.WARMUP_POLL_MS || 1_000));
  const includeTabCounts = process.env.WARMUP_INCLUDE_TAB_COUNTS !== "0";
  const firstPageLimit = Math.max(1, Math.min(200, Number(process.env.WARMUP_CATEGORY_FIRST_PAGE_LIMIT || 50)));

  console.log(`[warmup] Waiting for app readiness at ${baseUrl}...`);
  const ready = await waitForStatus(baseUrl, maxWaitMs, pollMs);
  if (!ready) {
    throw new Error(`Timed out waiting for ${baseUrl}/api/status`);
  }

  console.log("[warmup] Priming top-level category cards...");
  await fetchJson(`${baseUrl}/api/categories/top-level-cards`, requestTimeoutMs);

  console.log("[warmup] Loading categories list...");
  const categoriesPayload = await fetchJson(`${baseUrl}/api/categories`, requestTimeoutMs);
  const categories = Array.isArray(categoriesPayload?.categories) ? categoriesPayload.categories : [];

  const slugs = Array.from(new Set(
    categories
      .map((entry) => slugify(entry?.genre || ""))
      .filter((value) => value.length > 0),
  ));

  if (slugs.length === 0) {
    console.log("[warmup] No category slugs found; warmup complete.");
    return;
  }

  console.log(`[warmup] Priming ${slugs.length} category artist endpoints...`);
  const query = includeTabCounts
    ? `offset=0&limit=${firstPageLimit}&includeTabCounts=1`
    : `offset=0&limit=${firstPageLimit}`;

  for (const slug of slugs) {
    const url = `${baseUrl}/api/categories/${encodeURIComponent(slug)}/artists?${query}`;
    try {
      await fetchJson(url, requestTimeoutMs);
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

/**
 * CSS coverage audit — Playwright test that collects Chrome Coverage API data
 * across key pages to identify unused CSS rules.
 *
 * Run: npx playwright test --project=visual tests/visual/css-coverage-audit.spec.ts
 *
 * Output: test-results/css-coverage-report.json — per-file unused byte counts
 */
import { test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const DEV_SERVER_URL = "http://127.0.0.1:3000";

const PAGES_TO_COVER = [
  { name: "homepage", path: "/", scroll: true },
  { name: "artists", path: "/artists", scroll: true },
  { name: "categories", path: "/categories", scroll: true },
  { name: "search", path: "/search?q=metal", scroll: true },
  { name: "new", path: "/new", scroll: true },
  { name: "top100", path: "/top100", scroll: true },
  { name: "magazine", path: "/magazine", scroll: true },
  { name: "admin", path: "/admin", scroll: true },
  { name: "mobile-home", path: "/m", scroll: true },
];

const REPORT_PATH = path.resolve(process.cwd(), "test-results", "css-coverage-report.json");

// Accumulate coverage across all pages
const globalCoverage: Array<{ url: string; ranges: Array<{ start: number; end: number }> }> = [];

test.describe("CSS coverage audit", () => {
  test("collect coverage across all key pages", async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });

    for (const pageConfig of PAGES_TO_COVER) {
      const page = await context.newPage();

      // Start JS and CSS coverage
      await page.coverage.startCSSCoverage();

      await page.goto(`${DEV_SERVER_URL}${pageConfig.path}`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });

      await page.waitForTimeout(800);

      // Scroll to trigger lazy-loaded content and hover states
      if (pageConfig.scroll) {
        await page.evaluate(async () => {
          const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
          for (let i = 0; i < 5; i++) {
            window.scrollBy(0, window.innerHeight * 0.8);
            await delay(150);
          }
          window.scrollTo(0, 0);
          await delay(200);
        });
      }

      // Collect coverage for this page
      const cssCoverage = await page.coverage.stopCSSCoverage();
      for (const entry of cssCoverage) {
        globalCoverage.push({ url: entry.url, ranges: entry.ranges });
      }

      await page.close();
    }

    // For each stylesheet URL, fetch the raw CSS to get total bytes
    // (must be done before closing the context)
    const stylesheetUrls = [...new Set(globalCoverage.map((e) => e.url))];
    const report: Record<string, { totalBytes: number; usedBytes: number; unusedBytes: number; pctUsed: number }> = {};

    const fetchPage = await context.newPage();
    for (const stylesheetUrl of stylesheetUrls) {
      const fileName = stylesheetUrl.split("/").pop()?.split("?")[0] ?? stylesheetUrl;
      const entries = globalCoverage.filter((e) => e.url === stylesheetUrl);

      let totalBytes = 0;
      try {
        const response = await fetchPage.request.fetch(stylesheetUrl);
        totalBytes = (await response.body()).length;
      } catch {
        continue;
      }

      const usedRanges = entries.flatMap((e) => e.ranges);
      const mergedRanges = mergeRanges(usedRanges);
      const usedBytes = mergedRanges.reduce((sum, r) => sum + (r.end - r.start), 0);
      const unusedBytes = totalBytes - usedBytes;
      const pctUsed = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

      report[fileName] = { totalBytes, usedBytes, unusedBytes, pctUsed };
    }
    await fetchPage.close();

    await context.close();

    // Write report
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    // Print summary
    console.log("\n=== CSS Coverage Report ===\n");
    const sorted = Object.entries(report).sort((a, b) => b[1].unusedBytes - a[1].unusedBytes);
    for (const [file, stats] of sorted) {
      const unusedKB = (stats.unusedBytes / 1024).toFixed(1);
      console.log(
        `${file.padEnd(40)} ${String(stats.totalBytes).padStart(6)} total  ${unusedKB.padStart(6)} KB unused  ${stats.pctUsed.toFixed(1)}% used`,
      );
    }
    console.log(`\nFull report: ${REPORT_PATH}`);
  });
});

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

// Shared user-agent bot detection.
//
// Used to keep bot/crawler traffic out of analytics and magazine-landing
// metrics. Matches self-identified crawlers and known spoofed-device patterns.
//
// Deliberately NOT version-based: version strings are spoofed freely, and
// out-of-date browsers are still used by real people. Version-gating was
// removed to avoid turning those users away.

const CRAWLER_FRAGMENTS = [
  "bot",
  "crawler",
  "spider",
  "facebookexternalhit",
  "yandex",
  "slurp",
  "preview",
  "lightpanda",
  "bytespider",
  "petalbot",
  "semrush",
  "mj12",
  "ahrefs",
  "gptbot",
  "claudebot",
  "anthropic",
  "google-inspectiontool",
  "bingpreview",
  "duckduckbot",
  "linkedinbot",
  "applebot",
  "amazonbot",
];

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").toLowerCase().trim();

  // A missing UA is never a real browser.
  if (!ua) return true;

  if (CRAWLER_FRAGMENTS.some((fragment) => ua.includes(fragment))) return true;

  // Android "K" device placeholder — a classic spoofed-mobile signature.
  if (/android \d+(?:\.\d+)?; k\b/.test(ua)) return true;

  // Ancient Android device spoofs (Android 4–7).
  if (/android [4567]\./.test(ua)) return true;

  // 32-bit Firefox on 64-bit Windows (WOW64) — old scraper signature.
  if (ua.includes("wow64")) return true;

  return false;
}

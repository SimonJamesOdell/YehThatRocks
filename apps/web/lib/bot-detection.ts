// Shared user-agent bot detection.
//
// Used to keep bot/crawler traffic out of analytics and magazine-landing
// metrics. Mirrors the nginx old-UA block (Chrome/Firefox <= 121) plus the
// known crawler signatures and spoofed-device patterns observed in production
// (e.g. "Android 10; K", "WOW64", Yandex, Facebook external hit).

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

  // Old Chrome <= 121 (mirrors the nginx old-UA block).
  const chrome = ua.match(/chrome\/(\d+)/);
  if (chrome && Number(chrome[1]) <= 121) return true;

  // Old Firefox < 100.
  const firefox = ua.match(/firefox\/(\d+)/);
  if (firefox && Number(firefox[1]) < 100) return true;

  return false;
}

import { NextRequest } from "next/server";
import { extractCfHeaders, isCfIdentifiedBot } from "@/lib/cf-headers";

const LOW_VALUE_ENDPOINT_CRAWLER_UA_PATTERN = /(meta-externalagent|meta-externalfetcher|metaexternalhit|facebookexternalhit|facebookcatalog|Googlebot|Google-InspectionTool|Bingbot|BingPreview|LinkedInBot|Twitterbot|Slackbot|Discordbot|DuckDuckBot|redditbot|applebot|SkypeUriPreview|WhatsApp|ia_archiver|GPTBot|vkShare|quora link preview)/i;

/**
 * Known bot/crawler user-agent substrings blocked from account creation.
 * These UAs are never used by real users — blocking them has zero false-positive risk.
 */
const ACCOUNT_CREATION_BOT_UA_PATTERNS = [
  "facebookexternalhit",
  "Facebot",
  "Twitterbot",
  "Googlebot",
  "Bingbot",
  "Slurp",
  "DuckDuckBot",
  "Baiduspider",
  "YandexBot",
  "Sogou",
  "Exabot",
  "ia_archiver",
  "Bytespider",
  "PetalBot",
  "SemrushBot",
  "AhrefsBot",
  "DotBot",
  "MegaIndex",
  "SeekportBot",
  "LinkpadBot",
  "ev-crawler",
  "headline",
  "RootEvidence",
];

export function getRequestUserAgent(request: NextRequest) {
  return request.headers.get("user-agent") ?? "";
}

export function isObviousCrawlerUserAgent(userAgent: string) {
  if (!userAgent) {
    return false;
  }

  return LOW_VALUE_ENDPOINT_CRAWLER_UA_PATTERN.test(userAgent);
}

export function isObviousCrawlerRequest(request: NextRequest) {
  return isObviousCrawlerUserAgent(getRequestUserAgent(request));
}

/**
 * Returns true if the User-Agent matches a known bot/crawler that should never
 * be allowed to create accounts. Zero false positives — these UAs are never
 * used by real human browsers.
 */
export function isAccountCreationBotUA(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return ACCOUNT_CREATION_BOT_UA_PATTERNS.some((pattern) => ua.includes(pattern.toLowerCase()));
}

/**
 * Combined bot detection: User-Agent pattern match OR Cloudflare bot signals.
 * Use at the edge of any endpoint that should reject non-human traffic.
 *
 * Returns true if the request should be treated as a bot.
 */
export function isBotRequest(request: NextRequest): boolean {
  // 1. User-Agent pattern match (fast, no false positives)
  if (isObviousCrawlerRequest(request)) {
    return true;
  }

  // 2. Cloudflare Bot Management / Threat Score (when available)
  const cf = extractCfHeaders(request);
  if (isCfIdentifiedBot(cf)) {
    return true;
  }

  return false;
}

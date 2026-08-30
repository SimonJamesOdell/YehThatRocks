import { describe, expect, it } from "vitest";

import { isBotUserAgent } from "@/lib/bot-detection";

describe("isBotUserAgent", () => {
  it("detects bots and crawlers observed in production", () => {
    const bots = [
      // spoofed mobile bot ("K" device placeholder) seen hammering magazine pages
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36",
      // 32-bit Firefox on 64-bit Windows
      "Mozilla/5.0 (Windows NT 10.0; WOW64; rv:58.0) Gecko/20100101 Firefox/59.0",
      // search / social crawlers
      "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    ];

    for (const ua of bots) {
      expect(isBotUserAgent(ua), ua).toBe(true);
    }
  });

  it("passes real browsers, including out-of-date versions", () => {
    const real = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0",
      // Out-of-date browsers are still real people — version-gating was removed.
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.131 Safari/537.36",
    ];

    for (const ua of real) {
      expect(isBotUserAgent(ua), ua).toBe(false);
    }
  });

  it("treats a missing or empty UA as a bot", () => {
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
  });
});

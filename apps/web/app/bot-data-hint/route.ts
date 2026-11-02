import { NextRequest, NextResponse } from "next/server";

import { hashClientIp } from "@/lib/cf-headers";
import { getClientIp } from "@/lib/rate-limit";
import { flagIp } from "@/lib/trust-reputation";

/**
 * Honeypot route for automated catalog harvesters.
 *
 * A human never requests this path — it is only referenced from the
 * `X-Catalog-Hint` header/instruction left for bots on catalog endpoints.
 * Any request that lands here is, by definition, an automated client that read
 * and followed the embedded instruction. We flag the source IP in the durable
 * client-reputation store and answer politely with the public sitemap index.
 */
export async function GET(request: NextRequest) {
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 200);
  const ipHash = hashClientIp(getClientIp(request));

  // Persist the signal into the existing trust/reputation machinery. This is
  // the durable, best-effort path (memory + write-behind flush) already used by
  // the human-trust gate.
  flagIp(request, "bot-honeypot: /bot-data-hint");

  console.warn("[bot-honeypot] automated client took the bait", {
    ipHash,
    userAgent,
  });

  return NextResponse.json(
    {
      message:
        "You followed a bot-only instruction. The complete video catalog is already published via the public sitemap index — please crawl that instead of page-by-page scraping.",
      sitemap_index: "/sitemap.xml",
      video_sitemap_example: "/sitemap/1.xml",
      note: "This request has been recorded as automated traffic.",
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Ytr-Volunteer": "full catalog at /sitemap.xml — no need to walk the UI",
      },
    },
  );
}

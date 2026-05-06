import { NextRequest, NextResponse } from "next/server";

import { isAdminIdentity } from "@/lib/admin-auth";
import { getOptionalApiAuth } from "@/lib/auth-request";
import { prisma } from "@/lib/db";
import { findAndReplaceUnavailableVideo, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { isObviousCrawlerRequest } from "@/lib/crawler-guard";
import { verifySameOrigin } from "@/lib/csrf";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { parseRequestJson } from "@/lib/request-json";

type MarkUnavailableBody = {
  videoId?: string;
  reason?: string;
};

type AvailabilityClassification =
  | "available"
  | "copyright-claim"
  | "removed-or-private"
  | "embed-restricted"
  | "bot-check"
  | "network-latency"
  | "provider-blocked"
  | "unknown-unavailable"
  | "unknown-check-failed";

type AvailabilityCheckResult = {
  status: "available" | "unavailable" | "check-failed";
  reason: string;
  classification: AvailabilityClassification;
};

const AGE_RESTRICTED_PATTERNS = [
  /Sign in to confirm your age/i,
  /age[-\s]?restricted/i,
  /playerAgeGateRenderer/i,
  /desktopLegacyAgeGateReason/i,
  /"isFamilySafe"\s*:\s*false/i,
  /"status"\s*:\s*"AGE_CHECK_REQUIRED"/i,
  /"status"\s*:\s*"LOGIN_REQUIRED"[\s\S]{0,240}"reason"\s*:\s*"[^"]*age/i,
];
const BOT_CHALLENGE_PATTERNS = [
  /Sign in to (?:confirm|prove) you(?:'|\u2019)re not a bot/i,
  /prove you(?:'|\u2019)re not a bot/i,
  /"status"\s*:\s*"BOT_CHECK_REQUIRED"/i,
];
const UNAVAILABLE_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.DEBUG_UNAVAILABLE === "1";
const OEMBED_VERIFY_TIMEOUT_MS = 1800;
const EMBED_VERIFY_TIMEOUT_MS = 2200;
const WATCH_VERIFY_TIMEOUT_MS = 2400;

function debugUnavailable(event: string, detail?: Record<string, unknown>) {
  if (!UNAVAILABLE_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[api/videos/unavailable] ${event}${payload}`);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function containsAgeRestrictionMarker(html: string) {
  return AGE_RESTRICTED_PATTERNS.some((pattern) => pattern.test(html));
}

function containsBotChallengeMarker(html: string) {
  return BOT_CHALLENGE_PATTERNS.some((pattern) => pattern.test(html));
}

function extractPlayabilityStatus(html: string) {
  const statusMatch = html.match(/"playabilityStatus"\s*:\s*\{[\s\S]{0,800}?"status"\s*:\s*"([A-Z_]+)"([\s\S]{0,1200}?)\}/i);
  if (!statusMatch) {
    return null;
  }

  const status = statusMatch[1]?.trim().toUpperCase() ?? "";
  const chunk = statusMatch[2] ?? "";
  const reasonMatch = chunk.match(/"reason"\s*:\s*"([^"]+)"/i);
  const reason = reasonMatch?.[1]?.trim() ?? null;
  const subreasonMatch = chunk.match(/"subreason"\s*:\s*\{[\s\S]{0,500}?"simpleText"\s*:\s*"([^"]+)"/i)
    || chunk.match(/"subreason"\s*:\s*"([^"]+)"/i);
  const subreason = subreasonMatch?.[1]?.trim() ?? null;
  return { status, reason, subreason };
}

function isUnavailablePlayabilityReason(reason: string | null | undefined) {
  return typeof reason === "string"
    && /(video unavailable|private video|deleted|removed|copyright|terminated|not available|this video is unavailable)/i.test(reason);
}

function classifyPlayabilityFailure(reason: string | null | undefined, subreason?: string | null): Exclude<AvailabilityClassification, "available" | "unknown-check-failed"> | null {
  const combined = `${reason ?? ""} ${subreason ?? ""}`.trim();
  if (!combined) {
    return null;
  }

  if (/(copyright claim|copyrighted content|blocked due to a copyright claim|claim by)/i.test(combined)) {
    return "copyright-claim";
  }

  if (/(private video|video unavailable|this video is unavailable|has been removed|deleted|no longer available|uploader has not made this video available)/i.test(combined)) {
    return "removed-or-private";
  }

  if (/(age[-\s]?restricted|age check|login required)/i.test(combined)) {
    return "embed-restricted";
  }

  if (/(not a bot|prove you(?:'|\u2019)re not a bot|unusual traffic|automated queries|captcha)/i.test(combined)) {
    return "bot-check";
  }

  if (/(not available|unavailable|removed|terminated)/i.test(combined)) {
    return "unknown-unavailable";
  }

  return null;
}

function classifyUnavailableReason(reason: string): AvailabilityClassification {
  if (/copyright/i.test(reason)) {
    return "copyright-claim";
  }

  if (/(private|deleted|removed|video-unavailable|oembed:(404|410)|embed:(404|410))/i.test(reason)) {
    return "removed-or-private";
  }

  if (/age-restricted/i.test(reason)) {
    return "embed-restricted";
  }

  return "unknown-unavailable";
}

function classifyCheckFailedReason(reason: string): AvailabilityClassification {
  if (/(bot-check|interactive-login-check|consent|login-required)/i.test(reason)) {
    return "bot-check";
  }

  if (/(verify-timeout|verify-network)/i.test(reason)) {
    return "network-latency";
  }

  if (/provider-blocked/i.test(reason)) {
    return "provider-blocked";
  }

  return "unknown-check-failed";
}

function shouldForcePruneFromRuntimeReason(reason: string) {
  return /(yt-player-age-or-owner-restricted-(101|150)|yt-player-error-(100|101|150))/i.test(reason);
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function verifyYouTubeAvailability(videoId: string): Promise<AvailabilityCheckResult> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;

  try {
    const oembedResponse = await fetchWithTimeout(oembedUrl, {
      headers: {
        "User-Agent": "YehThatRocks/1.0",
      },
    }, OEMBED_VERIFY_TIMEOUT_MS);

    if ([404, 410].includes(oembedResponse.status)) {
      const reason = `oembed:${oembedResponse.status}`;
      return { status: "unavailable", reason, classification: classifyUnavailableReason(reason) };
    }

    let checkFailedReason: string | null = null;

    if ([401, 403].includes(oembedResponse.status)) {
      checkFailedReason = `oembed:provider-blocked-${oembedResponse.status}`;
    }

    if (oembedResponse.ok) {
      const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1`;
      const embedResponse = await fetchWithTimeout(embedUrl, {
        headers: {
          "User-Agent": "YehThatRocks/1.0",
        },
      }, EMBED_VERIFY_TIMEOUT_MS);

      if ([404, 410].includes(embedResponse.status)) {
        const reason = `embed:${embedResponse.status}`;
        return { status: "unavailable", reason, classification: classifyUnavailableReason(reason) };
      }

      if ([401, 403].includes(embedResponse.status)) {
        checkFailedReason = `embed:provider-blocked-${embedResponse.status}`;
      }

      if (embedResponse.ok) {
        const html = await embedResponse.text();
        const playability = extractPlayabilityStatus(html);

        const playabilityClassification = classifyPlayabilityFailure(playability?.reason, playability?.subreason);

        if (playabilityClassification === "copyright-claim") {
          return { status: "unavailable", reason: "embed:copyright-claim", classification: "copyright-claim" };
        }

        if (playabilityClassification === "removed-or-private") {
          return { status: "unavailable", reason: "embed:removed-or-private", classification: "removed-or-private" };
        }

        if (playabilityClassification === "embed-restricted") {
          return { status: "unavailable", reason: "embed:age-restricted", classification: "embed-restricted" };
        }

        if (containsBotChallengeMarker(html)) {
          checkFailedReason = "embed:bot-check";
        }

        if (containsAgeRestrictionMarker(html)) {
          return { status: "unavailable", reason: "embed:age-restricted", classification: "embed-restricted" };
        }

        if (playability?.status === "LOGIN_REQUIRED" || playability?.status === "CONTENT_CHECK_REQUIRED") {
          if (isUnavailablePlayabilityReason(playability.reason)) {
            return { status: "unavailable", reason: "embed:playability-login-unavailable", classification: "unknown-unavailable" };
          }

          checkFailedReason = "embed:interactive-login-check";
        }

        if (playability && /^(ERROR|UNPLAYABLE|AGE_CHECK_REQUIRED)$/i.test(playability.status)) {
          return { status: "unavailable", reason: "embed:playability-unavailable", classification: "unknown-unavailable" };
        }

        if (/video unavailable/i.test(html)) {
          return { status: "unavailable", reason: "embed:video-unavailable", classification: "removed-or-private" };
        }
      }
    }

    // Fallback to watch page playability to disambiguate provider-block vs true unavailable.
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&bpctr=9999999999&has_verified=1`;
    const watchResponse = await fetchWithTimeout(watchUrl, {
      headers: {
        "User-Agent": "YehThatRocks/1.0",
      },
    }, WATCH_VERIFY_TIMEOUT_MS);

    if ([404, 410].includes(watchResponse.status)) {
      const reason = `watch:${watchResponse.status}`;
      return { status: "unavailable", reason, classification: classifyUnavailableReason(reason) };
    }

    if (watchResponse.ok) {
      const watchHtml = await watchResponse.text();
      const watchPlayability = extractPlayabilityStatus(watchHtml);
      const watchClassification = classifyPlayabilityFailure(watchPlayability?.reason, watchPlayability?.subreason);

      if (watchClassification === "copyright-claim") {
        return { status: "unavailable", reason: "watch:copyright-claim", classification: "copyright-claim" };
      }

      if (watchClassification === "removed-or-private") {
        return { status: "unavailable", reason: "watch:removed-or-private", classification: "removed-or-private" };
      }

      if (watchClassification === "embed-restricted") {
        return { status: "unavailable", reason: "watch:embed-restricted", classification: "embed-restricted" };
      }

      if (watchClassification === "bot-check") {
        return { status: "check-failed", reason: "watch:bot-check", classification: "bot-check" };
      }

      if (watchPlayability && /^(ERROR|UNPLAYABLE|AGE_CHECK_REQUIRED)$/i.test(watchPlayability.status)) {
        return { status: "unavailable", reason: "watch:playability-unavailable", classification: "unknown-unavailable" };
      }

      if (watchPlayability?.status === "LOGIN_REQUIRED" || watchPlayability?.status === "CONTENT_CHECK_REQUIRED") {
        return { status: "check-failed", reason: "watch:interactive-login-check", classification: "bot-check" };
      }
    }

    if (oembedResponse.ok && !checkFailedReason) {
      return { status: "available", reason: "embed:accessible-no-markers", classification: "available" };
    }

    const fallbackReason = checkFailedReason ?? `oembed:${oembedResponse.status}`;
    return {
      status: "check-failed",
      reason: fallbackReason,
      classification: classifyCheckFailedReason(fallbackReason),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        status: "check-failed",
        reason: "verify-timeout",
        classification: "network-latency",
      };
    }

    return {
      status: "check-failed",
      reason: `verify-network:${error instanceof Error ? error.message : "unknown"}`,
      classification: "network-latency",
    };
  }
}

export async function POST(request: NextRequest) {
  if (isObviousCrawlerRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const optionalAuth = await getOptionalApiAuth(request);

  const rateLimited = rateLimitOrResponse(
    request,
    `videos:unavailable:${optionalAuth?.userId ?? "anonymous"}`,
    20,
    10 * 60 * 1000,
  );
  if (rateLimited) {
    return rateLimited;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const parsed = await parseRequestJson<MarkUnavailableBody>(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const videoId = parsed.data.videoId?.trim();

  if (!videoId) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  const reason = parsed.data.reason?.trim() ?? "runtime-player-error";
  const adminReporter = optionalAuth ? isAdminIdentity(optionalAuth.userId, optionalAuth.email) : false;
  const forcePruneCandidate = adminReporter && shouldForcePruneFromRuntimeReason(reason);

  debugUnavailable("incoming-report", {
    videoId,
    reason,
    forcePruneCandidate,
  });

  const videos = await prisma.video.findMany({
    where: { videoId },
    select: { id: true, title: true },
  });

  if (videos.length === 0) {
    debugUnavailable("unknown-video-id", { videoId });
    return NextResponse.json({ ok: true, skipped: true, reason: "unknown-video-id", classification: "unknown-check-failed" }, { status: 202 });
  }

  const verification = await verifyYouTubeAvailability(videoId);
  debugUnavailable("verification-result", {
    videoId,
    verificationStatus: verification.status,
    verificationReason: verification.reason,
    matchedVideoRows: videos.length,
  });
  const ids = videos.map((v) => v.id);
  const videoTitle = videos[0]?.title ?? "Unknown";
  const forcePrune = forcePruneCandidate && verification.status === "unavailable";

  if (forcePrune) {
    debugUnavailable("force-prune-from-runtime-reason", {
      videoId,
      reason,
      verificationReason: verification.reason,
      matchedVideoRows: videos.length,
    });

    const pruneResult = await pruneVideoAndAssociationsByVideoId(
      videoId,
      `runtime-force-prune:${reason}|${verification.reason}`,
    ).catch(() => ({ pruned: false, deletedVideoRows: 0, reason: "prune-failed" }));

    return NextResponse.json({
      ok: true,
      pruned: pruneResult.pruned,
      deletedVideoRows: pruneResult.deletedVideoRows,
      reason: verification.reason,
      classification: verification.classification,
    });
  }

  if (verification.status !== "unavailable") {
    const siteVideoStatus = verification.status === "check-failed" ? "check-failed" : "available";

    await prisma.siteVideo.updateMany({
      where: { videoId: { in: ids } },
      data: {
        status: siteVideoStatus,
        title: truncate(`${videoTitle} [runtime-report-ignored:${reason}|${verification.reason}]`, 255),
      },
    });

    const existing = await prisma.siteVideo.findMany({
      where: { videoId: { in: ids } },
      select: { videoId: true },
    });
    const existingIds = new Set(existing.map((row) => row.videoId));
    const missingIds = ids.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      const titleById = new Map(videos.map((video) => [video.id, video.title]));

      await prisma.siteVideo.createMany({
        data: missingIds.map((id) => ({
          videoId: id,
          title: truncate(
            `${titleById.get(id) ?? "Unknown"} [runtime-report-ignored:${reason}|${verification.reason}]`,
            255,
          ),
          status: siteVideoStatus,
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: verification.reason,
      classification: verification.classification,
    }, { status: 202 });
  }

  debugUnavailable("marking-unavailable", {
    videoId,
    reason,
    verificationReason: verification.reason,
    targetRows: ids.length,
  });

  const replacementResult = await findAndReplaceUnavailableVideo(videoId).catch(() => ({
    replaced: false as const,
    reason: "replacement-failed",
  }));

  if (replacementResult.replaced && replacementResult.newVideoId) {
    debugUnavailable("replaced-unavailable-video", {
      videoId,
      replacementVideoId: replacementResult.newVideoId,
      verificationReason: verification.reason,
    });

    return NextResponse.json({
      ok: true,
      replaced: true,
      newVideoId: replacementResult.newVideoId,
      reason: verification.reason,
      classification: verification.classification,
    });
  }

  const pruneResult = await pruneVideoAndAssociationsByVideoId(
    videoId,
    `runtime-unavailable:${reason}|${verification.reason}`,
  ).catch(() => ({ pruned: false, deletedVideoRows: 0, reason: "prune-failed" }));

  return NextResponse.json({
    ok: true,
    replaced: false,
    pruned: pruneResult.pruned,
    deletedVideoRows: pruneResult.deletedVideoRows,
    reason: verification.reason,
    classification: verification.classification,
  });
}

import { NextRequest, NextResponse } from "next/server";

import { isAdminIdentity } from "@/lib/admin-auth";
import { getOptionalApiAuth } from "@/lib/auth-request";
import { prisma } from "@/lib/db";
import { pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { isObviousCrawlerRequest } from "@/lib/crawler-guard";
import { verifySameOrigin } from "@/lib/csrf";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { parseRequestJson } from "@/lib/request-json";

type MarkUnavailableBody = {
  videoId?: string;
  reason?: string;
};

type AvailabilityCheckResult = {
  status: "available" | "unavailable" | "check-failed";
  reason: string;
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
  return { status, reason };
}

function isUnavailablePlayabilityReason(reason: string | null | undefined) {
  return typeof reason === "string"
    && /(video unavailable|private video|deleted|removed|copyright|terminated|not available|this video is unavailable)/i.test(reason);
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
      return { status: "unavailable", reason: `oembed:${oembedResponse.status}` };
    }

    if ([401, 403].includes(oembedResponse.status)) {
      return { status: "check-failed", reason: `oembed:provider-blocked-${oembedResponse.status}` };
    }

    if (oembedResponse.ok) {
      const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1`;
      const embedResponse = await fetchWithTimeout(embedUrl, {
        headers: {
          "User-Agent": "YehThatRocks/1.0",
        },
      }, EMBED_VERIFY_TIMEOUT_MS);

      if ([404, 410].includes(embedResponse.status)) {
        return { status: "unavailable", reason: `embed:${embedResponse.status}` };
      }

      if ([401, 403].includes(embedResponse.status)) {
        return { status: "check-failed", reason: `embed:provider-blocked-${embedResponse.status}` };
      }

      if (embedResponse.ok) {
        const html = await embedResponse.text();
        const playability = extractPlayabilityStatus(html);

        if (containsBotChallengeMarker(html)) {
          return { status: "check-failed", reason: "embed:bot-check" };
        }

        if (containsAgeRestrictionMarker(html)) {
          return { status: "unavailable", reason: "embed:age-restricted" };
        }

        if (playability?.status === "LOGIN_REQUIRED" || playability?.status === "CONTENT_CHECK_REQUIRED") {
          if (isUnavailablePlayabilityReason(playability.reason)) {
            return { status: "unavailable", reason: "embed:playability-login-unavailable" };
          }

          return { status: "check-failed", reason: "embed:interactive-login-check" };
        }

        if (playability && /^(ERROR|UNPLAYABLE|AGE_CHECK_REQUIRED)$/i.test(playability.status)) {
          return { status: "unavailable", reason: "embed:playability-unavailable" };
        }

        if (/video unavailable/i.test(html)) {
          return { status: "unavailable", reason: "embed:video-unavailable" };
        }

        return { status: "available", reason: "embed:accessible-no-markers" };
      }
    }

    return { status: "check-failed", reason: `oembed:${oembedResponse.status}` };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        status: "check-failed",
        reason: "verify-timeout",
      };
    }

    return {
      status: "check-failed",
      reason: `verify-network:${error instanceof Error ? error.message : "unknown"}`,
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
    return NextResponse.json({ ok: true, skipped: true, reason: "unknown-video-id" }, { status: 202 });
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

    return NextResponse.json({ ok: true, pruned: pruneResult.pruned, deletedVideoRows: pruneResult.deletedVideoRows });
  }

  if (verification.status !== "unavailable") {
    await prisma.siteVideo.updateMany({
      where: { videoId: { in: ids } },
      data: {
        status: verification.reason.includes("provider-blocked") ? "check-failed" : "available",
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
          status: verification.reason.includes("provider-blocked") ? "check-failed" : "available",
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({ ok: true, skipped: true, reason: verification.reason }, { status: 202 });
  }

  debugUnavailable("marking-unavailable", {
    videoId,
    reason,
    verificationReason: verification.reason,
    targetRows: ids.length,
  });

  const pruneResult = await pruneVideoAndAssociationsByVideoId(
    videoId,
    `runtime-unavailable:${reason}|${verification.reason}`,
  ).catch(() => ({ pruned: false, deletedVideoRows: 0, reason: "prune-failed" }));

  return NextResponse.json({ ok: true, pruned: pruneResult.pruned, deletedVideoRows: pruneResult.deletedVideoRows });
}

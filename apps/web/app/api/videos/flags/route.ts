import { NextRequest, NextResponse } from "next/server";

import { videoQualityFlagSchema } from "@/lib/api-schemas";
import { isAdminIdentity } from "@/lib/admin-auth";
import { requireApiAuth } from "@/lib/auth-request";
import { hideVideoAndPrunePlaylistsForUser, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";
import {
  VIDEO_QUALITY_FLAG_MIN_CONFIDENCE,
  VIDEO_QUALITY_FLAG_MIN_USERS_FOR_ACTION,
  VIDEO_QUALITY_FLAG_REASON_LABELS,
} from "@/lib/video-quality-flags";

async function ensureVideoQualityFlagsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS video_quality_flags (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      video_id VARCHAR(32) NOT NULL,
      reason VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_video_quality_flags_user_video_reason (user_id, video_id, reason),
      KEY idx_video_quality_flags_video_reason (video_id, reason),
      KEY idx_video_quality_flags_video (video_id)
    )
  `);
}

async function getFlagStats(videoId: string, reason: string) {
  const [sameReasonRows, totalRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM video_quality_flags
      WHERE video_id = ${videoId}
        AND reason = ${reason}
    `,
    prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM video_quality_flags
      WHERE video_id = ${videoId}
    `,
  ]);

  const sameReasonCountValue = sameReasonRows[0]?.count;
  const totalCountValue = totalRows[0]?.count;
  const sameReasonUsers = Number(typeof sameReasonCountValue === "bigint" ? sameReasonCountValue : Number(sameReasonCountValue ?? 0));
  const totalUsers = Number(typeof totalCountValue === "bigint" ? totalCountValue : Number(totalCountValue ?? 0));
  const confidence = totalUsers > 0 ? sameReasonUsers / totalUsers : 0;

  return {
    sameReasonUsers,
    totalUsers,
    confidence,
  };
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const bodyResult = await parseRequestJson(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = videoQualityFlagSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { videoId, reason } = parsed.data;
  const adminFlagger = isAdminIdentity(authResult.auth.userId, authResult.auth.email);

  try {
    await ensureVideoQualityFlagsTable();

    await prisma.$executeRaw`
      INSERT IGNORE INTO video_quality_flags (user_id, video_id, reason)
      VALUES (${authResult.auth.userId}, ${videoId}, ${reason})
    `;

    let excludedForUser = false;
    if (!adminFlagger) {
      const hideResult = await hideVideoAndPrunePlaylistsForUser({
        userId: authResult.auth.userId,
        videoId,
      });
      excludedForUser = hideResult.ok;
    }

    const stats = await getFlagStats(videoId, reason);

    const confidenceReached =
      stats.sameReasonUsers >= VIDEO_QUALITY_FLAG_MIN_USERS_FOR_ACTION
      && stats.confidence >= VIDEO_QUALITY_FLAG_MIN_CONFIDENCE;
    const shouldActGlobally = adminFlagger || confidenceReached;

    let actedGlobally = false;
    if (shouldActGlobally) {
      const pruneResult = await pruneVideoAndAssociationsByVideoId(
        videoId,
        adminFlagger
          ? `quality-flag-admin:${reason}`
          : `quality-flag-consensus:${reason}:${stats.sameReasonUsers}/${stats.totalUsers}`,
      ).catch(() => ({ pruned: false }));

      actedGlobally = Boolean(pruneResult.pruned);
    }

    return NextResponse.json({
      ok: true,
      reason,
      reasonLabel: VIDEO_QUALITY_FLAG_REASON_LABELS[reason],
      excludedForUser,
      actedGlobally,
      confidence: stats.confidence,
      sameReasonUsers: stats.sameReasonUsers,
      totalUsers: stats.totalUsers,
      adminFlagger,
      confidenceThreshold: VIDEO_QUALITY_FLAG_MIN_CONFIDENCE,
      minimumUsersThreshold: VIDEO_QUALITY_FLAG_MIN_USERS_FOR_ACTION,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to flag video" }, { status: 503 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

async function ensureMagazineCommentsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS magazine_article_comments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      article_slug VARCHAR(255) NOT NULL,
      user_id INT NOT NULL,
      content TEXT NOT NULL,
      moderation_status VARCHAR(32) NOT NULL DEFAULT 'public',
      moderation_label VARCHAR(80) NULL,
      moderation_reason VARCHAR(500) NULL,
      moderation_source VARCHAR(16) NULL,
      reviewed_by_user_id INT NULL,
      reviewed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_mag_comments_article_status_created (article_slug, moderation_status, created_at),
      KEY idx_mag_comments_user_created (user_id, created_at),
      KEY idx_mag_comments_moderation_queue (moderation_status, created_at),
      CONSTRAINT fk_mag_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_mag_comments_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const status = (request.nextUrl.searchParams.get("status") || "pending_review").trim();
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") || "100");
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100));

  await ensureMagazineCommentsTable();

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: bigint | number;
    articleSlug: string;
    userId: number;
    content: string;
    moderationStatus: string;
    moderationLabel: string | null;
    moderationReason: string | null;
    moderationSource: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
    screenName: string | null;
    email: string | null;
  }>>(
    `
      SELECT
        c.id AS id,
        c.article_slug AS articleSlug,
        c.user_id AS userId,
        c.content AS content,
        c.moderation_status AS moderationStatus,
        c.moderation_label AS moderationLabel,
        c.moderation_reason AS moderationReason,
        c.moderation_source AS moderationSource,
        c.created_at AS createdAt,
        c.reviewed_at AS reviewedAt,
        u.screen_name AS screenName,
        u.email AS email
      FROM magazine_article_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.moderation_status = ?
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT ?
    `,
    status,
    limit,
  );

  return NextResponse.json({
    ok: true,
    queue: rows.map((row) => ({
      id: Number(row.id),
      articleSlug: row.articleSlug,
      userId: row.userId,
      content: row.content,
      moderationStatus: row.moderationStatus,
      moderationLabel: row.moderationLabel,
      moderationReason: row.moderationReason,
      moderationSource: row.moderationSource,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      reviewedAt: row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : null,
      authorDisplayName: row.screenName || `User ${row.userId}`,
      authorEmail: row.email,
    })),
  });
}

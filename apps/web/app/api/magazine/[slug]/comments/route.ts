import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { classifyMagazineComment } from "@/lib/magazine-comment-moderation";
import { requireApiAuth } from "@/lib/auth-request";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";
import { prisma } from "@/lib/db";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

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

export async function GET(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;

  await ensureMagazineCommentsTable();

  const optionalAuth = await requireApiAuth(request).catch(() => null);
  const currentUserId = optionalAuth && optionalAuth.ok ? optionalAuth.auth.userId : null;

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: bigint | number;
    articleSlug: string;
    userId: number;
    content: string;
    moderationStatus: string;
    moderationLabel: string | null;
    moderationReason: string | null;
    createdAt: Date;
    screenName: string | null;
    avatarUrl: string | null;
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
        c.created_at AS createdAt,
        u.screen_name AS screenName,
        u.avatar_url AS avatarUrl
      FROM magazine_article_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.article_slug = ?
        AND (
          c.moderation_status = 'public'
          OR (? IS NOT NULL AND c.user_id = ?)
        )
      ORDER BY c.created_at ASC, c.id ASC
    `,
    slug,
    currentUserId,
    currentUserId,
  );

  return NextResponse.json({
    ok: true,
    comments: rows.map((row) => ({
      id: Number(row.id),
      articleSlug: row.articleSlug,
      userId: row.userId,
      content: row.content,
      moderationStatus: row.moderationStatus,
      moderationLabel: row.moderationLabel,
      moderationReason: row.moderationReason,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      authorDisplayName: row.screenName || `User ${row.userId}`,
      authorScreenName: row.screenName,
      authorAvatarUrl: row.avatarUrl,
      isOwnComment: currentUserId !== null && row.userId === currentUserId,
    })),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;

  const auth = await requireApiAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  const body = await parseRequestJson<{ content: string }>(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = createCommentSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await ensureMagazineCommentsTable();

  const articleExists = await prisma.magazineArticle.findFirst({
    where: { slug, status: "published" },
    select: { id: true },
  });

  if (!articleExists) {
    return NextResponse.json({ ok: false, error: "Article not found." }, { status: 404 });
  }

  const moderation = await classifyMagazineComment(parsed.data.content);
  const moderationStatus = moderation.shouldReview ? "pending_review" : "public";

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO magazine_article_comments (
        article_slug,
        user_id,
        content,
        moderation_status,
        moderation_label,
        moderation_reason,
        moderation_source,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `,
    slug,
    auth.auth.userId,
    parsed.data.content,
    moderationStatus,
    moderation.label,
    moderation.reason,
    moderation.source,
  );

  const idResult = await prisma.$queryRawUnsafe<Array<{ id: bigint | number; createdAt: Date }>>(
    `
      SELECT id, created_at AS createdAt
      FROM magazine_article_comments
      WHERE article_slug = ? AND user_id = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    slug,
    auth.auth.userId,
  );

  const saved = idResult[0];

  return NextResponse.json({
    ok: true,
    comment: {
      id: saved ? Number(saved.id) : 0,
      articleSlug: slug,
      userId: auth.auth.userId,
      content: parsed.data.content,
      moderationStatus,
      moderationLabel: moderation.label,
      moderationReason: moderation.reason,
      createdAt: saved?.createdAt instanceof Date ? saved.createdAt.toISOString() : new Date().toISOString(),
      isOwnComment: true,
    },
    submissionState: moderation.shouldReview ? "review" : "published",
    message: moderation.shouldReview
      ? "Comment submitted for review."
      : "Comment published.",
  });
}

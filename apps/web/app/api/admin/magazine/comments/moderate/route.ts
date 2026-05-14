import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";
import { verifySameOrigin } from "@/lib/csrf";

const moderateSchema = z.object({
  commentId: z.number().int().positive(),
  action: z.enum(["approve", "keep_restricted", "delete_comment", "delete_user"]),
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

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  const body = await parseRequestJson<z.infer<typeof moderateSchema>>(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = moderateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await ensureMagazineCommentsTable();

  const [comment] = await prisma.$queryRawUnsafe<Array<{ id: bigint | number; userId: number }>>(
    `
      SELECT id, user_id AS userId
      FROM magazine_article_comments
      WHERE id = ?
      LIMIT 1
    `,
    parsed.data.commentId,
  );

  if (!comment) {
    return NextResponse.json({ ok: false, error: "Comment not found." }, { status: 404 });
  }

  const adminUserId = auth.auth.userId;

  if (parsed.data.action === "approve") {
    await prisma.$executeRawUnsafe(
      `
        UPDATE magazine_article_comments
        SET moderation_status = 'public',
            reviewed_by_user_id = ?,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `,
      adminUserId,
      parsed.data.commentId,
    );

    return NextResponse.json({ ok: true, action: "approve", commentId: parsed.data.commentId });
  }

  if (parsed.data.action === "keep_restricted") {
    await prisma.$executeRawUnsafe(
      `
        UPDATE magazine_article_comments
        SET moderation_status = 'restricted',
            reviewed_by_user_id = ?,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `,
      adminUserId,
      parsed.data.commentId,
    );

    return NextResponse.json({ ok: true, action: "keep_restricted", commentId: parsed.data.commentId });
  }

  if (parsed.data.action === "delete_comment") {
    await prisma.$executeRawUnsafe(
      `
        DELETE FROM magazine_article_comments
        WHERE id = ?
      `,
      parsed.data.commentId,
    );

    return NextResponse.json({ ok: true, action: "delete_comment", commentId: parsed.data.commentId });
  }

  // delete_user: remove account and all dependent auth/session/comment data.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `
        DELETE pi
        FROM playlistitems pi
        INNER JOIN playlistnames pn ON pn.id = pi.playlist_id
        WHERE pn.user_id = ?
      `,
      comment.userId,
    );
    await tx.$executeRawUnsafe(`DELETE FROM playlistnames WHERE user_id = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM messages WHERE user_id = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM watch_history WHERE user_id = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM hidden_videos WHERE user_id = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM favourites WHERE userid = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM online WHERE user_id = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM magazine_article_comments WHERE user_id = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM auth_sessions WHERE user_id = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM auth_audit_logs WHERE user_id = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM email_verification_tokens WHERE user_id = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM password_reset_tokens WHERE user_id = ?`, comment.userId);
    await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = ?`, comment.userId);
  });

  return NextResponse.json({
    ok: true,
    action: "delete_user",
    commentId: parsed.data.commentId,
    userId: comment.userId,
  });
}

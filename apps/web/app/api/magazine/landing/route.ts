import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";
import { isBotUserAgent } from "@/lib/bot-detection";
import { isBotRequest } from "@/lib/crawler-guard";

const landingSchema = z.object({
  slug: z.string().trim().min(1).max(255),
  referrer: z.string().trim().max(2048).optional().nullable(),
  visitorId: z.string().uuid().optional().nullable(),
  sessionId: z.string().uuid().optional().nullable(),
});

async function ensureLandingTableExists() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS magazine_article_external_landings (
      id BIGINT NOT NULL AUTO_INCREMENT,
      article_slug VARCHAR(255) NOT NULL,
      referrer_host VARCHAR(255) NULL,
      visitor_id VARCHAR(64) NULL,
      session_id VARCHAR(64) NULL,
      landed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_mag_article_external_landings_landed_at (landed_at),
      KEY idx_mag_article_external_landings_slug_landed_at (article_slug, landed_at),
      KEY idx_mag_article_external_landings_session_landed (session_id, landed_at)
    )
  `);
}

async function ensureLandingColumnsExist() {
  const columns: Array<[string, string]> = [
    ["visitor_id", "VARCHAR(64) NULL"],
    ["session_id", "VARCHAR(64) NULL"],
  ];

  for (const [columnName, definitionSql] of columns) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(`
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'magazine_article_external_landings'
        AND column_name = '${columnName}'
    `);

    if (Number(rows[0]?.count ?? 0) === 0) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE magazine_article_external_landings
        ADD COLUMN ${columnName} ${definitionSql}
      `);
    }
  }
}

function toReferrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) {
    return null;
  }

  try {
    return new URL(referrer).host || null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const csrfError = verifySameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  // Reject bots and crawlers — they execute JavaScript but are not real
  // visitors, and recording them would inflate the magazine-landing metric.
  // Combine the UA-only spoof detector with the broader crawler + Cloudflare
  // detector used by the analytics endpoint.
  if (isBotRequest(request) || isBotUserAgent(request.headers.get("user-agent"))) {
    return NextResponse.json({ ok: true, skipped: "bot" });
  }

  const bodyResult = await parseRequestJson<unknown>(request);
  if (!bodyResult.ok) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = landingSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { slug, referrer, visitorId, sessionId } = parsed.data;
  const referrerHost = toReferrerHost(referrer);

  await ensureLandingTableExists().catch(() => undefined);
  await ensureLandingColumnsExist().catch(() => undefined);

  await prisma.$executeRaw`
    INSERT INTO magazine_article_external_landings (
      article_slug,
      referrer_host,
      visitor_id,
      session_id,
      landed_at
    )
    VALUES (
      ${slug},
      ${referrerHost},
      ${visitorId ?? null},
      ${sessionId ?? null},
      UTC_TIMESTAMP(3)
    )
  `.catch(() => null);

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";

const landingSchema = z.object({
  slug: z.string().trim().min(1).max(255),
  referrer: z.string().trim().max(2048).optional().nullable(),
});

async function ensureLandingTableExists() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS magazine_article_external_landings (
      id BIGINT NOT NULL AUTO_INCREMENT,
      article_slug VARCHAR(255) NOT NULL,
      referrer_host VARCHAR(255) NULL,
      landed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_mag_article_external_landings_landed_at (landed_at),
      KEY idx_mag_article_external_landings_slug_landed_at (article_slug, landed_at)
    )
  `);
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

  const bodyResult = await parseRequestJson<unknown>(request);
  if (!bodyResult.ok) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = landingSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { slug, referrer } = parsed.data;
  const referrerHost = toReferrerHost(referrer);

  await ensureLandingTableExists().catch(() => undefined);

  await prisma.$executeRaw`
    INSERT INTO magazine_article_external_landings (
      article_slug,
      referrer_host,
      landed_at
    )
    VALUES (
      ${slug},
      ${referrerHost},
      UTC_TIMESTAMP(3)
    )
  `.catch(() => null);

  return NextResponse.json({ ok: true });
}

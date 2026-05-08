import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";

type MagazineDeleteRouteContext = {
  params: Promise<{ slug: string }>;
};

export async function DELETE(request: NextRequest, context: MagazineDeleteRouteContext) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { slug } = await context.params;
  const normalizedSlug = slug.trim();

  if (!normalizedSlug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const deleted = await prisma.magazineArticle.deleteMany({
    where: { slug: normalizedSlug },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ ok: false, error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: deleted.count, slug: normalizedSlug });
}

import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { requireAuthOnly } from "@/lib/api-route-pipeline";
import { verifySameOrigin } from "@/lib/csrf";

const SITEMAP_PATHS = [
  "/sitemap/0.xml",
  "/sitemap/1.xml",
  "/sitemap/2.xml",
  "/sitemap/3.xml",
  "/sitemap/4.xml",
  "/robots.txt",
] as const;

export async function POST(request: NextRequest) {
  const auth = await requireAuthOnly(request);
  if (!auth.ok) {
    return auth.response;
  }

  const csrfError = verifySameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  for (const path of SITEMAP_PATHS) {
    revalidatePath(path);
  }

  return NextResponse.json({
    ok: true,
    revalidated: [...SITEMAP_PATHS],
    at: new Date().toISOString(),
  });
}
import { NextRequest, NextResponse } from "next/server";

/**
 * Minimal proxy middleware: injects x-ytr-pathname and x-ytr-search headers
 * so the shell layout can resolve the requested video server-side for shared
 * links and magazine article pages, eliminating the flash-of-wrong-video.
 *
 * The previous proxy handled auth, mobile redirects, silent refresh, and
 * security headers. Auth is now handled by api-route-pipeline.ts per-route.
 * Mobile redirects and silent refresh were removed as unused.
 */
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-ytr-pathname", request.nextUrl.pathname);
  requestHeaders.set("x-ytr-search", request.nextUrl.search);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

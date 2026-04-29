import { NextRequest, NextResponse } from "next/server";

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function sameOriginOrLoopbackEquivalent(a: URL, b: URL) {
  if (a.origin === b.origin) {
    return true;
  }

  const sameProtocol = a.protocol === b.protocol;
  const samePort = a.port === b.port;
  const bothLoopback = isLoopbackHost(a.hostname) && isLoopbackHost(b.hostname);

  return sameProtocol && samePort && bothLoopback;
}

function buildAllowedOrigins(request: NextRequest) {
  const allowed = new Set<string>([request.nextUrl.origin]);

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (forwardedHost) {
    const proto = forwardedProto || request.nextUrl.protocol.replace(":", "");
    allowed.add(`${proto}://${forwardedHost}`);
  }

  const host = request.headers.get("host")?.trim();

  if (host) {
    const proto = (forwardedProto || request.nextUrl.protocol.replace(":", "")).trim();
    allowed.add(`${proto}://${host}`);
  }

  return [...allowed]
    .map((value) => {
      try {
        return new URL(value);
      } catch {
        return null;
      }
    })
    .filter((value): value is URL => value !== null);
}

export function verifySameOrigin(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase();

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const origin = request.headers.get("origin")?.trim();
  const referer = request.headers.get("referer")?.trim();

  let sourceUrl: URL | null = null;

  if (origin) {
    try {
      sourceUrl = new URL(origin);
    } catch {
      return NextResponse.json({ error: "Invalid origin header" }, { status: 403 });
    }
  } else if (referer) {
    try {
      sourceUrl = new URL(referer);
    } catch {
      return NextResponse.json({ error: "Invalid referer header" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Missing origin and referer headers" }, { status: 403 });
  }

  const allowedOrigins = buildAllowedOrigins(request);

  if (process.env.NODE_ENV === "production") {
    const isStrictSameOrigin = allowedOrigins.some((candidate) => sourceUrl.origin === candidate.origin);

    if (!isStrictSameOrigin) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    return null;
  }

  const isAllowed = allowedOrigins.some((candidate) => sameOriginOrLoopbackEquivalent(sourceUrl, candidate));

  if (!isAllowed) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  return null;
}

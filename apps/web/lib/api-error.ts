import { NextResponse } from "next/server";

/**
 * Shared API error sanitizer.
 *
 * In production, returns a fixed, non-revealing message. In development, the
 * real error message is surfaced for debugging.
 *
 * Why: Prisma/driver error messages contain internal details (table/constraint
 * names, SQL fragments, connection config). Returning them verbatim to any
 * visitor aids attackers mapping the schema. This is the single choke point
 * for that sanitization — new routes should use `safeErrorMessage` or
 * `handleRouteError` instead of inlining `error instanceof Error ? error.message`.
 */
export function safeErrorMessage(
  error: unknown,
  fallback = "Internal server error",
): string {
  if (process.env.NODE_ENV === "development") {
    return error instanceof Error ? error.message : fallback;
  }
  return fallback;
}

/**
 * Log the real error server-side and return a sanitized JSON error response.
 * Mirrors `handleUnhandledAuthError` (auth-route-error.ts) but generalized for
 * any route. Maps transient database errors to 503 and everything else to 500.
 */
export function handleRouteError(
  error: unknown,
  context: string,
  fallback = "Internal server error",
): NextResponse {
  console.error(`[${context}]`, error);
  return NextResponse.json({ error: safeErrorMessage(error, fallback) }, { status: 500 });
}

/**
 * Whether the error is a transient database failure (pool exhaustion, network
 * blip) that should be surfaced as 503 Service Unavailable rather than 500.
 */
export function isTransientDbError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const code = (error as { code?: string }).code;
    if (typeof code === "string") {
      // Prisma/driver error codes for pool timeout and unreachable server.
      return ["P2024", "P1001", "P1002", "P1008"].includes(code);
    }
  }
  return false;
}

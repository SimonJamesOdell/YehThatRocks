import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { requireApiAuth } from "@/lib/auth-request";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const HTTP_FORBIDDEN = 403;

/**
 * Result of a successful auth + body parse pipeline.
 * Contains authenticated user info and validated request body.
 */
export type AuthAndBodyResult<T> = {
  ok: true;
  auth: { userId: number; email: string };
  data: T;
};

/**
 * Result of a failed auth + body parse pipeline.
 * Contains NextResponse to send to client.
 */
export type AuthAndBodyError = {
  ok: false;
  response: NextResponse;
};

/**
 * Discriminated union of auth + body parse result.
 */
export type AuthAndBodyOutcome<T> = AuthAndBodyResult<T> | AuthAndBodyError;

/**
 * Result of an auth-only pipeline (typically for GET requests).
 */
export type AuthOnlyResult = {
  ok: true;
  auth: { userId: number; email: string };
};

/**
 * Discriminated union of auth-only result.
 */
export type AuthOnlyOutcome = AuthOnlyResult | AuthAndBodyError;

export interface RouteAuthOptions {
  /**
   * Auth mode: "admin" for admin routes, "user" for regular authenticated user routes.
   * Defaults to "admin".
   */
  authMode?: "admin" | "user";
}

export type AuthAndCsrfOutcome = AuthOnlyResult | AuthAndBodyError;

type RouteAuthMode = NonNullable<RouteAuthOptions["authMode"]>;

async function resolveValidatedAuth(
  request: NextRequest,
  authMode: RouteAuthMode,
): Promise<AuthOnlyOutcome> {
  const authResult =
    authMode === "admin"
      ? await requireAdminApiAuth(request)
      : await requireApiAuth(request);

  if (!authResult.ok) {
    return { ok: false, response: authResult.response };
  }

  const userId = authResult.auth.userId;
  const email = authResult.auth.email ?? "";

  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: HTTP_FORBIDDEN }),
    };
  }

  return { ok: true, auth: { userId, email } };
}

/**
 * Pipelines: auth check → CSRF validation (for mutations) → JSON parse → schema validation.
 * Returns discriminated union of { ok: true, auth, data } or { ok: false, response }.
 *
 * This combines the repeated boilerplate pattern seen in most route handlers:
 * 1. requireAdminApiAuth or requireApiAuth
 * 2. verifySameOrigin for POST/PATCH/DELETE/PUT
 * 3. parseRequestJson
 * 4. schema.safeParse
 * 5. Return error responses at each step or proceed with data
 *
 * Usage in GET handler:
 *   const auth = await requireAuthOnly(request);
 *   if (!auth.ok) return auth.response;
 *   // proceed with query logic, use auth.auth
 *
 * Usage in PATCH/POST/DELETE handler:
 *   const result = await withAuthAndBody(request, mySchema);
 *   if (!result.ok) return result.response;
 *   // proceed with mutation logic, use result.auth and result.data
 */
export async function requireAuthOnly(
  request: NextRequest,
  options: RouteAuthOptions = {}
): Promise<AuthOnlyOutcome> {
  const { authMode = "admin" } = options;

  return resolveValidatedAuth(request, authMode);
}

/**
 * Pipelines: auth check → CSRF validation (auto-detected for mutations)
 * → JSON parse → schema validation.
 *
 * Automatically detects mutations based on request method (POST, PATCH, DELETE, PUT).
 * For GET/HEAD, skips CSRF check and body parse, returning early if schema validation fails.
 *
 * @param request NextRequest
 * @param bodySchema Zod schema for validating request body
 * @param options Auth mode and override options
 * @returns Discriminated union of { ok: true; auth; data } or { ok: false; response }
 */
export async function withAuthAndBody<T>(
  request: NextRequest,
  bodySchema: z.ZodType<T>,
  options: RouteAuthOptions = {}
): Promise<AuthAndBodyOutcome<T>> {
  const { authMode = "admin" } = options;

  // Step 1: Auth check
  const auth = await resolveValidatedAuth(request, authMode);
  if (!auth.ok) {
    return auth;
  }

  // Step 2: Detect if this is a mutation and check CSRF
  const isMutation = ["POST", "PATCH", "DELETE", "PUT"].includes(
    request.method.toUpperCase()
  );

  if (isMutation) {
    const csrfError = verifySameOrigin(request);
    if (csrfError) {
      return { ok: false, response: csrfError };
    }
  }

  // Step 3: Parse JSON body
  const bodyResult = await parseRequestJson<T>(request);
  if (!bodyResult.ok) {
    return { ok: false, response: bodyResult.response };
  }

  // Step 4: Validate against schema
  const validationResult = bodySchema.safeParse(bodyResult.data);
  if (!validationResult.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: validationResult.error.flatten() },
        { status: 400 }
      ),
    };
  }

  return {
    ok: true,
    auth: auth.auth,
    data: validationResult.data as T,
  };
}

/**
 * Pipelines: auth check -> CSRF validation.
 *
 * Use for mutation handlers that do not accept a JSON body.
 * Keeps no-body mutation routes aligned with the shared auth/csrf pipeline.
 */
export async function withAuthAndCsrf(
  request: NextRequest,
  options: RouteAuthOptions = {}
): Promise<AuthAndCsrfOutcome> {
  const auth = await requireAuthOnly(request, options);
  if (!auth.ok) {
    return auth;
  }

  const csrfError = verifySameOrigin(request);
  if (csrfError) {
    return { ok: false, response: csrfError };
  }

  return auth;
}

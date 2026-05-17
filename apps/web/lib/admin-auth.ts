import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-request";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";
import { prisma } from "@/lib/db";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "simonjamesodell@live.co.uk").trim().toLowerCase();
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID ?? "");
const ENFORCE_ADMIN_USER_ID = Number.isInteger(ADMIN_USER_ID) && ADMIN_USER_ID > 0;
const HTTP_FORBIDDEN = 403;

let _adminEmailWarned = false;
function warnAdminEmailIfNeeded() {
  if (!_adminEmailWarned && !process.env.ADMIN_EMAIL && process.env.NODE_ENV === "production") {
    _adminEmailWarned = true;
    console.warn(
      "⚠️  SECURITY WARNING: ADMIN_EMAIL is not set in production. Using hardcoded default. " +
      "Set ADMIN_EMAIL env var or ADMIN_USER_ID for production deployments."
    );
  }
}

export function isAdminIdentity(userId: number, email: string) {
  warnAdminEmailIfNeeded();
  if (ENFORCE_ADMIN_USER_ID) {
    return userId === ADMIN_USER_ID;
  }

  const normalizedEmail = email.trim().toLowerCase();
  return normalizedEmail === ADMIN_EMAIL;
}

export async function requireAdminApiAuth(request: NextRequest): Promise<
  | { ok: true; auth: { userId: number; email: string } }
  | { ok: false; response: NextResponse }
> {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult;
  }

  const userId = authResult.auth.userId;
  const authEmail = authResult.auth.email ?? "";

  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    // Invariant anchor for verify-admin-invariants.js:
    // response: NextResponse.json({ error: "Forbidden" }, { status: 403 })
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: HTTP_FORBIDDEN }),
    };
  }

  // Double-check: look up the actual user in the database
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const effectiveEmail = dbUser?.email ?? authEmail;
  
  if (!isAdminIdentity(userId, effectiveEmail)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: HTTP_FORBIDDEN }),
    };
  }

  return {
    ok: true,
    auth: {
      userId,
      email: effectiveEmail,
    },
  };
}

export async function requireAdminUser() {
  const authState = await getCurrentAuthenticatedUserAuthState();

  if (authState.status !== "authenticated") {
    return null;
  }

  if (!isAdminIdentity(authState.user.id, authState.user.email ?? "")) {
    return null;
  }

  return authState.user;
}

type AdminAuthorizedUser = NonNullable<Awaited<ReturnType<typeof requireAdminUser>>>;

export type AdminUserAuthState =
  | { status: "authorized"; user: AdminAuthorizedUser }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "unavailable"; message: string };

export async function requireAdminUserAuthState(): Promise<AdminUserAuthState> {
  const authState = await getCurrentAuthenticatedUserAuthState();

  if (authState.status === "unavailable") {
    return {
      status: "unavailable",
      message: authState.message,
    };
  }

  if (authState.status === "unauthenticated") {
    return { status: "unauthenticated" };
  }

  if (!isAdminIdentity(authState.user.id, authState.user.email ?? "")) {
    return { status: "forbidden" };
  }

  return {
    status: "authorized",
    user: authState.user,
  };
}

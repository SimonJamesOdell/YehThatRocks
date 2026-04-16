import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-request";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";
import { prisma } from "@/lib/db";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "simonjamesodell@live.co.uk").trim().toLowerCase();
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID ?? "");
const ENFORCE_ADMIN_USER_ID = Number.isInteger(ADMIN_USER_ID) && ADMIN_USER_ID > 0;

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

  // Double-check: look up the actual user in the database
  const dbUser = await prisma.user.findUnique({
    where: { id: authResult.auth.userId },
    select: { email: true },
  });

  const effectiveEmail = dbUser?.email ?? authResult.auth.email;
  
  if (!isAdminIdentity(authResult.auth.userId, effectiveEmail)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return authResult;
}

export async function requireAdminUser() {
  const user = await getCurrentAuthenticatedUser();

  if (!user || !isAdminIdentity(user.id, user.email ?? "")) {
    return null;
  }

  return user;
}

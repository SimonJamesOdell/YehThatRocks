import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-request";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";
import { prisma } from "@/lib/db";

export const ADMIN_PERMISSION_KEYS = [
  "admin.panel.view",
  "admin.permissions.manage",
  "admin.videos.pending.read",
  "admin.videos.pending.moderate",
  "admin.videos.catalog.read",
  "admin.videos.catalog.edit",
  "admin.videos.catalog.delete",
  "admin.videos.bypass_approval",
  "admin.forum.moderate",
] as const;

export type AdminPermissionKey = (typeof ADMIN_PERMISSION_KEYS)[number];

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "simonjamesodell@live.co.uk").trim().toLowerCase();
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID ?? "");
const ENFORCE_ADMIN_USER_ID = Number.isInteger(ADMIN_USER_ID) && ADMIN_USER_ID > 0;
const HTTP_FORBIDDEN = 403;

let hasEnsuredAdminPermissionsTable = false;
let ensureAdminPermissionsTablePromise: Promise<void> | null = null;

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

function isKnownAdminPermission(permission: string): permission is AdminPermissionKey {
  return ADMIN_PERMISSION_KEYS.includes(permission as AdminPermissionKey);
}

async function ensureAdminPermissionsTable() {
  if (hasEnsuredAdminPermissionsTable) {
    return;
  }

  if (ensureAdminPermissionsTablePromise) {
    return ensureAdminPermissionsTablePromise;
  }

  ensureAdminPermissionsTablePromise = prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_admin_permissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      permission VARCHAR(80) NOT NULL,
      granted_by INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_user_admin_permissions_user_permission (user_id, permission),
      KEY idx_user_admin_permissions_permission_user (permission, user_id),
      KEY idx_user_admin_permissions_user (user_id)
    )
  `)
    .then(() => {
      hasEnsuredAdminPermissionsTable = true;
    })
    .finally(() => {
      ensureAdminPermissionsTablePromise = null;
    });

  return ensureAdminPermissionsTablePromise;
}

export async function getUserAdminPermissions(userId: number): Promise<AdminPermissionKey[]> {
  if (!Number.isInteger(userId) || userId <= 0) {
    return [];
  }

  await ensureAdminPermissionsTable();

  const rows = await prisma.$queryRaw<Array<{ permission: string }>>`
    SELECT permission
    FROM user_admin_permissions
    WHERE user_id = ${userId}
  `;

  return rows
    .map((row) => row.permission.trim())
    .filter((permission): permission is AdminPermissionKey => isKnownAdminPermission(permission));
}

export async function hasAdminPermission(
  userId: number,
  email: string,
  permission: AdminPermissionKey,
): Promise<boolean> {
  if (isAdminIdentity(userId, email)) {
    return true;
  }

  await ensureAdminPermissionsTable();

  const rows = await prisma.$queryRaw<Array<{ marker: number }>>`
    SELECT 1 AS marker
    FROM user_admin_permissions
    WHERE user_id = ${userId}
      AND permission = ${permission}
    LIMIT 1
  `;

  return rows.length > 0;
}

export async function setUserAdminPermission(
  userId: number,
  permission: AdminPermissionKey,
  enabled: boolean,
  grantedByUserId?: number,
): Promise<void> {
  await ensureAdminPermissionsTable();

  if (enabled) {
    await prisma.$executeRaw`
      INSERT INTO user_admin_permissions (user_id, permission, granted_by)
      VALUES (${userId}, ${permission}, ${grantedByUserId ?? null})
      ON DUPLICATE KEY UPDATE
        granted_by = VALUES(granted_by),
        updated_at = CURRENT_TIMESTAMP(3)
    `;
    return;
  }

  await prisma.$executeRaw`
    DELETE FROM user_admin_permissions
    WHERE user_id = ${userId}
      AND permission = ${permission}
  `;
}

export async function requireAdminApiAuth(request: NextRequest): Promise<
  | { ok: true; auth: { userId: number; email: string } }
  | { ok: false; response: NextResponse }
> {
  return requireAdminApiAuthWithPermission(request, "admin.panel.view");
}

export async function requireAdminApiAuthWithPermission(
  request: NextRequest,
  permission: AdminPermissionKey,
): Promise<
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
  
  const allowed = await hasAdminPermission(userId, effectiveEmail, permission);

  if (!allowed) {
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

  const allowed = await hasAdminPermission(
    authState.user.id,
    authState.user.email ?? "",
    "admin.panel.view",
  );

  if (!allowed) {
    return { status: "forbidden" };
  }

  return {
    status: "authorized",
    user: authState.user,
  };
}

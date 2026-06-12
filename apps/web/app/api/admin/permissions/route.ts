import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ADMIN_PERMISSION_KEYS,
  getUserAdminPermissions,
  isAdminIdentity,
  requireAdminApiAuthWithPermission,
  setUserAdminPermission,
} from "@/lib/admin-auth";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";

const permissionUpdateSchema = z.object({
  userId: z.number().int().positive(),
  permission: z.enum(ADMIN_PERMISSION_KEYS),
  enabled: z.boolean(),
});

const userIdParamSchema = z.coerce.number().int().positive();

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuthWithPermission(request, "admin.permissions.manage");
  if (!auth.ok) {
    return auth.response;
  }

  if (!isAdminIdentity(auth.auth.userId, auth.auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userIdParam = request.nextUrl.searchParams.get("userId");
  const searchQuery = (request.nextUrl.searchParams.get("q") ?? "").trim();

  if (searchQuery.length > 0 || request.nextUrl.searchParams.has("q")) {
    const asNumericId = Number(searchQuery);
    const users = await prisma.user.findMany({
      where: {
        OR: [
          Number.isInteger(asNumericId) && asNumericId > 0
            ? { id: asNumericId }
            : undefined,
          { screenName: { contains: searchQuery } },
          { email: { contains: searchQuery } },
        ].filter(Boolean) as Array<Record<string, unknown>>,
      },
      select: {
        id: true,
        email: true,
        screenName: true,
      },
      orderBy: { id: "desc" },
      take: 30,
    });

    const usersWithPermissions = await Promise.all(users.map(async (user: { id: number; email: string | null; screenName: string | null }) => {
      const permissions = await getUserAdminPermissions(user.id);
      const superAdmin = isAdminIdentity(user.id, user.email ?? "");
      const hasAdminPanelAccess = superAdmin || permissions.includes("admin.panel.view");

      return {
        id: user.id,
        email: user.email,
        screenName: user.screenName,
        isSuperAdmin: superAdmin,
        permissions,
        hasAdminPanelAccess,
      };
    }));

    return NextResponse.json({
      ok: true,
      users: usersWithPermissions,
      availablePermissions: ADMIN_PERMISSION_KEYS,
    });
  }

  if (!userIdParam) {
    const recentUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        screenName: true,
      },
      orderBy: { id: "desc" },
      take: 25,
    });

    return NextResponse.json({
      ok: true,
      users: recentUsers.map((user: { id: number; email: string | null; screenName: string | null }) => ({
        id: user.id,
        email: user.email,
        screenName: user.screenName,
        isSuperAdmin: isAdminIdentity(user.id, user.email ?? ""),
        permissions: [] as string[],
        hasAdminPanelAccess: isAdminIdentity(user.id, user.email ?? ""),
      })),
      availablePermissions: ADMIN_PERMISSION_KEYS,
    });
  }

  const parsedUserId = userIdParamSchema.safeParse(userIdParam);
  if (!parsedUserId.success) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  const permissions = await getUserAdminPermissions(parsedUserId.data);
  const user = await prisma.user.findUnique({
    where: { id: parsedUserId.data },
    select: {
      id: true,
      email: true,
      screenName: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const superAdmin = isAdminIdentity(user.id, user.email ?? "");

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      screenName: user.screenName,
      isSuperAdmin: superAdmin,
    },
    userId: user.id,
    permissions,
    hasAdminPanelAccess: superAdmin || permissions.includes("admin.panel.view"),
    availablePermissions: ADMIN_PERMISSION_KEYS,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuthWithPermission(request, "admin.permissions.manage");
  if (!auth.ok) {
    return auth.response;
  }

  if (!isAdminIdentity(auth.auth.userId, auth.auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  const body = await request.json().catch(() => null);
  const parsed = permissionUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await setUserAdminPermission(
    parsed.data.userId,
    parsed.data.permission,
    parsed.data.enabled,
    auth.auth.userId,
  );

  const permissions = await getUserAdminPermissions(parsed.data.userId);
  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: {
      id: true,
      email: true,
      screenName: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const superAdmin = isAdminIdentity(user.id, user.email ?? "");

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      screenName: user.screenName,
      isSuperAdmin: superAdmin,
    },
    userId: user.id,
    permissions,
    hasAdminPanelAccess: superAdmin || permissions.includes("admin.panel.view"),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ADMIN_PERMISSION_KEYS,
  getUserAdminPermissions,
  requireAdminApiAuthWithPermission,
  setUserAdminPermission,
} from "@/lib/admin-auth";
import { verifySameOrigin } from "@/lib/csrf";

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

  const userIdParam = request.nextUrl.searchParams.get("userId");

  if (!userIdParam) {
    return NextResponse.json({
      ok: true,
      availablePermissions: ADMIN_PERMISSION_KEYS,
    });
  }

  const parsedUserId = userIdParamSchema.safeParse(userIdParam);
  if (!parsedUserId.success) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  const permissions = await getUserAdminPermissions(parsedUserId.data);

  return NextResponse.json({
    ok: true,
    userId: parsedUserId.data,
    permissions,
    availablePermissions: ADMIN_PERMISSION_KEYS,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuthWithPermission(request, "admin.permissions.manage");
  if (!auth.ok) {
    return auth.response;
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

  return NextResponse.json({
    ok: true,
    userId: parsed.data.userId,
    permissions,
  });
}

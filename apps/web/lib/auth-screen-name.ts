import { prisma } from "@/lib/db";

export const SCREEN_NAME_MIN_LENGTH = 2;
export const SCREEN_NAME_MAX_LENGTH = 40;

export function normalizeScreenName(value: string) {
  return value.trim();
}

export async function isScreenNameTaken(screenName: string, excludeUserId?: number) {
  const normalizedScreenName = normalizeScreenName(screenName);

  if (!normalizedScreenName) {
    return false;
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      screenName: normalizedScreenName,
      ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
    },
    select: { id: true },
  });

  return Boolean(existingUser);
}
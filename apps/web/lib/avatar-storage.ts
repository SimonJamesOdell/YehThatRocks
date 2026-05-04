import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const MANAGED_AVATAR_PREFIX = "/avatars/";
const MAX_AVATAR_UPLOAD_BYTES = 6 * 1024 * 1024;
const ALLOWED_AVATAR_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function resolveWebAppRoot() {
  const cwd = process.cwd();
  if (path.basename(cwd) === "web" && path.basename(path.dirname(cwd)) === "apps") {
    return cwd;
  }

  return path.join(cwd, "apps", "web");
}

function resolveAvatarDirectory() {
  // In production the container mounts a host volume at AVATAR_STORAGE_PATH.
  // nginx serves /avatars/ directly from that path, so the app only needs to
  // write there — no dependency on Next.js's public directory resolution.
  if (process.env.AVATAR_STORAGE_PATH) {
    return process.env.AVATAR_STORAGE_PATH;
  }

  return path.join(resolveWebAppRoot(), "public", "avatars");
}

function resolveManagedAvatarPath(avatarUrl: string) {
  const fileName = path.basename(avatarUrl);
  if (!fileName || fileName === "." || fileName === "..") {
    return null;
  }

  return path.join(resolveAvatarDirectory(), fileName);
}

export function validateAvatarUpload(file: File) {
  if (file.size <= 0) {
    return "Please choose an image file to upload.";
  }

  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    return "Please upload an image smaller than 6 MB.";
  }

  if (!ALLOWED_AVATAR_CONTENT_TYPES.has(file.type)) {
    return "Please upload a JPG, PNG, GIF, or WebP image.";
  }

  return null;
}

export function isManagedAvatarUrl(avatarUrl: string | null | undefined): avatarUrl is string {
  return typeof avatarUrl === "string" && avatarUrl.startsWith(MANAGED_AVATAR_PREFIX);
}

export async function deleteManagedAvatar(avatarUrl: string | null | undefined) {
  if (!isManagedAvatarUrl(avatarUrl)) {
    return;
  }

  const filePath = resolveManagedAvatarPath(avatarUrl);
  if (!filePath) {
    return;
  }

  try {
    await rm(filePath, { force: true });
  } catch {
    // Ignore cleanup failures so profile mutations still succeed.
  }
}

export async function storeOptimizedAvatar(file: File) {
  const validationError = validateAvatarUpload(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const optimizedBuffer = await sharp(fileBuffer)
    .rotate()
    .resize(256, 256, { fit: "cover", position: "centre" })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();

  const fileName = `${randomUUID()}.webp`;
  const avatarDirectory = resolveAvatarDirectory();
  await mkdir(avatarDirectory, { recursive: true });
  await writeFile(path.join(avatarDirectory, fileName), optimizedBuffer);

  return `${MANAGED_AVATAR_PREFIX}${fileName}`;
}
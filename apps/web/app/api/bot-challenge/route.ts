import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac } from "node:crypto";

export const dynamic = "force-dynamic";

const POW_SALT = "ytr-botok-v1:";
const POW_DIFFICULTY_BITS = 18;
const BOTOK_COOKIE = "ytr_botok";
const BOTOK_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Verify the client-side proof-of-work: sha256("ytr-botok-v1:" + nonce) must
 * have at least POW_DIFFICULTY_BITS leading zero bits. Exported for tests.
 */
export function meetsPowDifficulty(
  nonce: string,
  difficultyBits: number = POW_DIFFICULTY_BITS,
): boolean {
  if (!/^[0-9a-f]{1,128}$/i.test(nonce)) {
    return false;
  }

  const digest = createHash("sha256").update(POW_SALT + nonce).digest();
  const fullBytes = difficultyBits >> 3;
  const remBits = difficultyBits & 7;

  for (let i = 0; i < fullBytes; i += 1) {
    if (digest[i] !== 0) {
      return false;
    }
  }

  if (remBits > 0) {
    const mask = 0xff << (8 - remBits);
    if ((digest[fullBytes] & mask) !== 0) {
      return false;
    }
  }

  return true;
}

function signBotOkCookie(nonce: string): string {
  const secret = process.env.AUTH_JWT_SECRET ?? "ytr-botok-dev-secret";
  const payload = `${nonce}:${Math.floor(Date.now() / 1000)}`;
  const sig = createHmac("sha256", secret).update(`ytr-botok:${payload}`).digest("hex");
  return `${payload}:${sig}`;
}

export async function POST(request: NextRequest) {
  let body: { nonce?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";

  if (!meetsPowDifficulty(nonce)) {
    return NextResponse.json({ error: "invalid proof" }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(BOTOK_COOKIE, signBotOkCookie(nonce), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: BOTOK_MAX_AGE_SECONDS,
  });

  return response;
}

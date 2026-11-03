import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac } from "node:crypto";

import { recordPowSolved } from "@/lib/trust-reputation";

export const dynamic = "force-dynamic";

const POW_SALT = "ytr-botok-v1:";
const BOTOK_COOKIE = "ytr_botok";
const BOTOK_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

// Operator-tunable difficulty. Raising it during an active swarm costs bots
// exponentially more CPU — but NOTE: the silent background solver
// (BotChallengeSolver, mounted in the root layout) shares this exact
// difficulty and runs a *synchronous* JS hash loop on the main thread with a
// 2,000,000-attempt cap (see lib/pow-client.ts). At 24+ bits that cap yields
// only ~11% success, so normal browsers fail, never cache the solve, and
// re-run the expensive loop on EVERY page load — freezing the page for
// seconds each time.
//
// The default is therefore kept at 18 bits (~262K hashes ≈ half a second,
// solved once per week), which the client budget covers comfortably.
//
// To fight a JS-capable crawler swarm, prefer Cloudflare Under Attack Mode or
// the nginx walker challenge (which stops JS-less scrapers outright) over
// raising this knob past ~20. If you do raise it, move the silent solver off
// the main thread first.
export function powDifficultyBits(): number {
  const raw = Number(process.env.POW_DIFFICULTY_BITS ?? "18");
  if (!Number.isFinite(raw)) {
    return 18;
  }
  return Math.max(8, Math.min(40, Math.floor(raw)));
}

export const POW_DIFFICULTY_BITS = powDifficultyBits();

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

export async function GET() {
  // Lets the client learn the current difficulty before solving, so an
  // operator can raise it without a code deploy.
  return NextResponse.json({ difficulty: POW_DIFFICULTY_BITS });
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

  // Persist the solve as client evidence — it feeds the human-trust tier.
  recordPowSolved(request);

  const response = NextResponse.json({ ok: true });
  response.headers.set("X-Ytr-Volunteer", "thanks for donating CPU cycles to the anti-scraper fund");
  response.cookies.set(BOTOK_COOKIE, signBotOkCookie(nonce), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: BOTOK_MAX_AGE_SECONDS,
  });

  return response;
}

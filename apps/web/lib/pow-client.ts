import { sha256Hex } from "@/lib/sha256";

/**
 * Client-side proof-of-work solver shared by the silent background solver and
 * the visible human-verification interstitial.
 *
 * The server (/api/bot-challenge) controls the difficulty; this module fetches
 * it so an operator can raise it during an active swarm without a code deploy.
 */

export const POW_SALT = "ytr-botok-v1:";
export const DEFAULT_POW_DIFFICULTY_BITS = 24;

const SOLVED_AT_KEY = "ytr:botok:solved-at";
// Re-solve a little before the 7-day httpOnly cookie expires.
const SOLVE_TTL_MS = 6 * 24 * 60 * 60 * 1000;
// Sized for the 24-bit default: expected attempts ≈ 2^24 ≈ 16.7M, so a 60M
// cap yields ~97% solve success. At the old 18-bit default this cap was far
// larger than needed; it now matters only so a raised difficulty can't make
// real browsers loop forever.
const MAX_ATTEMPTS = 60_000_000;
// Hashes per event-loop yield. ~50k hashes is a few milliseconds on a modern
// core, so the page stays responsive while the silent solver runs instead of
// freezing the main thread for the whole ~30s solve.
const CHUNK_SIZE = 50_000;

// Leading zero bits contributed by the first non-zero hex nibble.
// Index = nibble value (1..15). Nibble 0 (value 4) is handled separately.
const LEADING_ZERO_BITS = [4, 3, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * True when sha256(POW_SALT + nonce) has at least `difficultyBits` leading zero
 * bits. Mirrors the server's meetsPowDifficulty check.
 */
export function meetsPowDifficulty(hexDigest: string, difficultyBits: number): boolean {
  // Fast path for the default 24-bit difficulty — first three bytes zero.
  if (difficultyBits === DEFAULT_POW_DIFFICULTY_BITS) {
    return hexDigest.startsWith("000000");
  }

  let leading = 0;
  for (let i = 0; i < hexDigest.length; i += 1) {
    const nibble = parseInt(hexDigest[i] ?? "0", 16);
    if (nibble === 0) {
      leading += 4;
      continue;
    }
    leading += LEADING_ZERO_BITS[nibble] ?? 0;
    break;
  }

  return leading >= difficultyBits;
}

/**
 * Solve the proof-of-work for `difficultyBits`, yielding to the event loop
 * every CHUNK_SIZE hashes so the main thread never freezes. Returns the nonce,
 * or "" when the attempt budget is exhausted.
 */
export async function solvePowNonce(
  difficultyBits: number = DEFAULT_POW_DIFFICULTY_BITS,
): Promise<string> {
  const prefix = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  let counter = 0;
  while (counter < MAX_ATTEMPTS) {
    const chunkEnd = Math.min(counter + CHUNK_SIZE, MAX_ATTEMPTS);
    for (; counter < chunkEnd; counter += 1) {
      const nonce = `${prefix}${counter.toString(16)}`;
      if (meetsPowDifficulty(sha256Hex(POW_SALT + nonce), difficultyBits)) {
        return nonce;
      }
    }
    // Yield to the event loop so a multi-second solve never blocks UI.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return "";
}

export function hasRecentlySolvedPow(): boolean {
  try {
    const lastSolved = Number(window.localStorage.getItem(SOLVED_AT_KEY));
    return Number.isFinite(lastSolved) && Date.now() - lastSolved < SOLVE_TTL_MS;
  } catch {
    return false;
  }
}

export function markPowSolved(): void {
  try {
    window.localStorage.setItem(SOLVED_AT_KEY, String(Date.now()));
  } catch {
    // localStorage unavailable — the cookie is still set server-side.
  }
}

export async function fetchPowDifficulty(): Promise<number> {
  try {
    const response = await fetch("/api/bot-challenge", {
      method: "GET",
      credentials: "same-origin",
    });

    if (response.ok) {
      const data = (await response.json()) as { difficulty?: number };
      if (typeof data.difficulty === "number" && data.difficulty >= 8 && data.difficulty <= 40) {
        return data.difficulty;
      }
    }
  } catch {
    // Fall through to the default difficulty.
  }

  return DEFAULT_POW_DIFFICULTY_BITS;
}

/** Solve and submit the proof-of-work, returning true when the cookie was set. */
export async function submitPowSolution(): Promise<boolean> {
  const difficulty = await fetchPowDifficulty();
  const nonce = await solvePowNonce(difficulty);
  if (!nonce) {
    return false;
  }

  try {
    const response = await fetch("/api/bot-challenge", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce }),
    });

    if (response.ok) {
      markPowSolved();
      return true;
    }
  } catch {
    // Transient — the caller can retry.
  }

  return false;
}

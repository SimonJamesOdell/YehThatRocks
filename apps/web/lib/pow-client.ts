import { sha256Hex } from "@/lib/sha256";

/**
 * Client-side proof-of-work solver shared by the silent background solver and
 * the visible human-verification interstitial.
 *
 * The server (/api/bot-challenge) controls the difficulty; this module fetches
 * it so an operator can raise it during an active swarm without a code deploy.
 */

export const POW_SALT = "ytr-botok-v1:";
export const DEFAULT_POW_DIFFICULTY_BITS = 18;

const SOLVED_AT_KEY = "ytr:botok:solved-at";
// Re-solve a little before the 7-day httpOnly cookie expires.
const SOLVE_TTL_MS = 6 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 2_000_000;

// Leading zero bits contributed by the first non-zero hex nibble.
// Index = nibble value (1..15). Nibble 0 (value 4) is handled separately.
const LEADING_ZERO_BITS = [4, 3, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * True when sha256(POW_SALT + nonce) has at least `difficultyBits` leading zero
 * bits. Mirrors the server's meetsPowDifficulty check.
 */
export function meetsPowDifficulty(hexDigest: string, difficultyBits: number): boolean {
  // Fast path for the default 18-bit difficulty — matches the server rule
  // "first two bytes zero, top two bits of the third byte zero".
  if (difficultyBits === DEFAULT_POW_DIFFICULTY_BITS) {
    return hexDigest.startsWith("0000") && "0123".includes(hexDigest[4] ?? "f");
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

export function solvePowNonce(difficultyBits: number = DEFAULT_POW_DIFFICULTY_BITS): string {
  const prefix = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  for (let counter = 0; counter < MAX_ATTEMPTS; counter += 1) {
    const nonce = `${prefix}${counter.toString(16)}`;
    if (meetsPowDifficulty(sha256Hex(POW_SALT + nonce), difficultyBits)) {
      return nonce;
    }
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
  const nonce = solvePowNonce(difficulty);
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

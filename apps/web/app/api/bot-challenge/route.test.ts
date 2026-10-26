import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { meetsPowDifficulty, POW_DIFFICULTY_BITS } from "./route";

const POW_SALT = "ytr-botok-v1:";

// Keep the test solve cheap: exercise the verifier at a modest difficulty
// instead of the (deliberately more expensive) production default.
const TEST_DIFFICULTY_BITS = 16;

function meets(digest: Buffer, difficultyBits: number): boolean {
  const fullBytes = difficultyBits >> 3;
  const remBits = difficultyBits & 7;
  for (let i = 0; i < fullBytes; i += 1) {
    if (digest[i] !== 0) return false;
  }
  if (remBits > 0) {
    const mask = 0xff << (8 - remBits);
    if ((digest[fullBytes] & mask) !== 0) return false;
  }
  return true;
}

function solveNonce(difficultyBits: number): string {
  let counter = 0;
  for (;;) {
    const nonce = counter.toString(16);
    if (meets(createHash("sha256").update(POW_SALT + nonce).digest(), difficultyBits)) {
      return nonce;
    }
    counter += 1;
  }
}

describe("bot-challenge proof-of-work", () => {
  it("keeps the production default within the sane clamp range", () => {
    expect(POW_DIFFICULTY_BITS).toBeGreaterThanOrEqual(8);
    expect(POW_DIFFICULTY_BITS).toBeLessThanOrEqual(40);
  });

  it("accepts a nonce that meets the difficulty", () => {
    const nonce = solveNonce(TEST_DIFFICULTY_BITS);
    expect(meetsPowDifficulty(nonce, TEST_DIFFICULTY_BITS)).toBe(true);
  });

  it("rejects an ordinary nonce", () => {
    expect(meetsPowDifficulty("abc123")).toBe(false);
  });

  it("rejects empty and malformed nonces", () => {
    expect(meetsPowDifficulty("")).toBe(false);
    expect(meetsPowDifficulty("not-hex!!")).toBe(false);
  });
});

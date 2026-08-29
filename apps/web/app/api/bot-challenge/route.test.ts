import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { meetsPowDifficulty } from "./route";

const POW_SALT = "ytr-botok-v1:";
const DIFFICULTY_BITS = 18;

function meets(digest: Buffer): boolean {
  const fullBytes = DIFFICULTY_BITS >> 3;
  const remBits = DIFFICULTY_BITS & 7;
  for (let i = 0; i < fullBytes; i += 1) {
    if (digest[i] !== 0) return false;
  }
  if (remBits > 0) {
    const mask = 0xff << (8 - remBits);
    if ((digest[fullBytes] & mask) !== 0) return false;
  }
  return true;
}

function solveNonce(): string {
  let counter = 0;
  for (;;) {
    const nonce = counter.toString(16);
    if (meets(createHash("sha256").update(POW_SALT + nonce).digest())) {
      return nonce;
    }
    counter += 1;
  }
}

describe("bot-challenge proof-of-work", () => {
  it("accepts a nonce that meets the difficulty", () => {
    const nonce = solveNonce();
    expect(meetsPowDifficulty(nonce)).toBe(true);
  });

  it("rejects an ordinary nonce", () => {
    expect(meetsPowDifficulty("abc123")).toBe(false);
  });

  it("rejects empty and malformed nonces", () => {
    expect(meetsPowDifficulty("")).toBe(false);
    expect(meetsPowDifficulty("not-hex!!")).toBe(false);
  });
});

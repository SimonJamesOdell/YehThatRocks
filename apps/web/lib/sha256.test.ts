import { describe, expect, it } from "vitest";

import { sha256Hex } from "@/lib/sha256";

describe("sha256Hex", () => {
  it("matches known SHA-256 vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("hello world")).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("is deterministic", () => {
    expect(sha256Hex("ytr-botok-v1:0001")).toBe(sha256Hex("ytr-botok-v1:0001"));
  });
});

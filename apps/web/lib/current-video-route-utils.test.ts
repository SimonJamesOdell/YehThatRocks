import { describe, expect, it } from "vitest";

import { shouldBypassCurrentVideoCooldown } from "./current-video-route-utils";

describe("shouldBypassCurrentVideoCooldown", () => {
  it("bypasses cooldown when no requests are inflight", () => {
    expect(
      shouldBypassCurrentVideoCooldown({
        blockedUntil: 2_000,
        inflightCount: 0,
        now: 1_000,
      }),
    ).toBe(true);
  });

  it("does not bypass cooldown while requests are still inflight", () => {
    expect(
      shouldBypassCurrentVideoCooldown({
        blockedUntil: 2_000,
        inflightCount: 3,
        now: 1_000,
      }),
    ).toBe(false);
  });

  it("does not bypass cooldown after the block has expired", () => {
    expect(
      shouldBypassCurrentVideoCooldown({
        blockedUntil: 1_000,
        inflightCount: 0,
        now: 2_000,
      }),
    ).toBe(false);
  });
});
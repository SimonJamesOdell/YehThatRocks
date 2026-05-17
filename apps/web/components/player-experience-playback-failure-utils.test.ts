import { describe, expect, it } from "vitest";

import {
  isInteractivePlaybackBlockReason,
  isUnavailableVerificationReason,
  resolveVerifiedPlaybackFailurePresentation,
} from "@/components/player-experience-playback-failure-utils";

describe("player-experience-playback-failure-utils", () => {
  it("detects interactive playback block reasons", () => {
    expect(isInteractivePlaybackBlockReason("bot-check: challenge")).toBe(true);
    expect(isInteractivePlaybackBlockReason("interactive-login-check")).toBe(true);
    expect(isInteractivePlaybackBlockReason("watch:404")).toBe(false);
    expect(isInteractivePlaybackBlockReason(null)).toBe(false);
  });

  it("detects unavailable verification reasons", () => {
    expect(isUnavailableVerificationReason("oembed:404")).toBe(true);
    expect(isUnavailableVerificationReason("embed:video-unavailable")).toBe(true);
    expect(isUnavailableVerificationReason("copyright-claim")).toBe(true);
    expect(isUnavailableVerificationReason("verify-network")).toBe(false);
  });

  it("returns direct iframe for interactive-block verification", () => {
    const result = resolveVerifiedPlaybackFailurePresentation({
      runtimeReason: "yt-player-error-2",
      reportResult: {
        shouldSkip: false,
        verificationReason: "interactive-login-check",
        classification: null,
        skipped: false,
      },
      unavailableMessage: "fallback message",
      unavailableCountdownMs: 5000,
    });

    expect(result).toEqual({ kind: "direct-iframe" });
  });

  it("returns connectivity unavailable presentation for network-latency signals", () => {
    const result = resolveVerifiedPlaybackFailurePresentation({
      runtimeReason: "yt-player-upstream-connect-timeout",
      reportResult: {
        shouldSkip: false,
        verificationReason: "verify-timeout",
        classification: "network-latency",
        skipped: false,
      },
      connectivityMessage: "connectivity issue",
      unavailableMessage: "fallback",
    });

    expect(result).toEqual({
      kind: "unavailable",
      message: "connectivity issue",
      requiresOk: true,
      autoAdvanceWhenAutoplay: false,
    });
  });

  it("returns unavailable auto-advance presentation for removed/private failures", () => {
    const result = resolveVerifiedPlaybackFailurePresentation({
      runtimeReason: "yt-player-error-2",
      reportResult: {
        shouldSkip: true,
        verificationReason: "embed:video-unavailable",
        classification: "removed-or-private",
        skipped: false,
      },
      removedOrPrivateMessage: "removed/private",
      unavailableMessage: "fallback",
      unavailableCountdownMs: 20000,
    });

    expect(result).toEqual({
      kind: "unavailable",
      message: "removed/private",
      countdownMs: 20000,
      autoAdvanceWhenAutoplay: true,
    });
  });
});
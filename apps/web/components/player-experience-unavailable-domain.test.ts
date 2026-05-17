import { describe, expect, it } from "vitest";

import { buildUnavailableOverlayFlags } from "@/components/player-experience-unavailable-domain";

describe("buildUnavailableOverlayFlags", () => {
  const upstreamConnectivityOverlayMessage = "connectivity";
  const brokenUpstreamOverlayMessage = "broken upstream";
  const copyrightClaimOverlayMessage = "copyright";
  const removedPrivateOverlayMessage = "removed/private";

  it("marks deleted overlay independently of playback overlays", () => {
    const flags = buildUnavailableOverlayFlags({
      unavailableOverlayKind: "deleted",
      unavailableOverlayMessage: null,
      unavailableAutoAdvanceMs: null,
      upstreamConnectivityOverlayMessage,
      brokenUpstreamOverlayMessage,
      copyrightClaimOverlayMessage,
      removedPrivateOverlayMessage,
    });

    expect(flags.isDeletedConfirmationOverlay).toBe(true);
    expect(flags.isUpstreamConnectivityOverlay).toBe(false);
    expect(flags.isAutoAdvanceUnavailableOverlay).toBe(false);
  });

  it("maps each playback message to the corresponding overlay flag", () => {
    const upstreamFlags = buildUnavailableOverlayFlags({
      unavailableOverlayKind: "playback",
      unavailableOverlayMessage: upstreamConnectivityOverlayMessage,
      unavailableAutoAdvanceMs: null,
      upstreamConnectivityOverlayMessage,
      brokenUpstreamOverlayMessage,
      copyrightClaimOverlayMessage,
      removedPrivateOverlayMessage,
    });

    const brokenFlags = buildUnavailableOverlayFlags({
      unavailableOverlayKind: "playback",
      unavailableOverlayMessage: brokenUpstreamOverlayMessage,
      unavailableAutoAdvanceMs: null,
      upstreamConnectivityOverlayMessage,
      brokenUpstreamOverlayMessage,
      copyrightClaimOverlayMessage,
      removedPrivateOverlayMessage,
    });

    const copyrightFlags = buildUnavailableOverlayFlags({
      unavailableOverlayKind: "playback",
      unavailableOverlayMessage: copyrightClaimOverlayMessage,
      unavailableAutoAdvanceMs: null,
      upstreamConnectivityOverlayMessage,
      brokenUpstreamOverlayMessage,
      copyrightClaimOverlayMessage,
      removedPrivateOverlayMessage,
    });

    const removedFlags = buildUnavailableOverlayFlags({
      unavailableOverlayKind: "playback",
      unavailableOverlayMessage: removedPrivateOverlayMessage,
      unavailableAutoAdvanceMs: 5000,
      upstreamConnectivityOverlayMessage,
      brokenUpstreamOverlayMessage,
      copyrightClaimOverlayMessage,
      removedPrivateOverlayMessage,
    });

    expect(upstreamFlags.isUpstreamConnectivityOverlay).toBe(true);
    expect(brokenFlags.isBrokenUpstreamOverlay).toBe(true);
    expect(copyrightFlags.isCopyrightClaimOverlay).toBe(true);
    expect(removedFlags.isRemovedOrPrivateOverlay).toBe(true);
    expect(removedFlags.isAutoAdvanceUnavailableOverlay).toBe(true);
  });
});
type UnavailableOverlayFlagOptions = {
  unavailableOverlayKind: "playback" | "deleted";
  unavailableOverlayMessage: string | null;
  unavailableAutoAdvanceMs: number | null;
  upstreamConnectivityOverlayMessage: string;
  brokenUpstreamOverlayMessage: string;
  copyrightClaimOverlayMessage: string;
  removedPrivateOverlayMessage: string;
};

export function buildUnavailableOverlayFlags(options: UnavailableOverlayFlagOptions) {
  return {
    isDeletedConfirmationOverlay: options.unavailableOverlayKind === "deleted",
    isUpstreamConnectivityOverlay: options.unavailableOverlayMessage === options.upstreamConnectivityOverlayMessage,
    isBrokenUpstreamOverlay: options.unavailableOverlayMessage === options.brokenUpstreamOverlayMessage,
    isCopyrightClaimOverlay: options.unavailableOverlayMessage === options.copyrightClaimOverlayMessage,
    isRemovedOrPrivateOverlay: options.unavailableOverlayMessage === options.removedPrivateOverlayMessage,
    isAutoAdvanceUnavailableOverlay: options.unavailableAutoAdvanceMs !== null,
  };
}

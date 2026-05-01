export type ReportUnavailableResult = {
  shouldSkip: boolean;
  verificationReason: string | null;
  classification: string | null;
  skipped: boolean;
};

export type VerifiedPlaybackFailurePresentation = {
  kind: "direct-iframe";
} | {
  kind: "unavailable";
  message?: string;
  countdownMs?: number;
  requiresOk?: boolean;
  autoAdvanceWhenAutoplay?: boolean;
};

export function isInteractivePlaybackBlockReason(reason: string | null | undefined) {
  return typeof reason === "string" && /(bot-check|interactive-login-check|login-required|content-check-required|consent|provider-blocked)/i.test(reason);
}

export function isUnavailableVerificationReason(reason: string | null | undefined) {
  return typeof reason === "string"
    && /(oembed:(404|410)|embed:(404|410)|watch:(404|410)|embed:age-restricted|embed:playability-unavailable|embed:video-unavailable|copyright-claim|removed-or-private|playability-unavailable)/i.test(reason);
}

function isNetworkLatencyReason(reason: string | null | undefined) {
  return typeof reason === "string" && /(verify-timeout|verify-network|network-latency|provider-blocked)/i.test(reason);
}

function isCopyrightReason(reason: string | null | undefined) {
  return typeof reason === "string" && /copyright-claim|copyright/i.test(reason);
}

function isRemovedOrPrivateReason(reason: string | null | undefined) {
  return typeof reason === "string" && /(removed-or-private|video-unavailable|private|deleted|removed)/i.test(reason);
}

export function resolveVerifiedPlaybackFailurePresentation(options: {
  runtimeReason: string;
  reportResult: ReportUnavailableResult;
  unavailableMessage?: string;
  unavailableCountdownMs?: number;
  connectivityMessage?: string;
  copyrightMessage?: string;
  removedOrPrivateMessage?: string;
}): VerifiedPlaybackFailurePresentation {
  const {
    runtimeReason,
    reportResult,
    unavailableMessage,
    unavailableCountdownMs,
    connectivityMessage,
    copyrightMessage,
    removedOrPrivateMessage,
  } = options;

  const combinedFailureHint = `${reportResult.classification ?? ""}|${reportResult.verificationReason ?? ""}`;

  if (isNetworkLatencyReason(combinedFailureHint)) {
    return {
      kind: "unavailable",
      message: connectivityMessage,
      requiresOk: true,
      autoAdvanceWhenAutoplay: false,
    };
  }

  if (isCopyrightReason(combinedFailureHint)) {
    return {
      kind: "unavailable",
      message: copyrightMessage ?? unavailableMessage,
      countdownMs: unavailableCountdownMs,
      autoAdvanceWhenAutoplay: true,
    };
  }

  if (isRemovedOrPrivateReason(combinedFailureHint)) {
    return {
      kind: "unavailable",
      message: removedOrPrivateMessage ?? unavailableMessage,
      countdownMs: unavailableCountdownMs,
      autoAdvanceWhenAutoplay: true,
    };
  }

  if (isInteractivePlaybackBlockReason(reportResult.verificationReason)) {
    return { kind: "direct-iframe" };
  }

  if (reportResult.shouldSkip || isUnavailableVerificationReason(reportResult.verificationReason)) {
    return {
      kind: "unavailable",
      message: unavailableMessage,
      countdownMs: unavailableCountdownMs,
      autoAdvanceWhenAutoplay: true,
    };
  }

  if (/yt-player-(age-or-owner-restricted-(101|150)|error-(5|101|150))/i.test(runtimeReason)) {
    return { kind: "direct-iframe" };
  }

  return { kind: "direct-iframe" };
}

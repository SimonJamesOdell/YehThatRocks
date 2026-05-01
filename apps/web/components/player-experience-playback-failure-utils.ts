export type ReportUnavailableResult = {
  shouldSkip: boolean;
  verificationReason: string | null;
  skipped: boolean;
};

export type VerifiedPlaybackFailurePresentation = {
  kind: "direct-iframe";
} | {
  kind: "unavailable";
  message?: string;
  countdownMs?: number;
};

export function isInteractivePlaybackBlockReason(reason: string | null | undefined) {
  return typeof reason === "string" && /(bot-check|interactive-login-check|login-required|content-check-required|consent|provider-blocked)/i.test(reason);
}

export function isUnavailableVerificationReason(reason: string | null | undefined) {
  return typeof reason === "string"
    && /(oembed:(404|410)|embed:(404|410)|embed:age-restricted|embed:playability-unavailable|embed:video-unavailable)/i.test(reason);
}

export function resolveVerifiedPlaybackFailurePresentation(options: {
  runtimeReason: string;
  reportResult: ReportUnavailableResult;
  unavailableMessage?: string;
  unavailableCountdownMs?: number;
}): VerifiedPlaybackFailurePresentation {
  const { runtimeReason, reportResult, unavailableMessage, unavailableCountdownMs } = options;

  if (isInteractivePlaybackBlockReason(reportResult.verificationReason)) {
    return { kind: "direct-iframe" };
  }

  if (reportResult.shouldSkip || isUnavailableVerificationReason(reportResult.verificationReason)) {
    return {
      kind: "unavailable",
      message: unavailableMessage,
      countdownMs: unavailableCountdownMs,
    };
  }

  if (/yt-player-(age-or-owner-restricted-(101|150)|error-(5|101|150))/i.test(runtimeReason)) {
    return { kind: "direct-iframe" };
  }

  return { kind: "direct-iframe" };
}

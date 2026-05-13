"use client";

import { useCallback, type MutableRefObject } from "react";

import type { ReportUnavailableResult } from "@/components/player-experience-playback-failure-utils";

export function usePlayerUnavailableReporting({
  currentVideoId,
  reportedUnavailableVideoIdRef,
  reportedUnavailableVerificationReasonRef,
  logPlayerDebug,
}: {
  currentVideoId: string;
  reportedUnavailableVideoIdRef: MutableRefObject<string | null>;
  reportedUnavailableVerificationReasonRef: MutableRefObject<string | null>;
  logPlayerDebug: (event: string, details?: Record<string, unknown>) => void;
}) {
  const reportUnavailableFromPlayer = useCallback(async (reason: string): Promise<ReportUnavailableResult> => {
    if (reportedUnavailableVideoIdRef.current === currentVideoId) {
      logPlayerDebug("report-unavailable:already-reported", {
        videoId: currentVideoId,
        reason,
      });
      return {
        shouldSkip: false,
        verificationReason: reportedUnavailableVerificationReasonRef.current,
        classification: null,
        skipped: true,
      };
    }

    reportedUnavailableVideoIdRef.current = currentVideoId;

    try {
      const response = await fetch("/api/videos/unavailable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          videoId: currentVideoId,
          reason,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            skipped?: boolean;
            reason?: string;
            classification?: string;
            newVideoId?: string;
          }
        | null;

      logPlayerDebug("report-unavailable:response", {
        videoId: currentVideoId,
        reason,
        httpStatus: response.status,
        responseOk: response.ok,
        payload,
      });

      const verificationReason = typeof payload?.reason === "string" ? payload.reason : null;
      const classification = typeof payload?.classification === "string" ? payload.classification : null;
      const skipped = payload?.skipped === true;
      const newVideoId = typeof payload?.newVideoId === "string" && payload.newVideoId.length > 0 ? payload.newVideoId : null;
      reportedUnavailableVerificationReasonRef.current = verificationReason;

      return {
        shouldSkip: Boolean(response.ok && payload?.ok && !skipped),
        verificationReason,
        classification,
        skipped,
        newVideoId,
      };
    } catch {
      logPlayerDebug("report-unavailable:network-error", {
        videoId: currentVideoId,
        reason,
      });
      return {
        shouldSkip: false,
        verificationReason: null,
        classification: null,
        skipped: false,
      };
    }
  }, [currentVideoId, logPlayerDebug, reportedUnavailableVerificationReasonRef, reportedUnavailableVideoIdRef]);

  return { reportUnavailableFromPlayer };
}

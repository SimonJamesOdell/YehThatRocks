"use client";

import type { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";

type RouterInstance = ReturnType<typeof useRouter>;

export type SuggestOutcome = {
  kind: "video" | "playlist";
  status: "ingested" | "already-in-catalog" | "rejected" | "queued";
  title: string;
  detail: string;
  videoId?: string;
  artist?: string | null;
  track?: string | null;
};

type UseSuggestNewVideoOptions = {
  isAuthenticated: boolean;
  isAdminUser: boolean;
  router: RouterInstance;
};

export function useSuggestNewVideo({ isAuthenticated, isAdminUser, router }: UseSuggestNewVideoOptions) {
  const [isSuggestModalOpen, setIsSuggestModalOpen] = useState(false);
  const [suggestSource, setSuggestSource] = useState("");
  const [suggestArtist, setSuggestArtist] = useState("");
  const [suggestTrack, setSuggestTrack] = useState("");
  const [suggestPending, setSuggestPending] = useState(false);
  const [suggestRetryPending, setSuggestRetryPending] = useState(false);
  const [suggestQuotaStatusPending, setSuggestQuotaStatusPending] = useState(false);
  const [suggestQuotaExhausted, setSuggestQuotaExhausted] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestOutcome, setSuggestOutcome] = useState<SuggestOutcome | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    videoId: string;
    suggestedArtist: string | null;
    suggestedTrack: string | null;
    parseConfidence: number | null;
  } | null>(null);

  const applyVideoOutcome = useCallback((payload: {
    videoId?: string;
    submissionStatus?: "ingested" | "already-in-catalog" | "rejected" | "replaced";
    rejectionReason?: string | null;
    replacedFrom?: string | null;
    artist?: string | null;
    track?: string | null;
    decision?: { message?: string };
  }) => {
    if (payload.submissionStatus === "already-in-catalog") {
      setSuggestOutcome({
        kind: "video",
        status: "already-in-catalog",
        title: "Already in catalog",
        detail: "This video already exists in the catalog and is available now.",
        videoId: payload.videoId,
        artist: payload.artist,
        track: payload.track,
      });
      return;
    }

    if (payload.submissionStatus === "rejected") {
      setSuggestOutcome({
        kind: "video",
        status: "rejected",
        title: "Suggestion rejected",
        detail: payload.rejectionReason || payload.decision?.message || "Rejected during ingestion/classification.",
        videoId: payload.videoId,
      });
      return;
    }

    if (payload.submissionStatus === "replaced") {
      setSuggestOutcome({
        kind: "video",
        status: "ingested",
        title: "Replaced with alternative upload",
        detail: `Original upload unavailable — replaced with a working alternative${payload.artist && payload.track ? ` (${payload.artist} – ${payload.track})` : ""}.`,
        videoId: payload.videoId,
        artist: payload.artist,
        track: payload.track,
      });
      return;
    }

    setSuggestOutcome({
      kind: "video",
      status: "ingested",
      title: "Ingestion succeeded",
      detail: "Video ingested and classified successfully.",
      videoId: payload.videoId,
      artist: payload.artist,
      track: payload.track,
    });
  }, []);

  const refreshSuggestQuotaStatus = useCallback(async () => {
    setSuggestQuotaStatusPending(true);

    try {
      const response = await fetch("/api/videos/suggest", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as
        | {
          ok?: boolean;
          quotaExhausted?: boolean;
        }
        | null;

      if (response.ok && payload?.ok) {
        setSuggestQuotaExhausted(Boolean(payload.quotaExhausted));
      }
    } catch {
      // Best effort status check only.
    } finally {
      setSuggestQuotaStatusPending(false);
    }
  }, []);

  const openSuggestModal = useCallback(() => {
    setSuggestSource("");
    setSuggestArtist("");
    setSuggestTrack("");
    setSuggestOutcome(null);
    setSuggestError(null);
    setSuggestQuotaExhausted(false);
    setPendingConfirmation(null);
    setIsSuggestModalOpen(true);
    void refreshSuggestQuotaStatus();
  }, [refreshSuggestQuotaStatus]);

  const closeSuggestModal = useCallback(() => {
    if (suggestPending) {
      return;
    }

    setIsSuggestModalOpen(false);
    setSuggestError(null);
    setSuggestOutcome(null);
  }, [suggestPending]);

  const resetSuggestForAnother = useCallback(() => {
    setSuggestSource("");
    setSuggestArtist("");
    setSuggestTrack("");
    setSuggestError(null);
    setSuggestOutcome(null);
    setPendingConfirmation(null);

    if (suggestQuotaExhausted) {
      return;
    }
  }, [suggestQuotaExhausted]);

  const watchSuggestedVideoNow = useCallback(() => {
    if (!suggestOutcome?.videoId) {
      return;
    }

    const href = `/?v=${encodeURIComponent(suggestOutcome.videoId)}&resume=1`;
    dispatchAppEvent(EVENT_NAMES.OVERLAY_CLOSE_REQUEST, { href });
    router.push(href);
    closeSuggestModal();
  }, [closeSuggestModal, router, suggestOutcome?.videoId]);

  const submitSuggestNew = useCallback(async () => {
    const source = suggestSource.trim();
    if (!source) {
      setSuggestError("Paste a YouTube URL, playlist URL, or video id.");
      return;
    }

    setSuggestPending(true);
    setSuggestError(null);
    setSuggestOutcome(null);

    try {
      const response = await fetch("/api/videos/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source,
          artist: suggestArtist.trim() || undefined,
          track: suggestTrack.trim() || undefined,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
          ok?: boolean;
          error?: string;
          kind?: "video" | "playlist";
          videoId?: string;
          submissionStatus?: "ingested" | "already-in-catalog" | "rejected" | "needs-confirmation";
          rejectionReason?: string | null;
          artist?: string | null;
          track?: string | null;
          suggestedArtist?: string | null;
          suggestedTrack?: string | null;
          parseConfidence?: number | null;
          queuedVideoCount?: number;
          errorCode?: string;
          decision?: { message?: string };
        }
        | null;

      if (!response.ok || !payload?.ok) {
        if (payload?.errorCode === "youtube-quota-exhausted") {
          setSuggestQuotaExhausted(true);
        }
        setSuggestError(payload?.error || "Could not submit suggestion. Please try again.");
        return;
      }

      if (payload.kind === "playlist") {
        setSuggestOutcome({
          kind: "playlist",
          status: "queued",
          title: "Playlist queued",
          detail: `Queued ${payload.queuedVideoCount ?? 0} videos for background ingestion.`,
        });
      } else if (payload.submissionStatus === "needs-confirmation" && payload.videoId) {
        // Pre-fill the artist/track fields with the AI's best guess and enter
        // confirmation mode — the user must correct and resubmit.
        setPendingConfirmation({
          videoId: payload.videoId,
          suggestedArtist: payload.suggestedArtist ?? null,
          suggestedTrack: payload.suggestedTrack ?? null,
          parseConfidence: payload.parseConfidence ?? null,
        });
        setSuggestArtist(payload.suggestedArtist ?? "");
        setSuggestTrack(payload.suggestedTrack ?? "");
      } else {
        setPendingConfirmation(null);
        // submissionStatus is not "needs-confirmation" here — we handled that branch above.
        applyVideoOutcome({ ...payload, submissionStatus: payload.submissionStatus as "ingested" | "already-in-catalog" | "rejected" | "replaced" | undefined });
      }
    } catch {
      setSuggestError("Could not submit suggestion. Please try again.");
    } finally {
      setSuggestPending(false);
    }
  }, [applyVideoOutcome, suggestArtist, suggestSource, suggestTrack, pendingConfirmation]);

  const retryRejectedSuggestVideo = useCallback(async () => {
    if (suggestOutcome?.kind !== "video" || suggestOutcome.status !== "rejected" || !suggestOutcome.videoId) {
      return;
    }

    setSuggestRetryPending(true);
    setSuggestError(null);

    try {
      const response = await fetch("/api/videos/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source: suggestOutcome.videoId, retryRejected: true }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
          ok?: boolean;
          error?: string;
          videoId?: string;
          submissionStatus?: "ingested" | "already-in-catalog" | "rejected" | "replaced";
          rejectionReason?: string | null;
          replacedFrom?: string | null;
          artist?: string | null;
          track?: string | null;
          decision?: { message?: string };
        }
        | null;

      if (!response.ok || !payload?.ok) {
        setSuggestError(payload?.error || "Could not clear prior state and retry ingestion.");
        return;
      }

      applyVideoOutcome(payload);
    } catch {
      setSuggestError("Could not clear prior state and retry ingestion.");
    } finally {
      setSuggestRetryPending(false);
    }
  }, [applyVideoOutcome, suggestOutcome]);

  return {
    closeSuggestModal,
    isSuggestModalOpen,
    openSuggestModal,
    pendingConfirmation,
    refreshSuggestQuotaStatus,
    resetSuggestForAnother,
    setSuggestArtist,
    setSuggestSource,
    setSuggestTrack,
    submitSuggestNew,
    suggestArtist,
    suggestError,
    suggestOutcome,
    suggestPending,
    suggestRetryPending,
    suggestQuotaExhausted,
    suggestQuotaStatusPending,
    suggestSource,
    suggestTrack,
    retryRejectedSuggestVideo,
    watchSuggestedVideoNow,
  };
}

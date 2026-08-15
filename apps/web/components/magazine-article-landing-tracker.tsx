"use client";

import { useEffect } from "react";

import { getAnalyticsIds } from "@/lib/analytics-client";

type MagazineArticleLandingTrackerProps = {
  slug: string;
};

// Tracks the most recent session that has already recorded a magazine landing,
// so we only count one landing per session. SPA navigation across articles must
// not re-count as fresh landings.
const LAST_LANDING_SESSION_KEY = "ytr_last_landing_sid";

function isSameHostReferrer(referrer: string, currentHost: string) {
  try {
    return new URL(referrer).host === currentHost;
  } catch {
    return false;
  }
}

export function MagazineArticleLandingTracker({ slug }: MagazineArticleLandingTrackerProps) {
  useEffect(() => {
    const referrer = document.referrer || "";
    const currentHost = window.location.host;

    // A same-host referrer means the visitor navigated here from inside the
    // site, so it is not an external landing.
    const isInternalNavigation = referrer.length > 0 && isSameHostReferrer(referrer, currentHost);
    if (isInternalNavigation) {
      return;
    }

    const ids = getAnalyticsIds();
    if (!ids) return;

    // One landing per session. document.referrer does not change during SPA
    // navigation, so a session-scoped guard is what prevents every subsequent
    // article view from being counted as a new landing.
    try {
      if (window.localStorage.getItem(LAST_LANDING_SESSION_KEY) === ids.sessionId) {
        return;
      }
      window.localStorage.setItem(LAST_LANDING_SESSION_KEY, ids.sessionId);
    } catch {
      // Storage unavailable — fall through and still report.
    }

    void fetch("/api/magazine/landing", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slug,
        referrer: referrer || null,
        visitorId: ids.visitorId,
        sessionId: ids.sessionId,
      }),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  }, [slug]);

  return null;
}

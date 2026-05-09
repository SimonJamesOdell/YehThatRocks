"use client";

import { useEffect } from "react";

type MagazineArticleLandingTrackerProps = {
  slug: string;
};

function isSameHostReferrer(referrer: string, currentHost: string) {
  try {
    const refUrl = new URL(referrer);
    return refUrl.host === currentHost;
  } catch {
    return false;
  }
}

export function MagazineArticleLandingTracker({ slug }: MagazineArticleLandingTrackerProps) {
  useEffect(() => {
    const storageKey = `magazine-external-landing:${slug}`;

    try {
      if (window.sessionStorage.getItem(storageKey) === "1") {
        return;
      }
    } catch {
      // Ignore storage issues and still attempt reporting.
    }

    const referrer = document.referrer || "";
    const currentHost = window.location.host;
    const isInternalNavigation = referrer.length > 0 && isSameHostReferrer(referrer, currentHost);

    if (isInternalNavigation) {
      return;
    }

    try {
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Ignore storage issues.
    }

    void fetch("/api/magazine/landing", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slug,
        referrer: referrer || null,
      }),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  }, [slug]);

  return null;
}

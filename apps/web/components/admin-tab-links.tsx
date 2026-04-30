"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AdminTab } from "@/components/admin-dashboard-panel";

type PendingCountPayload = {
  pendingVideos?: Array<unknown>;
  totalPending?: number;
};

const PENDING_COUNT_POLL_MS = 30_000;

export function AdminTabLinks({
  activeTab,
  enablePendingCount = true,
}: {
  activeTab: AdminTab;
  enablePendingCount?: boolean;
}) {
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enablePendingCount) {
      setPendingCount(null);
      return;
    }

    let cancelled = false;

    const fetchPendingCount = async () => {
      try {
        const response = await fetch("/api/admin/videos/pending", {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-store",
          },
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as PendingCountPayload;
        const fallbackCount = Array.isArray(payload.pendingVideos) ? payload.pendingVideos.length : 0;
        const nextCount = Number.isFinite(payload.totalPending) ? Number(payload.totalPending) : fallbackCount;

        if (!cancelled) {
          setPendingCount(nextCount);
        }
      } catch {
        // Keep last known count if polling fails.
      }
    };

    void fetchPendingCount();
    const intervalId = window.setInterval(() => {
      void fetchPendingCount();
    }, PENDING_COUNT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enablePendingCount]);

  const tabClass = (tab: AdminTab) => (activeTab === tab ? "navLink navLinkActive" : "navLink");

  return (
    <div className="accountTopBarActions">
      <Link href="/admin?tab=overview" className={tabClass("overview")}>Overview</Link>
      <Link href="/admin?tab=performance" className={tabClass("performance")}>Performance</Link>
      <Link href="/admin?tab=worldmap" className={tabClass("worldmap")}>Visitor Map</Link>
      <Link href="/admin?tab=api" className={tabClass("api")}>API Usage</Link>
      <Link href="/admin?tab=categories" className={tabClass("categories")}>Categories</Link>
      <Link href="/admin?tab=videos" className={tabClass("videos")}>New Videos {pendingCount !== null ? `(${pendingCount})` : ""}</Link>
      <Link href="/admin?tab=artists" className={tabClass("artists")}>Artists</Link>
      <Link href="/admin?tab=ambiguous" className={tabClass("ambiguous")}>Ambiguous</Link>
    </div>
  );
}

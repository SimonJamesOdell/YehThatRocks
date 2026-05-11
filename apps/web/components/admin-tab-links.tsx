"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AdminTab } from "@/components/admin-dashboard-panel";

type PendingCountPayload = {
  pendingVideos?: Array<unknown>;
  totalPending?: number;
};

type CatalogReviewCountPayload = {
  remaining?: number;
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
  const [catalogReviewRemaining, setCatalogReviewRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!enablePendingCount) {
      setPendingCount(null);
      return;
    }

    let cancelled = false;

    const fetchPendingCount = async () => {
      try {
        const [pendingResponse, catalogReviewResponse] = await Promise.all([
          fetch("/api/admin/videos/pending", {
            cache: "no-store",
            headers: {
              "Cache-Control": "no-store",
            },
          }),
          fetch("/api/admin/videos/catalog-review", {
            cache: "no-store",
            headers: {
              "Cache-Control": "no-store",
            },
          }),
        ]);

        if (pendingResponse.ok) {
          const pendingPayload = (await pendingResponse.json()) as PendingCountPayload;
          const fallbackCount = Array.isArray(pendingPayload.pendingVideos) ? pendingPayload.pendingVideos.length : 0;
          const nextPendingCount = Number.isFinite(pendingPayload.totalPending)
            ? Number(pendingPayload.totalPending)
            : fallbackCount;

          if (!cancelled) {
            setPendingCount(nextPendingCount);
          }
        }

        if (catalogReviewResponse.ok) {
          const catalogReviewPayload = (await catalogReviewResponse.json()) as CatalogReviewCountPayload;
          const nextCatalogReviewRemaining = Number.isFinite(catalogReviewPayload.remaining)
            ? Number(catalogReviewPayload.remaining)
            : 0;

          if (!cancelled) {
            setCatalogReviewRemaining(nextCatalogReviewRemaining);
          }
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
      <Link href="/admin?tab=magazine" className={tabClass("magazine")}>Magazine</Link>
      <Link href="/admin?tab=performance" className={tabClass("performance")}>Performance</Link>
      <Link href="/admin?tab=worldmap" className={tabClass("worldmap")}>Visitor Map</Link>
      <Link href="/admin?tab=api" className={tabClass("api")}>API Usage</Link>
      <Link href="/admin?tab=categories" className={tabClass("categories")}>Categories</Link>
      <Link href="/admin?tab=videos" className={tabClass("videos")}>New Videos {pendingCount !== null ? `(${pendingCount})` : ""}</Link>
      <Link href="/admin?tab=catalog-review" className={tabClass("catalog-review")}>Catalog Cleanup {catalogReviewRemaining !== null ? `(${catalogReviewRemaining})` : ""}</Link>
    </div>
  );
}

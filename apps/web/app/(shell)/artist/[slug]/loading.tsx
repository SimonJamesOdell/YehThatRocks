"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { OverlayLoadingShell } from "@/components/overlay-loading-shell";

const PENDING_ARTIST_BREADCRUMB_KEY = "ytr:pending-artist-breadcrumb";

export default function ArtistDetailLoading() {
  const pathname = usePathname();
  const isWikiRoute = pathname.endsWith("/wiki");
  const slug = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    return isWikiRoute ? parts.at(-2) ?? "" : parts.at(-1) ?? "";
  }, [isWikiRoute, pathname]);
  const artistLabel = useMemo(() => {
    if (typeof window === "undefined") {
      return "Loading...";
    }

    const rawValue = window.sessionStorage.getItem(PENDING_ARTIST_BREADCRUMB_KEY);
    if (!rawValue) {
      return "Loading...";
    }

    try {
      const parsed = JSON.parse(rawValue) as { slug?: string; name?: string };
      if (parsed.slug === slug && typeof parsed.name === "string" && parsed.name.trim()) {
        return parsed.name.trim();
      }
    } catch {
      // Ignore malformed pending breadcrumb payloads.
    }

    return "Loading...";
  }, [slug]);

  return (
    <OverlayLoadingShell
      header={
        <OverlayHeader close={false}>
          <strong>
            <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
              <span className="categoryHeaderIcon" aria-hidden="true">🎸</span>
              <Link href="/artists" className="categoryHeaderBreadcrumbLink">
                Artists
              </Link>
              <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
              <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{artistLabel}</span>
            </span>
          </strong>
          <CloseLink />
        </OverlayHeader>
      }
      message={isWikiRoute ? "Loading wiki..." : "Loading artist videos..."}
    />
  );
}

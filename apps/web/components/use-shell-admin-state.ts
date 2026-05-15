"use client";

import { useCallback, useMemo, useState } from "react";
import { parseJsonOrNull } from "@/lib/parse-json";

export type ShellMagazineTrack = {
  slug: string;
  videoId: string;
  title: string;
  artist: string;
  kicker?: string | null;
  genre: string;
};

export type ShellAdminStateResult = {
  deletingMagazineSlugs: Record<string, boolean>;
  magazineDeleteErrors: Record<string, string>;
  visibleMagazineTracks: ShellMagazineTrack[];
  handleDeleteMagazineArticle: (track: ShellMagazineTrack) => Promise<void>;
};

export function useShellAdminState({
  isAdmin,
  latestMagazineTracks,
  pathname,
  onDeletedCurrentArticle,
}: {
  isAdmin: boolean;
  latestMagazineTracks: ShellMagazineTrack[];
  pathname: string;
  onDeletedCurrentArticle?: () => void;
}): ShellAdminStateResult {
  const [deletingMagazineSlugs, setDeletingMagazineSlugs] = useState<Record<string, boolean>>({});
  const [deletedMagazineSlugs, setDeletedMagazineSlugs] = useState<Record<string, boolean>>({});
  const [magazineDeleteErrors, setMagazineDeleteErrors] = useState<Record<string, string>>({});

  const visibleMagazineTracks = useMemo(
    () => latestMagazineTracks.filter((track) => !deletedMagazineSlugs[track.slug]),
    [deletedMagazineSlugs, latestMagazineTracks],
  );

  const handleDeleteMagazineArticle = useCallback(async (track: ShellMagazineTrack) => {
    if (!isAdmin || deletingMagazineSlugs[track.slug]) {
      return;
    }

    const confirmed = window.confirm(`Delete article "${track.title}"?`);
    if (!confirmed) {
      return;
    }

    setDeletingMagazineSlugs((current) => ({ ...current, [track.slug]: true }));
    setMagazineDeleteErrors((current) => {
      const next = { ...current };
      delete next[track.slug];
      return next;
    });

    try {
      const response = await fetch(`/api/admin/magazine/${encodeURIComponent(track.slug)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const payload = (await parseJsonOrNull(response)) as { error?: string } | null;
      if (!response.ok) {
        setMagazineDeleteErrors((current) => ({
          ...current,
          [track.slug]: payload?.error ?? "Delete failed",
        }));
        return;
      }

      setDeletedMagazineSlugs((current) => ({ ...current, [track.slug]: true }));
      if (pathname === `/magazine/${track.slug}`) {
        onDeletedCurrentArticle?.();
      }
    } catch {
      setMagazineDeleteErrors((current) => ({
        ...current,
        [track.slug]: "Delete failed",
      }));
    } finally {
      setDeletingMagazineSlugs((current) => ({ ...current, [track.slug]: false }));
    }
  }, [deletingMagazineSlugs, isAdmin, onDeletedCurrentArticle, pathname]);

  return {
    deletingMagazineSlugs,
    magazineDeleteErrors,
    visibleMagazineTracks,
    handleDeleteMagazineArticle,
  };
}

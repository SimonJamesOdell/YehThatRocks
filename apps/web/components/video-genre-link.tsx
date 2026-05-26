"use client";

import Link from "next/link";

import { resolveVideoGenreNavigationTarget } from "@/lib/video-genre-navigation";

type VideoGenreLinkProps = {
  genre: string | null | undefined;
  className?: string;
  stopPropagation?: boolean;
};

export function VideoGenreLink({ genre, className, stopPropagation = false }: VideoGenreLinkProps) {
  const target = resolveVideoGenreNavigationTarget(genre);

  return (
    <Link
      href={target.href}
      className={className}
      prefetch={false}
      style={{ color: "inherit", textDecoration: "none" }}
      onClick={(event) => {
        if (stopPropagation) {
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        if (stopPropagation) {
          event.stopPropagation();
        }
      }}
      aria-label={`Open ${target.label} category`}
      title={`Open ${target.categoryLabel}${target.tabId !== "all" ? ` (${target.tabId})` : ""}`}
    >
      {target.label}
    </Link>
  );
}

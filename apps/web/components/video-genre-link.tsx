"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { resolveVideoGenreNavigationTarget } from "@/lib/video-genre-navigation";

type VideoGenreLinkProps = {
  genre: string | null | undefined;
  className?: string;
  stopPropagation?: boolean;
  nestedInLink?: boolean;
};

export function VideoGenreLink({
  genre,
  className,
  stopPropagation = false,
  nestedInLink = false,
}: VideoGenreLinkProps) {
  const router = useRouter();
  const target = resolveVideoGenreNavigationTarget(genre);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
  };

  if (nestedInLink) {
    return (
      <span
        className={className}
        style={{ color: "inherit", textDecoration: "none" }}
        role="link"
        tabIndex={0}
        onClick={(event) => {
          event.preventDefault();
          handleClick(event);
          router.push(target.href);
        }}
        onKeyDown={(event) => {
          handleKeyDown(event);
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }

          event.preventDefault();
          router.push(target.href);
        }}
        aria-label={`Open ${target.label} category`}
        title={`Open ${target.categoryLabel}${target.tabId !== "all" ? ` (${target.tabId})` : ""}`}
      >
        {target.label}
      </span>
    );
  }

  return (
    <Link
      href={target.href}
      className={className}
      prefetch={false}
      style={{ color: "inherit", textDecoration: "none" }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`Open ${target.label} category`}
      title={`Open ${target.categoryLabel}${target.tabId !== "all" ? ` (${target.tabId})` : ""}`}
    >
      {target.label}
    </Link>
  );
}

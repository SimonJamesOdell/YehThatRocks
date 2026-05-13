"use client";

type ShellNavItemContentProps = {
  href: string;
  label: string;
};

export function ShellNavItemContent({ href, label }: ShellNavItemContentProps) {
  if (href === "/categories") {
    return (
      <>
        <span className="navCategoryGlyph" aria-hidden="true">
          ☣
        </span>
        <span>{label}</span>
      </>
    );
  }

  if (href === "/artists") {
    return (
      <>
        <span className="navArtistsGlyph" aria-hidden="true">
          🎸︎
        </span>
        <span>{label}</span>
      </>
    );
  }

  if (href === "/top100") {
    return (
      <>
        <span className="navTop100Glyph" aria-hidden="true">
          🏆︎
        </span>
        <span>{label}</span>
      </>
    );
  }

  if (href === "/favourites") {
    return (
      <>
        <span className="navFavouritesGlyph" aria-hidden="true">
          ❤️
        </span>
        <span>{label}</span>
      </>
    );
  }

  if (href === "/playlists") {
    return (
      <>
        <span className="navPlaylistsGlyph" aria-hidden="true">
          ♬
        </span>
        <span>{label}</span>
      </>
    );
  }

  if (href === "/history") {
    return (
      <>
        <span className="navHistoryGlyph" aria-hidden="true">
          🕘
        </span>
        <span>{label}</span>
      </>
    );
  }

  if (href === "/account") {
    return (
      <>
        <span className="navAccountGlyph" aria-hidden="true">
          👤
        </span>
        <span>{label}</span>
      </>
    );
  }

  if (href === "/new") {
    return (
      <>
        <span className="navNewGlyph" aria-hidden="true">
          ⭐
        </span>
        <span>{label}</span>
      </>
    );
  }

  return <>{label}</>;
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FAVOURITES_CREATE_PLAYLIST_FINISHED_EVENT, FAVOURITES_CREATE_PLAYLIST_REQUESTED_EVENT, listenToAppEvent, dispatchAppEvent } from "@/lib/events-contract";

type FavouritesHeaderControlsProps = {
  isAuthenticated: boolean;
};

export function FavouritesHeaderControls({ isAuthenticated }: FavouritesHeaderControlsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);

  const filterValue = searchParams.get("f") ?? "";

  const updateFilter = useCallback((nextValue: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextValue.trim().length > 0) {
      params.set("f", nextValue);
    } else {
      params.delete("f");
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsCreatingPlaylist(false);
      return;
    }

    const unsubscribeStart = listenToAppEvent(FAVOURITES_CREATE_PLAYLIST_REQUESTED_EVENT, () => {
      setIsCreatingPlaylist(true);
    });

    const unsubscribeFinish = listenToAppEvent(FAVOURITES_CREATE_PLAYLIST_FINISHED_EVENT, () => {
      setIsCreatingPlaylist(false);
    });

    return () => {
      unsubscribeStart();
      unsubscribeFinish();
    };
  }, [isAuthenticated]);

  const headerMessage = useMemo(() => {
    if (!isAuthenticated) {
      return "Sign in to filter favourites and create playlists.";
    }

    return null;
  }, [isAuthenticated]);

  return (
    <div className="favouritesHeaderActions">
      <div className="categoriesFilterBar favouritesHeaderFilterBar">
        <input
          type="text"
          className="categoriesFilterInput"
          placeholder="type to filter..."
          value={filterValue}
          onChange={(event) => updateFilter(event.currentTarget.value)}
          aria-label="Filter favourites by prefix"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {isAuthenticated ? (
        <button
          type="button"
          className="newPageSeenToggle favouritesCreatePlaylistButton"
          onClick={() => {
            setIsCreatingPlaylist(true);
            dispatchAppEvent(FAVOURITES_CREATE_PLAYLIST_REQUESTED_EVENT, null);
          }}
          disabled={isCreatingPlaylist}
        >
          {isCreatingPlaylist ? "+ Creating..." : "+ New Playlist"}
        </button>
      ) : (
        <span className="favouritesHeaderAuthNote">{headerMessage}</span>
      )}
    </div>
  );
}

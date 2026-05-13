"use client";

import type { DragEventHandler, ReactNode } from "react";

type PlaylistTrackRowProps = {
  isRecentlyAddedTrack: boolean;
  isTrackRemoving: boolean;
  isDraggingThis: boolean;
  isDragOver: boolean;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  children: ReactNode;
  "data-playlist-index": number;
};

export function PlaylistTrackRow({
  isRecentlyAddedTrack,
  isTrackRemoving,
  isDraggingThis,
  isDragOver,
  onDragOver,
  onDrop,
  children,
  "data-playlist-index": playlistIndex,
}: PlaylistTrackRowProps) {
  return (
    <div
      data-playlist-index={playlistIndex}
      className={[
        "playlistRailTrackRow",
        isRecentlyAddedTrack ? "playlistRailTrackRowAdded" : "",
        isTrackRemoving ? "relatedCardSlotExiting" : "",
        isDraggingThis ? "playlistRailTrackRowDraggingSource" : "",
        isDragOver ? "playlistRailTrackRowDragOver" : "",
      ].filter(Boolean).join(" ")}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}

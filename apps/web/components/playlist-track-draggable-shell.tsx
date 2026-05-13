"use client";

import type { DragEventHandler, ReactNode } from "react";

type PlaylistTrackDraggableShellProps = {
  trackId: string;
  isTrackRemoving: boolean;
  isTrackMutating: boolean;
  onDragStart: DragEventHandler<HTMLDivElement>;
  onDragEnd: DragEventHandler<HTMLDivElement>;
  children: ReactNode;
};

export function PlaylistTrackDraggableShell({
  trackId,
  isTrackRemoving,
  isTrackMutating,
  onDragStart,
  onDragEnd,
  children,
}: PlaylistTrackDraggableShellProps) {
  return (
    <div
      className={[
        "relatedCardSlot",
        "playlistRailTrackDraggable",
        isTrackRemoving ? "relatedCardSlotExiting" : "",
      ].filter(Boolean).join(" ")}
      data-video-id={trackId}
      draggable={!isTrackRemoving && !isTrackMutating}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {children}
    </div>
  );
}

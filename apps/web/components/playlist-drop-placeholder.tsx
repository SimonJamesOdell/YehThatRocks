"use client";

import type { DragEventHandler } from "react";

type PlaylistDropPlaceholderProps = {
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
};

export function PlaylistDropPlaceholder({
  onDragOver,
  onDrop,
}: PlaylistDropPlaceholderProps) {
  return (
    <div
      className="playlistRailDropPlaceholder"
      aria-hidden="true"
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
}

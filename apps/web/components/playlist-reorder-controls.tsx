"use client";

type PlaylistReorderControlsProps = {
  title: string;
  index: number;
  total: number;
  isTrackRemoving: boolean;
  isTrackMutating: boolean;
  onReorder: (from: number, to: number) => void;
};

export function PlaylistReorderControls({
  title,
  index,
  total,
  isTrackRemoving,
  isTrackMutating,
  onReorder,
}: PlaylistReorderControlsProps) {
  return (
    <div className="playlistRailReorderColumn">
      <button
        type="button"
        className="playlistRailReorderChevron"
        aria-label={`Move ${title} up`}
        title="Move up"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onReorder(index, index - 1);
        }}
        disabled={index === 0 || isTrackRemoving || isTrackMutating}
      >
        <span className="playlistRailChevronGlyph">{"<"}</span>
      </button>
      <button
        type="button"
        className="playlistRailReorderChevron"
        aria-label={`Move ${title} down`}
        title="Move down"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onReorder(index, index + 1);
        }}
        disabled={index >= total - 1 || isTrackRemoving || isTrackMutating}
      >
        <span className="playlistRailChevronGlyph">{">"}</span>
      </button>
    </div>
  );
}

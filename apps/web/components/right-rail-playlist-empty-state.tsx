"use client";

type RightRailPlaylistEmptyStateProps = {
  isCreating: boolean;
  onCreate: () => void;
};

export function RightRailPlaylistEmptyState({
  isCreating,
  onCreate,
}: RightRailPlaylistEmptyStateProps) {
  return (
    <div className="rightRailEmptyState">
      <p className="rightRailStatus">No playlists yet.</p>
      <button
        type="button"
        className="rightRailCreatePlaylistButton"
        onClick={onCreate}
        disabled={isCreating}
      >
        {isCreating ? "+ Creating..." : "+ Create playlist"}
      </button>
    </div>
  );
}

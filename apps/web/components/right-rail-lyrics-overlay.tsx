"use client";

type LyricsRailPayload = {
  artistName: string | null;
  trackName: string | null;
  lyrics: string | null;
  available: boolean;
  message: string | null;
  source: string | null;
  cached: boolean;
};

type RightRailLyricsOverlayProps = {
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  data: LyricsRailPayload | null;
  onClose: () => void;
};

export function RightRailLyricsOverlay({
  isOpen,
  isLoading,
  error,
  data,
  onClose,
}: RightRailLyricsOverlayProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <section
      className="rightRailLyricsOverlay"
      role="dialog"
      aria-modal="false"
      aria-label="Lyrics"
    >
      <div className="rightRailLyricsOverlayHeader">
        <strong>Lyrics</strong>
        <button
          type="button"
          className="rightRailLyricsOverlayClose"
          aria-label="Close lyrics overlay"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="rightRailLyricsOverlayBody">
        {isLoading ? (
          <p className="rightRailStatus">Loading lyrics...</p>
        ) : error ? (
          <p className="rightRailStatus rightRailStatusError">{error}</p>
        ) : data?.available && data.lyrics ? (
          <>
            {data.artistName || data.trackName ? (
              <p className="rightRailLyricsOverlayMeta">
                {data.artistName ? data.artistName : "Unknown artist"}
                {data.trackName ? ` - ${data.trackName}` : ""}
              </p>
            ) : null}
            <pre className="rightRailLyricsOverlayText">{data.lyrics}</pre>
          </>
        ) : (
          <p className="rightRailStatus">{data?.message ?? "No lyrics available for this track."}</p>
        )}
      </div>
    </section>
  );
}

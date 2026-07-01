"use client";

interface ShareTarget {
  id: string;
  label: string;
  href: string;
}

interface PlayerShareModalProps {
  shareUrl: string;
  copied: boolean;
  socialTargets: readonly ShareTarget[];
  onClose: () => void;
  onCopy: () => void;
  onShareTargetOpen: (href: string) => void;
}

export function PlayerShareModal({
  shareUrl,
  copied,
  socialTargets,
  onClose,
  onCopy,
  onShareTargetOpen,
}: PlayerShareModalProps) {
  return (
    <div
      className="shareModalBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Share this video"
      onClick={onClose}
    >
      <div className="shareModal" onClick={(event) => event.stopPropagation()}>
        <div className="shareModalHeader">
          <strong>Share This Video</strong>
          <button
            type="button"
            className="overlayIconBtn"
            onClick={onClose}
            aria-label="Close share modal"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="shareModalSubtitle">Choose a platform, or copy the URL to share anywhere.</p>

        <div className="shareModalGrid">
          {socialTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              className="shareModalTarget"
              onClick={() => onShareTargetOpen(target.href)}
            >
              {target.label}
            </button>
          ))}
        </div>

        <div className="shareModalUrlRow">
          <label htmlFor="share-modal-url" className="shareUrlLabel">Share URL</label>
          <input
            id="share-modal-url"
            type="text"
            className="shareUrlInput"
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
          <button type="button" onClick={onCopy}>
            {copied ? "Copied!" : "Copy Link"}
          </button>
        </div>
      </div>
    </div>
  );
}

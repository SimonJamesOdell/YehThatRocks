"use client";

import { createPortal } from "react-dom";
import { AutoplaySettingsEditor } from "@/components/autoplay-settings-editor";

interface PlayerAutoplayConfigureModalProps {
  open: boolean;
  onClose: () => void;
  isAuthenticated?: boolean;
}

export function PlayerAutoplayConfigureModal({ open, onClose, isAuthenticated }: PlayerAutoplayConfigureModalProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="shareModalBackdrop autoplayConfigureBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Configure autoplay"
      onClick={onClose}
    >
      <div className="shareModal autoplayConfigureModal" onClick={(event) => event.stopPropagation()}>
        <div className="shareModalHeader">
          <strong>Configure Autoplay</strong>
          <button
            type="button"
            className="overlayIconBtn"
            onClick={onClose}
            aria-label="Close configure autoplay modal"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <AutoplaySettingsEditor
          title="Sources"
          className="autoplaySettingsModalBody"
          onSaved={onClose}
          isAuthenticated={isAuthenticated}
        />
      </div>
    </div>,
    document.body,
  );
}

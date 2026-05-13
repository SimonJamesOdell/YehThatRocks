"use client";

type MobileCommunityToggleProps = {
  isOpen: boolean;
  onToggle: () => void;
};

export function MobileCommunityToggle({ isOpen, onToggle }: MobileCommunityToggleProps) {
  return (
    <button
      type="button"
      className={isOpen ? "mobileRailToggle navLink navLinkActive" : "mobileRailToggle navLink"}
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-controls="mobile-community-rail"
    >
      <span className="navCommunityGlyph" aria-hidden="true">💬</span>
      <span>Community</span>
    </button>
  );
}

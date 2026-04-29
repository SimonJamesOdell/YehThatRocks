"use client";

import { useState } from "react";
import { AdminVideoEditModal } from "@/components/admin-video-edit-modal";

type AdminVideoEditButtonProps = {
  videoId: string;
  isAdmin: boolean;
};

export function AdminVideoEditButton({ videoId, isAdmin }: AdminVideoEditButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  function handleSaveComplete(updates: { title: string; channelTitle: string; parsedArtist: string }) {
    const card = document.querySelector(`article[data-video-id="${videoId}"]`);
    if (!(card instanceof HTMLElement)) {
      return;
    }

    const nextTitle = updates.title.trim();
    const nextChannelTitle = updates.channelTitle.trim();

    if (nextTitle.length > 0) {
      const titleEl = card.querySelector(".leaderboardMeta h3");
      if (titleEl instanceof HTMLElement) {
        titleEl.textContent = nextTitle;
      }

      const flagBtn = card.querySelector(".top100CardFlagButton");
      if (flagBtn instanceof HTMLButtonElement) {
        flagBtn.setAttribute("aria-label", `Flag ${nextTitle} for review`);
      }

      const blockBtn = card.querySelector(".searchResultBlockButton");
      if (blockBtn instanceof HTMLButtonElement) {
        blockBtn.setAttribute("aria-label", `Block ${nextTitle}`);
      }
    }

    if (nextChannelTitle.length > 0) {
      const channelEl = card.querySelector(".leaderboardMeta .artistInlineLink");
      if (channelEl instanceof HTMLElement) {
        channelEl.textContent = nextChannelTitle;
      }
    }
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="top100CardAdminEditBtn searchResultAdminEditBtn"
        onClick={() => setIsModalOpen(true)}
        aria-label="Edit video metadata"
        title="Edit video metadata"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </button>
      <AdminVideoEditModal
        isOpen={isModalOpen}
        videoId={videoId}
        onClose={() => setIsModalOpen(false)}
        onSaveComplete={handleSaveComplete}
      />
    </>
  );
}

"use client";

type SearchResultBlockButtonProps = {
  videoId: string;
  title: string;
};

const REMOVE_ANIMATION_MS = 260;

export function SearchResultBlockButton({ videoId, title }: SearchResultBlockButtonProps) {
  async function handleBlockClick(button: HTMLButtonElement) {
    const card = button.closest("article");
    if (!(card instanceof HTMLElement)) {
      return;
    }

    button.disabled = true;
    card.classList.add("searchResultCardRemoving");

    window.setTimeout(() => {
      card.remove();
    }, REMOVE_ANIMATION_MS);

    try {
      await fetch("/api/hidden-videos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId }),
      });
    } catch {
      // Keep card removed even if persistence fails to match quick-hide behavior.
    }
  }

  return (
    <button
      type="button"
      className="searchResultBlockButton"
      aria-label={`Block ${title}`}
      title="Block video"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleBlockClick(event.currentTarget);
      }}
    >
      ×
    </button>
  );
}

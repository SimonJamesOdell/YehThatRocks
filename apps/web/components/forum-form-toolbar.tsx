"use client";

import { useCallback, useRef, useState } from "react";

const EMOJI_LIST = [
  "👍", "👎", "❤️", "🔥", "😂", "🤘", "🎸", "🥁", "🎵", "🎶",
  "💀", "🤯", "👏", "🙌", "💪", "🤝", "👀", "💯", "⭐", "✨",
  "😊", "😎", "🤔", "😅", "🙏", "🎉", "🚀", "💡", "🗣️", "📌",
  "🔗", "📎", "⚠️", "❓", "❗", "✅", "❌", "➕", "➖", "ℹ️",
];

type ForumFormToolbarProps = {
  textareaId: string;
  onInsert: (text: string) => void;
};

export function ForumFormToolbar({ textareaId, onInsert }: ForumFormToolbarProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [videoInput, setVideoInput] = useState("");
  const [videoPreviewId, setVideoPreviewId] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  const insertAtCursor = useCallback((text: string) => {
    const textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (!textarea) {
      onInsert(text);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const newValue = before + text + after;

    // Update DOM directly (for uncontrolled textareas read by FormData)
    textarea.value = newValue;
    // Notify parent (handles React state for controlled textareas)
    onInsert(newValue);

    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
  }, [textareaId, onInsert]);

  const handleEmojiClick = (emoji: string) => {
    insertAtCursor(emoji);
    setShowEmoji(false);
  };

  const parseVideoId = (input: string): string | null => {
    // Plain video ID (11 chars, alphanumeric + _ -)
    const plainMatch = input.trim().match(/^[\w-]{11}$/);
    if (plainMatch) return plainMatch[0];

    // Full yehthatrocks URL: /?v=VIDEO_ID or similar
    const urlMatch = input.match(/[?&]v=([\w-]{11})/);
    if (urlMatch) return urlMatch[1];

    // youtu.be shortlink
    const shortMatch = input.match(/youtu\.be\/([\w-]{11})/);
    if (shortMatch) return shortMatch[1];

    // youtube.com/watch?v=...
    const ytMatch = input.match(/youtube\.com\/watch\?.*v=([\w-]{11})/);
    if (ytMatch) return ytMatch[1];

    return null;
  };

  const handleVideoPreview = () => {
    const id = parseVideoId(videoInput);
    if (id) {
      setVideoPreviewId(id);
      setVideoError(null);
    } else {
      setVideoPreviewId(null);
      setVideoError("Couldn't parse a video ID from that. Try a plain YouTube ID or a yehthatrocks URL.");
    }
  };

  const handleVideoEmbed = () => {
    if (videoPreviewId) {
      insertAtCursor(`[video:${videoPreviewId}]`);
      setShowVideoInput(false);
      setVideoInput("");
      setVideoPreviewId(null);
    }
  };

  return (
    <div className="forumToolbar">
      <div className="forumToolbarLeft">
        {/* Emoji button */}
        <div className="forumToolbarGroup" ref={emojiRef}>
          <button
            type="button"
            className="forumToolbarButton"
            onClick={() => { setShowEmoji(!showEmoji); setShowVideoInput(false); }}
            aria-label="Add emoji"
            aria-expanded={showEmoji}
            title="Add emoji"
          >
            🙂
          </button>
          {showEmoji && (
            <div className="forumEmojiPanel">
              {EMOJI_LIST.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="forumEmojiButton"
                  onClick={() => handleEmojiClick(emoji)}
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Video embed button */}
        <div className="forumToolbarGroup">
          <button
            type="button"
            className="forumToolbarButton"
            onClick={() => { setShowVideoInput(!showVideoInput); setShowEmoji(false); }}
            aria-label="Embed video"
            aria-expanded={showVideoInput}
            title="Embed a video"
          >
            🎬
          </button>
          {showVideoInput && (
            <div className="forumVideoEmbedPanel">
              <div className="forumVideoEmbedRow">
                <input
                  type="text"
                  className="forumVideoEmbedInput"
                  value={videoInput}
                  onChange={(e) => { setVideoInput(e.target.value); setVideoPreviewId(null); setVideoError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleVideoPreview(); } }}
                  placeholder="Video ID or yehthatrocks URL"
                />
                <button
                  type="button"
                  className="forumToolbarButton forumVideoPreviewButton"
                  onClick={handleVideoPreview}
                >
                  Preview
                </button>
              </div>
              {videoError && <p className="forumVideoEmbedError">{videoError}</p>}
              {videoPreviewId && (
                <div className="forumVideoPreview">
                  <img
                    src={`https://i.ytimg.com/vi/${videoPreviewId}/mqdefault.jpg`}
                    alt="Video thumbnail preview"
                    className="forumVideoPreviewThumb"
                  />
                  <button
                    type="button"
                    className="forumNewThreadButton"
                    onClick={handleVideoEmbed}
                  >
                    Embed video
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

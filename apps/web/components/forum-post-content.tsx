"use client";

import { Fragment } from "react";
import { ForumVideoEmbed, type VideoEmbedMetadata } from "@/components/forum-video-embed";

type ForumPostContentProps = {
  content: string;
  videoMetadataMap?: Record<string, VideoEmbedMetadata> | null;
};

export function ForumPostContent({ content, videoMetadataMap }: ForumPostContentProps) {
  // If content is empty, show nothing
  if (!content) {
    return <p className="forumPostContentEmpty">(no content)</p>;
  }

  const parts: Array<{ type: "text" | "video"; value: string }> = [];
  let lastIndex = 0;

  for (const match of content.matchAll(/\[video:([\w-]{11})\]/g)) {
    if (match.index! > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: "video", value: match[1] });
    lastIndex = match.index! + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }

  if (parts.length === 0) {
    // No video tags — render as plain paragraphs
    return (
      <>
        {content.split("\n").map((line, i) => (
          <p key={i}>{line || "\u00A0"}</p>
        ))}
      </>
    );
  }

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "video") {
          return <ForumVideoEmbed key={`v-${i}`} videoId={part.value} metadata={videoMetadataMap?.[part.value] ?? null} />;
        }
        // Split text parts by newlines into paragraphs
        return (
          <Fragment key={`t-${i}`}>
            {part.value.split("\n").map((line, j) => (
              <p key={j}>{line || "\u00A0"}</p>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

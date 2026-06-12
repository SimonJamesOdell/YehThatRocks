"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import type { ForumThreadDetail } from "@/lib/forum-data";
import { OverlayHeader } from "@/components/overlay-header";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";

type ForumThreadContentProps = {
  threadDetail: ForumThreadDetail;
  isAuthenticated: boolean;
};

function formatForumDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${month} ${day}, ${displayHours}:${minutes} ${ampm}`;
}

function getUserProfileHref(screenName: string, userId: number): string {
  return `/u/${encodeURIComponent(screenName)}`;
}

function PostCard({
  post,
  isOpeningPost,
}: {
  post: ForumThreadDetail["posts"][number];
  isOpeningPost: boolean;
}) {
  return (
    <article className={`forumPostCard ${isOpeningPost ? "forumPostCardOpening" : ""}`}>
      <div className="forumPostCardMain">
        <Link
          href={getUserProfileHref(post.userScreenName, post.userId)}
          className="forumPostAvatar"
        >
          {post.userAvatarUrl ? (
            <Image
              src={post.userAvatarUrl}
              alt=""
              width={44}
              height={44}
              className="forumPostAvatarImg"
              unoptimized
            />
          ) : (
            <span className="forumPostAvatarPlaceholder">
              {post.userScreenName.slice(0, 1).toUpperCase()}
            </span>
          )}
        </Link>
        <div className="forumPostBody">
          <div className="forumPostMeta">
            <Link
              href={getUserProfileHref(post.userScreenName, post.userId)}
              className="forumPostAuthor"
            >
              {post.userScreenName}
            </Link>
            <span className="forumPostTimestamp">{formatForumDate(post.createdAt)}</span>
            {isOpeningPost && <span className="forumPostOpBadge">OP</span>}
          </div>
          <div className="forumPostContent">
            {post.content.split("\n").map((line, i) => (
              <p key={i}>{line || "\u00A0"}</p>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ForumThreadContent({ threadDetail, isAuthenticated }: ForumThreadContentProps) {
  const { thread, posts } = threadDetail;
  const [replyContent, setReplyContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPosts, setLocalPosts] = useState(posts);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyContent.trim() || replyContent.trim().length < 2) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/forum/threads/${thread.id}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyContent.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to post reply");
      }

      const { post } = await res.json();
      setLocalPosts((prev) => [...prev, post]);
      setReplyContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post reply");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <OverlayScrollReset />
      <OverlayHeader title={thread.title} />

      <main className="forumThreadPage" role="main" aria-label={`Thread: ${thread.title}`}>
        {/* Thread header */}
        <div className="forumThreadHeader panel">
          <div className="forumThreadHeaderTop">
            <h1 className="forumThreadTitle">
              {thread.isPinned && <span className="forumPinnedBadge" title="Pinned">📌 </span>}
              {thread.title}
              {thread.isLocked && <span className="forumLockedBadge" title="Locked"> 🔒</span>}
            </h1>
            <Link href="/forum" className="forumBackLink">
              ← Back to forum
            </Link>
          </div>
          <div className="forumThreadHeaderMeta">
            <span className="forumThreadHeaderSection">{thread.sectionTitle}</span>
            <span className="forumMetaSep">·</span>
            <span>{thread.postCount} {thread.postCount === 1 ? "reply" : "replies"}</span>
            <span className="forumMetaSep">·</span>
            <span>{thread.viewCount} views</span>
          </div>
        </div>

        {/* Posts */}
        <div className="forumPostsList">
          {localPosts.map((post, idx) => (
            <PostCard
              key={post.id}
              post={post}
              isOpeningPost={idx === 0}
            />
          ))}
        </div>

        {/* Reply form */}
        {thread.isLocked ? (
          <div className="forumThreadLockedNotice panel">
            <p>This thread is locked. New replies are not allowed.</p>
          </div>
        ) : isAuthenticated ? (
          <section className="forumReplyPanel panel" aria-label="Reply to thread">
            <h2 className="forumReplyTitle">Post a reply</h2>
            <form className="forumReplyForm" onSubmit={handleReply}>
              <textarea
                rows={4}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="Write your reply..."
                required
                minLength={2}
                disabled={isSubmitting}
              />
              {error && <p className="forumReplyError">{error}</p>}
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Posting..." : "Post reply"}
              </button>
            </form>
          </section>
        ) : (
          <div className="forumReplyAuthGate panel">
            <p>Sign in to join the discussion.</p>
            <Link href="/login" className="forumNewThreadButton">Sign in</Link>
          </div>
        )}
      </main>
    </>
  );
}

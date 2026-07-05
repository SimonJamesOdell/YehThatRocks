"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { ForumThreadDetail, ThreadVoteCounts } from "@/lib/forum-data";
import { MobileFixedScroll } from "@/components/mobile/mobile-fixed-scroll";
import { ForumPostContent } from "@/components/forum-post-content";
import { ForumVideoEmbed, type VideoEmbedMetadata } from "@/components/forum-video-embed";
import { ForumFormToolbar } from "@/components/forum-form-toolbar";

type MobileForumThreadPageProps = {
  threadDetail: ForumThreadDetail;
  isAuthenticated: boolean;
  videoMetadataMap?: Record<string, VideoEmbedMetadata> | null;
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

// ── Track Battle Header (mobile) ────────────────────────────────────────────

type MobileBattleHeaderProps = {
  threadId: number;
  video1Id: string;
  video2Id: string;
  videoMetadataMap?: Record<string, VideoEmbedMetadata> | null;
  isAuthenticated: boolean;
  initialVoteCounts: ThreadVoteCounts | null | undefined;
  initialUserVote: number | null | undefined;
};

function MobileTrackBattleHeader({
  threadId,
  video1Id,
  video2Id,
  videoMetadataMap,
  isAuthenticated,
  initialVoteCounts,
  initialUserVote,
}: MobileBattleHeaderProps) {
  const [voteCounts, setVoteCounts] = useState<ThreadVoteCounts | null>(initialVoteCounts ?? null);
  const [userVote, setUserVote] = useState<number | null>(initialUserVote ?? null);
  const [isVoting, setIsVoting] = useState(false);

  useEffect(() => {
    fetch(`/api/forum/threads/${threadId}/vote`)
      .then((res) => res.json())
      .then((data) => {
        if (data.voteCounts) setVoteCounts(data.voteCounts);
        if (data.userVote !== undefined) setUserVote(data.userVote);
      })
      .catch(() => {});
  }, [threadId]);

  const handleVote = useCallback(async (vote: 1 | 2) => {
    if (isVoting) return;
    setIsVoting(true);
    try {
      const res = await fetch(`/api/forum/threads/${threadId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.voteCounts) setVoteCounts(data.voteCounts);
      if (data.userVote !== undefined) setUserVote(data.userVote);
    } catch {
      // Best-effort
    } finally {
      setIsVoting(false);
    }
  }, [threadId, isVoting]);

  const total = (voteCounts?.votes1 ?? 0) + (voteCounts?.votes2 ?? 0);
  const pct1 = total > 0 ? Math.round(((voteCounts?.votes1 ?? 0) / total) * 100) : 0;
  const pct2 = total > 0 ? Math.round(((voteCounts?.votes2 ?? 0) / total) * 100) : 0;

  return (
    <section className="m-forum-battle" aria-label="Track Battle">
      <div className="m-forum-battle-videos">
        {/* Track 1 */}
        <div className={`m-forum-battle-video ${userVote === 1 ? "m-forum-battle-voted" : ""}`}>
          <ForumVideoEmbed videoId={video1Id} metadata={videoMetadataMap?.[video1Id] ?? null} />
          <div className="m-forum-battle-bar">
            <div className="m-forum-battle-bar-fill" style={{ width: `${pct1}%` }} />
          </div>
          <div className="m-forum-battle-info">
            <span>{voteCounts?.votes1 ?? 0} votes ({pct1}%)</span>
            {isAuthenticated ? (
              <button
                type="button"
                className={`m-forum-battle-vote-btn ${userVote === 1 ? "m-forum-battle-vote-active" : ""}`}
                onClick={() => handleVote(1)}
                disabled={isVoting}
              >
                {userVote === 1 ? "✓ Voted" : "Vote"}
              </button>
            ) : (
              <Link href="/m/login" className="m-forum-battle-vote-btn">
                Sign in to vote
              </Link>
            )}
          </div>
        </div>

        <div className="m-forum-battle-vs">VS</div>

        {/* Track 2 */}
        <div className={`m-forum-battle-video ${userVote === 2 ? "m-forum-battle-voted" : ""}`}>
          <ForumVideoEmbed videoId={video2Id} metadata={videoMetadataMap?.[video2Id] ?? null} />
          <div className="m-forum-battle-bar">
            <div className="m-forum-battle-bar-fill" style={{ width: `${pct2}%` }} />
          </div>
          <div className="m-forum-battle-info">
            <span>{voteCounts?.votes2 ?? 0} votes ({pct2}%)</span>
            {isAuthenticated ? (
              <button
                type="button"
                className={`m-forum-battle-vote-btn ${userVote === 2 ? "m-forum-battle-vote-active" : ""}`}
                onClick={() => handleVote(2)}
                disabled={isVoting}
              >
                {userVote === 2 ? "✓ Voted" : "Vote"}
              </button>
            ) : (
              <Link href="/m/login" className="m-forum-battle-vote-btn">
                Sign in to vote
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Post Card (mobile) ──────────────────────────────────────────────────────

function PostCard({
  post,
  isOpeningPost,
  videoMetadataMap,
}: {
  post: ForumThreadDetail["posts"][number];
  isOpeningPost: boolean;
  videoMetadataMap?: Record<string, VideoEmbedMetadata> | null;
}) {
  const profileHref = `/u/${encodeURIComponent(post.userScreenName)}`;

  return (
    <article className={`m-forum-post-card ${isOpeningPost ? "m-forum-post-opening" : ""}`}>
      <div className="m-forum-post-header">
        <Link href={profileHref} className="m-forum-post-avatar">
          {post.userAvatarUrl ? (
            <img
              src={post.userAvatarUrl}
              alt=""
              className="m-forum-post-avatar-img"
              loading="lazy"
            />
          ) : (
            <span className="m-forum-post-avatar-placeholder">
              {post.userScreenName.slice(0, 1).toUpperCase()}
            </span>
          )}
        </Link>
        <div className="m-forum-post-meta">
          <Link href={profileHref} className="m-forum-post-author">
            {post.userScreenName}
          </Link>
          <span className="m-forum-post-time">{formatForumDate(post.createdAt)}</span>
          {isOpeningPost && <span className="m-forum-post-op-badge">OP</span>}
        </div>
      </div>
      <div className="m-forum-post-content">
        <ForumPostContent content={post.content} videoMetadataMap={videoMetadataMap} />
      </div>
    </article>
  );
}

// ── Main Thread Page ────────────────────────────────────────────────────────

export function MobileForumThreadPage({
  threadDetail,
  isAuthenticated,
  videoMetadataMap,
}: MobileForumThreadPageProps) {
  const { thread, posts, voteCounts, userVote } = threadDetail;
  const [replyContent, setReplyContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPosts, setLocalPosts] = useState(posts);

  const isTrackBattle = thread.sectionId === "track-battles" && thread.video1Id && thread.video2Id;

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
    <MobileFixedScroll>
      <div className="mobile-page-header">
        <div className="m-forum-thread-header">
          <Link
            href={`/m/forum?section=${encodeURIComponent(thread.sectionId)}`}
            className="m-forum-thread-back"
          >
            ← {thread.sectionTitle}
          </Link>
        </div>
        <h1 className="mobile-page-title" style={{ fontSize: "1.1rem", marginBottom: 0 }}>
          {thread.title}
        </h1>
        <p className="mobile-page-subtitle">
          by {thread.userScreenName} · {thread.postCount} posts · {thread.viewCount} views
        </p>
      </div>

      <div className="mobile-results-scroll">
        {/* Track Battle header */}
        {isTrackBattle && (
          <MobileTrackBattleHeader
            threadId={thread.id}
            video1Id={thread.video1Id!}
            video2Id={thread.video2Id!}
            videoMetadataMap={videoMetadataMap}
            isAuthenticated={isAuthenticated}
            initialVoteCounts={voteCounts}
            initialUserVote={userVote}
          />
        )}

        {/* Posts */}
        <div className="m-forum-posts-list">
          {localPosts.map((post, idx) => (
            <PostCard
              key={post.id}
              post={post}
              isOpeningPost={idx === 0}
              videoMetadataMap={videoMetadataMap}
            />
          ))}
        </div>

        {/* Reply form or locked notice */}
        {thread.isLocked ? (
          <div className="m-forum-locked-notice">
            <p>🔒 This thread is locked. New replies are not allowed.</p>
          </div>
        ) : isAuthenticated ? (
          <section className="m-forum-reply-panel" aria-label="Reply to thread">
            <h2 className="m-forum-reply-title">Post a reply</h2>
            <form className="m-forum-reply-form" onSubmit={handleReply}>
              <textarea
                id="m-forum-reply-content"
                rows={4}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="Write your reply..."
                required
                minLength={2}
                disabled={isSubmitting}
                className="m-forum-form-textarea"
              />
              {error && <p className="m-forum-reply-error">{error}</p>}
              <div className="m-forum-form-actions">
                <ForumFormToolbar
                  textareaId="m-forum-reply-content"
                  onInsert={setReplyContent}
                />
                <button type="submit" className="m-forum-submit-btn" disabled={isSubmitting}>
                  {isSubmitting ? "Posting..." : "Post reply"}
                </button>
              </div>
            </form>
          </section>
        ) : (
          <div className="m-forum-reply-auth">
            <p>Sign in to join the discussion.</p>
            <Link href="/m/login" className="m-forum-submit-btn">Sign in</Link>
          </div>
        )}
      </div>
    </MobileFixedScroll>
  );
}

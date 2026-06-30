"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { ForumThreadDetail, ThreadVoteCounts } from "@/lib/forum-data";
import { OverlayHeader } from "@/components/overlay-header";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { ForumFormToolbar } from "@/components/forum-form-toolbar";
import { ForumPostContent } from "@/components/forum-post-content";
import { ForumVideoEmbed, type VideoEmbedMetadata } from "@/components/forum-video-embed";

type ForumThreadContentProps = {
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

function getUserProfileHref(screenName: string, userId: number): string {
  return `/u/${encodeURIComponent(screenName)}`;
}

function PostCard({
  post,
  isOpeningPost,
  videoMetadataMap,
}: {
  post: ForumThreadDetail["posts"][number];
  isOpeningPost: boolean;
  videoMetadataMap?: Record<string, VideoEmbedMetadata> | null;
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
            <ForumPostContent content={post.content} videoMetadataMap={videoMetadataMap} />
          </div>
        </div>
      </div>
    </article>
  );
}

// ── Track Battle Header ──────────────────────────────────────────────────────

type BattleHeaderProps = {
  threadId: number;
  video1Id: string;
  video2Id: string;
  videoMetadataMap?: Record<string, VideoEmbedMetadata> | null;
  isAuthenticated: boolean;
  initialVoteCounts: ThreadVoteCounts | null | undefined;
  initialUserVote: number | null | undefined;
};

function TrackBattleHeader({
  threadId,
  video1Id,
  video2Id,
  videoMetadataMap,
  isAuthenticated,
  initialVoteCounts,
  initialUserVote,
}: BattleHeaderProps) {
  const [voteCounts, setVoteCounts] = useState<ThreadVoteCounts | null>(initialVoteCounts ?? null);
  const [userVote, setUserVote] = useState<number | null>(initialUserVote ?? null);
  const [isVoting, setIsVoting] = useState(false);

  // Fetch vote data on mount (handles hydration mismatch from server render)
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
    <section className="forumBattleHeader" aria-label="Track Battle">
      <div className="forumBattleVideos">
        <div className={`forumBattleVideo ${userVote === 1 ? "forumBattleVideoVoted" : ""}`}>
          <ForumVideoEmbed videoId={video1Id} metadata={videoMetadataMap?.[video1Id] ?? null} />
          <div className="forumBattleVoteBar">
            <div className="forumBattleVoteInfo">
              <span className="forumBattleVoteCount">{voteCounts?.votes1 ?? 0} votes</span>
              <span className="forumBattleVotePct">{pct1}%</span>
            </div>
            <div className="forumBattleVoteTrack">
              <div className="forumBattleVoteFill" style={{ width: `${pct1}%` }} />
            </div>
            {isAuthenticated ? (
              <button
                type="button"
                className={`forumBattleVoteButton ${userVote === 1 ? "forumBattleVoteButtonActive" : ""}`}
                onClick={() => handleVote(1)}
                disabled={isVoting}
              >
                {userVote === 1 ? "✓ Voted" : "Vote Track 1"}
              </button>
            ) : (
              <Link href="/login" className="forumBattleVoteButton">
                Sign in to vote
              </Link>
            )}
          </div>
        </div>

        <div className="forumBattleVs">
          <span>VS</span>
        </div>

        <div className={`forumBattleVideo ${userVote === 2 ? "forumBattleVideoVoted" : ""}`}>
          <ForumVideoEmbed videoId={video2Id} metadata={videoMetadataMap?.[video2Id] ?? null} />
          <div className="forumBattleVoteBar">
            <div className="forumBattleVoteInfo">
              <span className="forumBattleVoteCount">{voteCounts?.votes2 ?? 0} votes</span>
              <span className="forumBattleVotePct">{pct2}%</span>
            </div>
            <div className="forumBattleVoteTrack">
              <div className="forumBattleVoteFill" style={{ width: `${pct2}%` }} />
            </div>
            {isAuthenticated ? (
              <button
                type="button"
                className={`forumBattleVoteButton ${userVote === 2 ? "forumBattleVoteButtonActive" : ""}`}
                onClick={() => handleVote(2)}
                disabled={isVoting}
              >
                {userVote === 2 ? "✓ Voted" : "Vote Track 2"}
              </button>
            ) : (
              <Link href="/login" className="forumBattleVoteButton">
                Sign in to vote
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Main Thread Content ─────────────────────────────────────────────────────

export function ForumThreadContent({ threadDetail, isAuthenticated, videoMetadataMap }: ForumThreadContentProps) {
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
    <>
      <OverlayScrollReset />
      <OverlayHeader
        title={thread.title}
        breadcrumb={
          <>
            <Link href="/forum" className="categoryHeaderBreadcrumbLink">Forum</Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true"> / </span>
            <Link href={`/forum?section=${encodeURIComponent(thread.sectionId)}`} className="categoryHeaderBreadcrumbLink">{thread.sectionTitle}</Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">/&nbsp;</span>
          </>
        }
      />

      <main className="forumThreadPage" role="main" aria-label={`Thread: ${thread.title}`}>
        {/* Track Battle header */}
        {isTrackBattle && (
          <TrackBattleHeader
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
        <div className="forumPostsList">
          {localPosts.map((post, idx) => (
            <PostCard
              key={post.id}
              post={post}
              isOpeningPost={idx === 0}
              videoMetadataMap={videoMetadataMap}
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
                id="forumReplyContent"
                rows={4}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="Write your reply..."
                required
                minLength={2}
                disabled={isSubmitting}
              />
              {error && <p className="forumReplyError">{error}</p>}
              <div className="forumToolbar">
                <ForumFormToolbar
                  textareaId="forumReplyContent"
                  onInsert={setReplyContent}
                />
                <button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Posting..." : "Post reply"}
                </button>
              </div>
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

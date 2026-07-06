"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { ForumThreadSummary } from "@/lib/forum-data";
import { FORUM_SECTIONS } from "@/lib/forum-sections";
import { OverlayHeader } from "@/components/overlay-header";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { ForumFormToolbar } from "@/components/forum-form-toolbar";

type ForumPageContentProps = {
  latestThreads: ForumThreadSummary[];
  isAuthenticated: boolean;
  /** The currently selected section ID from the URL, or null for "Latest" */
  selectedSectionId: string | null;
};

/** Format a date for forum display: "Jun 12, 2:30 PM" style */
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

function formatAbsoluteDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${month} ${day}, ${displayHours}:${minutes} ${ampm}`;
}

function ThreadCard({ thread }: { thread: ForumThreadSummary }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const replyCount = Math.max(0, thread.postCount - 1);
  const href = thread.slug
    ? `/forum/thread/${thread.slug}`
    : `/forum/thread/${thread.id}`;
  const displayDate = mounted ? formatForumDate(thread.createdAt) : formatAbsoluteDate(thread.createdAt);
  const displayLatest = thread.latestPostAt
    ? (mounted ? formatForumDate(thread.latestPostAt) : formatAbsoluteDate(thread.latestPostAt))
    : null;

  return (
    <div
      className="forumThreadCard"
      role="link"
      tabIndex={0}
      aria-label={`Thread: ${thread.title}`}
      onClick={() => router.push(href)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(href); } }}
    >
      <div className="forumThreadCardMain">
        <div className="forumThreadCardLeft">
          {thread.userAvatarUrl ? (
            <Image
              src={thread.userAvatarUrl}
              alt=""
              width={36}
              height={36}
              className="forumThreadAvatar"
              unoptimized
            />
          ) : (
            <span className="forumThreadAvatarPlaceholder" aria-hidden="true">
              {thread.userScreenName.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="forumThreadCardBody">
          <h3 className="forumThreadCardTitle">
            {thread.isPinned && <span className="forumPinnedBadge" title="Pinned">📌 </span>}
            {thread.title}
            {thread.isLocked && <span className="forumLockedBadge" title="Locked"> 🔒</span>}
          </h3>
          <div className="forumThreadCardMeta">
            <span
              className="forumThreadAuthor"
              role="link"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                router.push(getUserProfileHref(thread.userScreenName, thread.userId));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  router.push(getUserProfileHref(thread.userScreenName, thread.userId));
                }
              }}
            >
              {thread.userScreenName}
            </span>
            <span className="forumMetaSep">·</span>
            <span className="forumThreadTimestamp">{displayDate}</span>
            <span className="forumMetaSep">·</span>
            <span className="forumThreadSection">{thread.sectionTitle}</span>
          </div>
        </div>
      </div>
      <div className="forumThreadCardStats">
        <span className="forumStat" title={`${replyCount} replies`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {replyCount}
        </span>
        <span className="forumStat" title={`${thread.viewCount} views`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {thread.viewCount}
        </span>
        {thread.latestPostAt && (
          <span className="forumStat forumLatestPost" title="Latest reply">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {displayLatest}
          </span>
        )}
      </div>
    </div>
  );
}

export function ForumPageContent({ latestThreads, isAuthenticated, selectedSectionId }: ForumPageContentProps) {
  const [showNewThreadForm, setShowNewThreadForm] = useState(false);

  const selectedSection = selectedSectionId
    ? FORUM_SECTIONS.find((s) => s.id === selectedSectionId) ?? null
    : null;

  const displayThreads = selectedSectionId
    ? latestThreads.filter((t) => t.sectionId === selectedSectionId)
    : latestThreads;

  return (
    <>
      <OverlayScrollReset />
      <OverlayHeader
        title={selectedSection ? selectedSection.title : "Latest Threads"}
        breadcrumb={
          selectedSection ? (
            <>
              <Link href="/forum" className="categoryHeaderBreadcrumbLink">Forum</Link>
              <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">{" /\u00A0"}</span>
            </>
          ) : (
            <>
              <span className="categoryHeaderBreadcrumbCurrent">Forum</span>
              <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">{" /\u00A0"}</span>
            </>
          )
        }
        actions={
          selectedSection ? (
            isAuthenticated ? (
              <button
                type="button"
                className="forumNewThreadButton"
                onClick={() => setShowNewThreadForm(!showNewThreadForm)}
                aria-expanded={showNewThreadForm}
              >
                {showNewThreadForm ? "Cancel" : "+ New Thread"}
              </button>
            ) : (
              <Link href="/login" className="forumNewThreadButton">
                Sign in to post
              </Link>
            )
          ) : undefined
        }
      />

      <main className="forumPage" role="main" aria-label="Forum">

        {/* New thread form (hidden by default, shown on button click) */}
        {selectedSection && showNewThreadForm && isAuthenticated && (
          <section className="forumContributePanel panel" aria-label="Start a new thread">
            <form className="forumContributeForm" onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              const title = formData.get("title") as string;
              const content = formData.get("content") as string;
              const isTrackBattle = selectedSectionId === "track-battles";
              const video1Raw = isTrackBattle ? (formData.get("video1") as string) : null;
              const video2Raw = isTrackBattle ? (formData.get("video2") as string) : null;

              // Parse video IDs (plain ID, youtube URL, yehthatrocks URL)
              const parseVideoId = (input: string | null): string | null => {
                if (!input) return null;
                const trimmed = input.trim();
                if (!trimmed) return null;
                const plainMatch = trimmed.match(/^[\w-]{11}$/);
                if (plainMatch) return plainMatch[0];
                const urlMatch = trimmed.match(/[?&]v=([\w-]{11})/) || trimmed.match(/youtu\.be\/([\w-]{11})/);
                if (urlMatch) return urlMatch[1];
                return null;
              };
              const video1Id = parseVideoId(video1Raw);
              const video2Id = parseVideoId(video2Raw);

              if (isTrackBattle && (!video1Id || !video2Id)) {
                alert("Both video IDs are required for a track battle. Enter a Video ID or yehthatrocks URL for each.");
                return;
              }

              fetch("/api/forum/threads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sectionId: selectedSectionId,
                  title: title.trim(),
                  content: content.trim(),
                  ...(isTrackBattle ? { video1Id, video2Id } : {}),
                }),
              })
                .then(async (res) => {
                  if (!res.ok) {
                    let msg = `Server returned ${res.status}`;
                    try {
                      const body = await res.json();
                      if (body.error) msg = body.error;
                    } catch { /* ignore parse errors */ }
                    throw new Error(msg);
                  }
                  return res.json();
                })
                .then((data) => {
                  const threadUrl = data.thread.slug
                    ? `/forum/thread/${data.thread.slug}`
                    : `/forum/thread/${data.thread.id}`;
                  window.location.href = threadUrl;
                })
                .catch((err) => {
                  alert(err.message || "Failed to create thread");
                });
            }}>
              <label>
                <span>Thread title</span>
                <input
                  type="text"
                  name="title"
                  placeholder="Give your thread a descriptive title"
                  required
                  minLength={3}
                  maxLength={255}
                />
              </label>

              {/* Track battle video inputs */}
              {selectedSectionId === "track-battles" && (
                <>
                  <label>
                    <span>Track 1 — Video ID or URL</span>
                    <input
                      type="text"
                      name="video1"
                      placeholder="Video ID or yehthatrocks URL"
                      required
                    />
                  </label>
                  <label>
                    <span>Track 2 — Video ID or URL</span>
                    <input
                      type="text"
                      name="video2"
                      placeholder="Video ID or yehthatrocks URL"
                      required
                    />
                  </label>
                </>
              )}

              <label>
                <span>Opening post</span>
                <textarea
                  id="forumNewThreadContent"
                  rows={5}
                  name="content"
                  placeholder={selectedSectionId === "track-battles" ? "Make your case for which track is better..." : "Start the discussion..."}
                  required
                  minLength={10}
                />
              </label>
              <div className="forumToolbar">
                <ForumFormToolbar
                  textareaId="forumNewThreadContent"
                  onInsert={() => {}}
                />
                <button type="submit">Post thread</button>
              </div>
            </form>
          </section>
        )}

        {/* Thread list */}
        <section className="forumThreadList" aria-label={selectedSection ? `Threads in ${selectedSection.title}` : "Latest threads"}>
          {displayThreads.length === 0 ? (
            <div className="forumEmptyState panel">
              <p>No threads yet in this section.</p>
              {isAuthenticated && selectedSection && (
                <button
                  type="button"
                  className="forumNewThreadButton"
                  onClick={() => setShowNewThreadForm(true)}
                >
                  Start the first thread
                </button>
              )}
            </div>
          ) : (
            displayThreads.map((thread) => (
              <ThreadCard key={thread.id} thread={thread} />
            ))
          )}
        </section>
      </main>
    </>
  );
}
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { ForumThreadSummary } from "@/lib/forum-data";
import { FORUM_SECTIONS } from "@/lib/forum-sections";
import { MobileFixedScroll } from "@/components/mobile/mobile-fixed-scroll";
import { ForumFormToolbar } from "@/components/forum-form-toolbar";

type MobileForumSectionPageProps = {
  latestThreads: ForumThreadSummary[];
  isAuthenticated: boolean;
  selectedSectionId: string | null;
};

/** Format a date for mobile forum display */
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
    ? `/m/forum/thread/${thread.slug}`
    : `/m/forum/thread/${thread.id}`;
  const displayDate = mounted ? formatForumDate(thread.createdAt) : formatAbsoluteDate(thread.createdAt);

  return (
    <div
      className="m-forum-thread-card"
      role="link"
      tabIndex={0}
      aria-label={`Thread: ${thread.title}`}
      onClick={() => router.push(href)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(href); } }}
    >
      <div className="m-forum-thread-title">
        {thread.isPinned && <span className="m-forum-pinned" title="Pinned">📌 </span>}
        {thread.title}
        {thread.isLocked && <span className="m-forum-locked" title="Locked"> 🔒</span>}
      </div>
      <div className="m-forum-thread-meta">
        <span className="m-forum-thread-author">
          {thread.userScreenName}
        </span>
        <span>·</span>
        <span>{displayDate}</span>
        <span>·</span>
        <span>{thread.sectionTitle}</span>
      </div>
      <div className="m-forum-thread-stats">
        <span title={`${replyCount} replies`}>
          💬 {replyCount}
        </span>
        <span title={`${thread.viewCount} views`}>
          👁 {thread.viewCount}
        </span>
      </div>
    </div>
  );
}

export function MobileForumSectionPage({
  latestThreads,
  isAuthenticated,
  selectedSectionId,
}: MobileForumSectionPageProps) {
  const [showNewThreadForm, setShowNewThreadForm] = useState(false);

  const selectedSection = selectedSectionId
    ? FORUM_SECTIONS.find((s) => s.id === selectedSectionId) ?? null
    : null;

  const displayThreads = latestThreads.filter((t) => t.sectionId === selectedSectionId);

  return (
    <MobileFixedScroll>
      <div className="mobile-page-header">
        <div className="m-forum-header-row">
          <div>
             <>
                <Link href="/m?tab=forum" className="m-forum-breadcrumb">Forum</Link>
                <span className="m-forum-breadcrumb-sep"> / </span>
                <h1 className="mobile-page-title" style={{ display: "inline", fontSize: "1.1rem" }}>
                  {selectedSection?.title ?? "Forum"}
                </h1>
              </>
            {selectedSection && (
              <p className="mobile-page-subtitle">{selectedSection.description}</p>
            )}
          </div>
          {selectedSection && (
            isAuthenticated ? (
              <button
                type="button"
                className="m-forum-new-thread-btn"
                onClick={() => setShowNewThreadForm(!showNewThreadForm)}
                aria-expanded={showNewThreadForm}
              >
                {showNewThreadForm ? "Cancel" : "+ New"}
              </button>
            ) : (
              <Link href="/m/login" className="m-forum-new-thread-btn">
                Sign in
              </Link>
            )
          )}
        </div>
      </div>

      <div className="mobile-results-scroll">
        {/* New thread form */}
        {selectedSection && showNewThreadForm && isAuthenticated && (
          <section className="m-forum-new-thread-panel" aria-label="Start a new thread">
            <form className="m-forum-new-thread-form" onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              const title = formData.get("title") as string;
              const content = formData.get("content") as string;
              const isTrackBattle = selectedSectionId === "track-battles";
              const video1Raw = isTrackBattle ? (formData.get("video1") as string) : null;
              const video2Raw = isTrackBattle ? (formData.get("video2") as string) : null;

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
                alert("Both video IDs are required for a track battle.");
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
                    } catch { /* ignore */ }
                    throw new Error(msg);
                  }
                  return res.json();
                })
                .then((data) => {
                  const threadUrl = data.thread.slug
                    ? `/m/forum/thread/${data.thread.slug}`
                    : `/m/forum/thread/${data.thread.id}`;
                  window.location.href = threadUrl;
                })
                .catch((err) => {
                  alert(err.message || "Failed to create thread");
                });
            }}>
              <label className="m-forum-form-label">
                <span>Thread title</span>
                <input
                  type="text"
                  name="title"
                  placeholder="Give your thread a descriptive title"
                  required
                  minLength={3}
                  maxLength={255}
                  className="m-forum-form-input"
                />
              </label>

              {selectedSectionId === "track-battles" && (
                <>
                  <label className="m-forum-form-label">
                    <span>Track 1 — Video ID or URL</span>
                    <input
                      type="text"
                      name="video1"
                      placeholder="Video ID or yehthatrocks URL"
                      required
                      className="m-forum-form-input"
                    />
                  </label>
                  <label className="m-forum-form-label">
                    <span>Track 2 — Video ID or URL</span>
                    <input
                      type="text"
                      name="video2"
                      placeholder="Video ID or yehthatrocks URL"
                      required
                      className="m-forum-form-input"
                    />
                  </label>
                </>
              )}

              <label className="m-forum-form-label">
                <span>Opening post</span>
                <textarea
                  id="m-forum-new-thread-content"
                  rows={5}
                  name="content"
                  placeholder={selectedSectionId === "track-battles" ? "Make your case for which track is better..." : "Start the discussion..."}
                  required
                  minLength={10}
                  className="m-forum-form-textarea"
                />
              </label>
              <div className="m-forum-form-actions">
                <ForumFormToolbar
                  textareaId="m-forum-new-thread-content"
                  onInsert={() => {}}
                />
                <button type="submit" className="m-forum-submit-btn">Post thread</button>
              </div>
            </form>
          </section>
        )}

        {/* Thread list */}
        {selectedSectionId && (
          <section className="m-forum-thread-list" aria-label={`Threads in ${selectedSection?.title ?? "section"}`}>
            {displayThreads.length === 0 ? (
              <div className="mobile-empty-state">
                <p>No threads yet in this section.</p>
                {isAuthenticated && (
                  <button
                    type="button"
                    className="m-forum-new-thread-btn"
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
        )}
      </div>
    </MobileFixedScroll>
  );
}

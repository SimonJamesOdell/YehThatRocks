"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import type { ForumThreadSummary } from "@/lib/forum-data";
import { FORUM_SECTIONS } from "@/lib/forum-sections";
import { OverlayHeader } from "@/components/overlay-header";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";

type ForumPageContentProps = {
  latestThreads: ForumThreadSummary[];
  isAuthenticated: boolean;
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

function ThreadCard({ thread }: { thread: ForumThreadSummary }) {
  return (
    <Link
      href={`/forum/thread/${thread.id}`}
      className="forumThreadCard"
      aria-label={`Thread: ${thread.title}`}
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
            <Link
              href={getUserProfileHref(thread.userScreenName, thread.userId)}
              className="forumThreadAuthor"
              onClick={(e) => e.stopPropagation()}
            >
              {thread.userScreenName}
            </Link>
            <span className="forumMetaSep">·</span>
            <span className="forumThreadTimestamp">{formatForumDate(thread.createdAt)}</span>
            <span className="forumMetaSep">·</span>
            <span className="forumThreadSection">{thread.sectionTitle}</span>
          </div>
        </div>
      </div>
      <div className="forumThreadCardStats">
        <span className="forumStat" title={`${thread.postCount} replies`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {thread.postCount}
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
            {formatForumDate(thread.latestPostAt)}
          </span>
        )}
      </div>
    </Link>
  );
}

function SectionCard({
  section,
  isSelected,
  onClick,
}: {
  section: { id: string; title: string; description: string };
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`forumSectionCardButton ${isSelected ? "forumSectionCardSelected" : ""}`}
      onClick={onClick}
      aria-pressed={isSelected}
      aria-label={`Browse ${section.title}`}
    >
      <h2>{section.title}</h2>
      <p>{section.description}</p>
    </button>
  );
}

export function ForumPageContent({ latestThreads, isAuthenticated }: ForumPageContentProps) {
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
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
      <OverlayHeader title="Forum" />

      <main className="forumPage" role="main" aria-label="Forum">
        {/* Section navigation */}
        <section className="forumSectionGrid panel" aria-label="Forum sections">
          <button
            type="button"
            className={`forumSectionCardButton ${!selectedSectionId ? "forumSectionCardSelected" : ""}`}
            onClick={() => { setSelectedSectionId(null); setShowNewThreadForm(false); }}
            aria-pressed={!selectedSectionId}
            aria-label="All sections"
          >
            <h2>All Sections</h2>
            <p>Latest discussions across every forum category</p>
          </button>
          {FORUM_SECTIONS.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              isSelected={selectedSectionId === section.id}
              onClick={() => {
                setSelectedSectionId(section.id);
                setShowNewThreadForm(false);
              }}
            />
          ))}
        </section>

        {/* Section header + new thread button */}
        {selectedSection && (
          <div className="forumSectionHeader">
            <div>
              <h2 className="forumSectionHeaderTitle">{selectedSection.title}</h2>
              <p className="forumSectionHeaderDesc">{selectedSection.description}</p>
            </div>
            {isAuthenticated && (
              <button
                type="button"
                className="forumNewThreadButton"
                onClick={() => setShowNewThreadForm(!showNewThreadForm)}
                aria-expanded={showNewThreadForm}
              >
                {showNewThreadForm ? "Cancel" : "+ New Thread"}
              </button>
            )}
            {!isAuthenticated && (
              <Link href="/login" className="forumNewThreadButton">
                Sign in to post
              </Link>
            )}
          </div>
        )}

        {/* New thread form (hidden by default, shown on button click) */}
        {selectedSection && showNewThreadForm && isAuthenticated && (
          <section className="forumContributePanel panel" aria-label="Start a new thread">
            <div className="forumContributeHeader">
              <h2>New thread in {selectedSection.title}</h2>
            </div>
            <form className="forumContributeForm" onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              const title = formData.get("title") as string;
              const content = formData.get("content") as string;

              fetch("/api/forum/threads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sectionId: selectedSectionId,
                  title: title.trim(),
                  content: content.trim(),
                }),
              })
                .then((res) => {
                  if (!res.ok) throw new Error("Failed to create thread");
                  return res.json();
                })
                .then((data) => {
                  window.location.href = `/forum/thread/${data.thread.id}`;
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
              <label>
                <span>Opening post</span>
                <textarea
                  rows={5}
                  name="content"
                  placeholder="Start the discussion..."
                  required
                  minLength={10}
                />
              </label>
              <button type="submit">Post thread</button>
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

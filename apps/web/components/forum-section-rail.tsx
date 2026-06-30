"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { ForumSectionSummary } from "@/app/api/forum/sections/route";

type ForumSectionRailProps = {
  /** Whether the forum page overlay is currently open */
  isForumOpen: boolean;
};

export function ForumSectionRail({ isForumOpen }: ForumSectionRailProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sections, setSections] = useState<ForumSectionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const activeSectionId = searchParams.get("section");

  useEffect(() => {
    let cancelled = false;
    async function fetchSections() {
      try {
        const res = await fetch("/api/forum/sections");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setSections(data.sections ?? []);
      } catch {
        // Silent — rail section data is supplementary
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchSections();
    return () => { cancelled = true; };
  }, []);

  // Re-fetch when forum overlay closes (so the counts refresh)
  useEffect(() => {
    if (!isForumOpen) {
      setLoading(true);
      let cancelled = false;
      async function refetch() {
        try {
          const res = await fetch("/api/forum/sections");
          if (!res.ok) return;
          const data = await res.json();
          if (!cancelled) setSections(data.sections ?? []);
        } catch { /* silent */ }
        finally { if (!cancelled) setLoading(false); }
      }
      // Small delay so the close animation finishes
      const timer = setTimeout(refetch, 500);
      return () => { cancelled = true; clearTimeout(timer); };
    }
  }, [isForumOpen]);

  const handleSectionClick = (sectionId: string) => {
    // Mark section as seen (fire-and-forget)
    fetch(`/api/forum/sections/${encodeURIComponent(sectionId)}/seen`, { method: "POST" })
      .catch(() => { /* best-effort */ });

    router.push(`/forum?section=${encodeURIComponent(sectionId)}`);

    // Optimistically clear new indicators
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, newThreads: 0, updatedThreads: 0 } : s,
      ),
    );
  };

  const handleAllClick = () => {
    router.push("/forum");
  };

  const totalNew = sections.reduce((sum, s) => sum + s.newThreads + s.updatedThreads, 0);

  if (loading) {
    return (
      <div className="forumRailLoading">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="forumRailSkeleton" />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* "Latest Threads" — all sections */}
      <article
        className={`chatMessage forumSectionCard chatMessageClickable${!activeSectionId ? " forumSectionActive" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Latest threads from all sections"
        onClick={handleAllClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleAllClick(); } }}
      >
        <div>
          <div className="messageMeta">
            <strong>Latest Threads</strong>
            <span className="chatMessageMetaRight">
              {totalNew > 0 && (
                <span className="forumNewBadge">{totalNew} new</span>
              )}
            </span>
          </div>
          <p>All recent discussions across every forum section</p>
        </div>
      </article>

      {sections.map((section) => {
        const newTotal = section.newThreads + section.updatedThreads;
        return (
          <article
            key={section.id}
            className={`chatMessage forumSectionCard chatMessageClickable${activeSectionId === section.id ? " forumSectionActive" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`${section.title} — ${section.threadCount} threads${newTotal > 0 ? `, ${newTotal} new` : ""}`}
            onClick={() => handleSectionClick(section.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSectionClick(section.id); } }}
          >
            <div>
              <div className="messageMeta">
                <strong>{section.title}</strong>
                <span className="chatMessageMetaRight">
                  {newTotal > 0 && (
                    <span className="forumNewBadge">{newTotal} new</span>
                  )}
                  <span className="chatMessageTimestamp">{section.threadCount}</span>
                </span>
              </div>
              <p>{section.description}</p>
            </div>
          </article>
        );
      })}
    </>
  );
}

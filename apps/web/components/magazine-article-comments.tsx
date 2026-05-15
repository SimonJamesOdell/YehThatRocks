"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { parseJsonOrNull } from "@/lib/parse-json";

type MagazineArticleCommentsProps = {
  slug: string;
};

type MagazineArticleComment = {
  id: number;
  articleSlug: string;
  userId: number;
  content: string;
  moderationStatus: string;
  moderationLabel: string | null;
  moderationReason: string | null;
  createdAt: string;
  authorDisplayName: string;
  authorScreenName?: string | null;
  authorAvatarUrl?: string | null;
  isOwnComment: boolean;
};

type MagazineArticleCommentsResponse = {
  ok: boolean;
  comments: MagazineArticleComment[];
};

type MagazineArticleCommentPostResponse = {
  ok: boolean;
  comment: MagazineArticleComment;
  submissionState: "published" | "review";
  message: string;
};

export function MagazineArticleComments({ slug }: MagazineArticleCommentsProps) {
  const [comments, setComments] = useState<MagazineArticleComment[]>([]);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  const hasComments = comments.length > 0;

  const loadComments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/magazine/${encodeURIComponent(slug)}/comments`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        const payload = (await parseJsonOrNull(response)) as { error?: string } | null;
        throw new Error(payload?.error || `Request failed (${response.status})`);
      }

      const payload = (await response.json()) as MagazineArticleCommentsResponse;
      setComments(payload.comments ?? []);
      setAuthRequired(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load comments.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  async function submitComment() {
    const trimmed = content.trim();

    if (!trimmed) {
      setNotice("Write a comment first.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/magazine/${encodeURIComponent(slug)}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });

      if (response.status === 401) {
        setAuthRequired(true);
        setNotice("Please sign in to comment.");
        return;
      }

      if (!response.ok) {
        const payload = (await parseJsonOrNull(response)) as { error?: string } | null;
        throw new Error(payload?.error || `Request failed (${response.status})`);
      }

      const payload = (await response.json()) as MagazineArticleCommentPostResponse;
      setContent("");
      setNotice(payload.message);
      setAuthRequired(false);
      await loadComments();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit comment.");
    } finally {
      setSubmitting(false);
    }
  }

  function getAvatarInitial(displayName: string) {
    const trimmed = displayName.trim();
    return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
  }

  return (
    <section className="panel magazineCommentsSection" aria-label="Article comments">
      <div className="panelHeading magazineCommentsHeading">
        <span>Comments</span>
        {!loading && !hasComments ? <strong className="magazineCommentsHeadingStatus">No comments yet.</strong> : null}
      </div>

      <div className="interactiveStack magazineCommentsComposer">
        {loading ? <p className="authMessage magazineCommentsStatus">Loading comments...</p> : null}

        {!loading && hasComments ? (
          <div className="interactiveStack magazineCommentsList">
            {comments.map((comment) => {
              const cardClassName = `magazineCommentCard ${comment.isOwnComment ? "magazineCommentCardOwn" : ""}`;
              const cardInner = (
                <>
                  <header className="magazineCommentCardHeader">
                    <div className="magazineCommentAuthorMeta">
                      {comment.authorAvatarUrl ? (
                        <img
                          src={comment.authorAvatarUrl}
                          alt={`${comment.authorDisplayName} avatar`}
                          className="magazineCommentAvatar"
                          loading="lazy"
                        />
                      ) : (
                        <span className="magazineCommentAvatarFallback" aria-hidden="true">
                          {getAvatarInitial(comment.authorDisplayName)}
                        </span>
                      )}
                      <strong className="magazineCommentAuthor">{comment.authorDisplayName}</strong>
                    </div>
                    <small className="authMessage magazineCommentTimestamp">{new Date(comment.createdAt).toLocaleString()}</small>
                  </header>
                  <p className="magazineCommentBody">{comment.content}</p>
                  {comment.isOwnComment && comment.moderationStatus !== "public" ? (
                    <p className="authMessage magazineCommentReviewNote">Visible to you while under review.</p>
                  ) : null}
                </>
              );

              const hasStableUserId = Number.isInteger(comment.userId) && comment.userId > 0;
              const fallbackScreenName = (comment.authorScreenName ?? "").trim();
              const profileSlug = hasStableUserId
                ? `user-${comment.userId}`
                : fallbackScreenName.length > 0
                  ? fallbackScreenName
                  : null;

              if (profileSlug) {
                return (
                  <Link
                    key={comment.id}
                    href={`/u/${encodeURIComponent(profileSlug)}`}
                    className={`${cardClassName} magazineCommentCardLink`}
                    aria-label={`View ${comment.authorDisplayName} profile`}
                  >
                    {cardInner}
                  </Link>
                );
              }

              return (
                <article key={comment.id} className={cardClassName}>
                  {cardInner}
                </article>
              );
            })}
          </div>
        ) : null}

        <label htmlFor="magazine-comment-textarea" className="authMessage magazineCommentsLabel">
          Add a comment
        </label>
        <textarea
          id="magazine-comment-textarea"
          className="magazineCommentsTextarea"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Share your take on this article"
        />
        <div className="magazineCommentsComposerRow">
          <span className="authMessage magazineCommentsCount">{content.length}/2000</span>
          <button type="button" className="magazineCommentsSubmitButton" onClick={() => void submitComment()} disabled={submitting}>
            {submitting ? "Submitting..." : "Post comment"}
          </button>
        </div>

        {authRequired ? (
          <p className="authMessage magazineCommentsStatus magazineCommentsStatusInfo">
            You need an account to post. <Link href="/login">Sign in</Link>
          </p>
        ) : null}
        {notice ? <p className="authMessage magazineCommentsStatus magazineCommentsStatusInfo">{notice}</p> : null}
        {error ? <p className="authMessage magazineCommentsStatus magazineCommentsStatusError">{error}</p> : null}
      </div>
    </section>
  );
}

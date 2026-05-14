import Link from "next/link";

import type {
  AdminMagazineArticleRow,
  AdminMagazineCommentModerationAction,
  AdminMagazineCommentModerationRow,
} from "@/components/admin-dashboard-types";

type AdminDashboardMagazineTabProps = {
  magazineArticles: AdminMagazineArticleRow[];
  moderationQueue: AdminMagazineCommentModerationRow[];
  moderatingCommentId: number | null;
  deleteModalSlug: string | null;
  onSetDeleteModalSlug: (slug: string | null) => void;
  onDeleteArticle: (slug: string) => Promise<void>;
  onModerateComment: (commentId: number, action: AdminMagazineCommentModerationAction) => Promise<void>;
};

export function AdminDashboardMagazineTab({
  magazineArticles,
  moderationQueue,
  moderatingCommentId,
  deleteModalSlug,
  onSetDeleteModalSlug,
  onDeleteArticle,
  onModerateComment,
}: AdminDashboardMagazineTabProps) {
  return (
    <div className="interactiveStack">
      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Magazine Articles</span>
          <strong>{magazineArticles.length} rows</strong>
        </div>
        <div className="interactiveStack" style={{ gap: 8 }}>
          {magazineArticles.length === 0 ? <p className="authMessage">No magazine articles found.</p> : null}
          {magazineArticles.map((article) => (
            <div
              key={article.slug}
              style={{
                display: "grid",
                gridTemplateColumns: "72px minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 10,
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 10,
                padding: 8,
                background: "rgba(0,0,0,0.22)",
              }}
            >
              {article.videoId ? (
                <img
                  src={`https://i.ytimg.com/vi/${article.videoId}/mqdefault.jpg`}
                  alt={article.title}
                  style={{ width: 72, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)" }}
                />
              ) : (
                <div style={{ width: 72, height: 40, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)" }} />
              )}

              <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{article.title}</strong>
                <span className="authMessage" style={{ margin: 0 }}>
                  External landings (all time): {article.externalLandings.toLocaleString()}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Link href={`/admin/magazine/${encodeURIComponent(article.slug)}`} className="navLink navLinkActive">
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={() => onSetDeleteModalSlug(article.slug)}
                  style={{
                    borderRadius: 999,
                    border: "1px solid rgba(255, 105, 97, 0.72)",
                    background: "rgba(102, 10, 10, 0.55)",
                    color: "#ffd8d3",
                    padding: "6px 11px",
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Comment Moderation Queue</span>
          <strong>{moderationQueue.length} pending</strong>
        </div>
        <div className="interactiveStack" style={{ gap: 8 }}>
          {moderationQueue.length === 0 ? <p className="authMessage">No comments pending review.</p> : null}
          {moderationQueue.map((comment) => (
            <div
              key={comment.id}
              style={{
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 10,
                padding: 10,
                background: "rgba(0,0,0,0.22)",
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{comment.authorDisplayName}</strong>
                <span className="authMessage" style={{ margin: 0 }}>#{comment.id}</span>
              </div>
              <p className="authMessage" style={{ margin: 0 }}>
                /magazine/{comment.articleSlug} | {new Date(comment.createdAt).toLocaleString()}
              </p>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{comment.content}</p>
              <p className="authMessage" style={{ margin: 0 }}>
                Trigger: {comment.moderationLabel ?? "n/a"} | {comment.moderationReason ?? "No reason provided."}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={moderatingCommentId === comment.id}
                  onClick={() => void onModerateComment(comment.id, "approve")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={moderatingCommentId === comment.id}
                  onClick={() => void onModerateComment(comment.id, "keep_restricted")}
                >
                  Keep Restricted
                </button>
                <button
                  type="button"
                  disabled={moderatingCommentId === comment.id}
                  onClick={() => void onModerateComment(comment.id, "delete_comment")}
                  style={{
                    border: "1px solid rgba(255, 105, 97, 0.72)",
                    background: "rgba(102, 10, 10, 0.55)",
                    color: "#ffd8d3",
                  }}
                >
                  Delete Comment
                </button>
                <button
                  type="button"
                  disabled={moderatingCommentId === comment.id}
                  onClick={() => void onModerateComment(comment.id, "delete_user")}
                  style={{
                    border: "1px solid rgba(255, 105, 97, 0.85)",
                    background: "rgba(95, 8, 8, 0.8)",
                    color: "#ffd8d3",
                  }}
                >
                  Delete User
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {deleteModalSlug ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm article deletion"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.62)",
            display: "grid",
            placeItems: "center",
            zIndex: 160,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "linear-gradient(170deg, rgba(30,10,10,0.96), rgba(12,6,6,0.98))",
              boxShadow: "0 22px 52px rgba(0,0,0,0.45)",
              padding: 16,
              display: "grid",
              gap: 10,
            }}
          >
            <h3 style={{ margin: 0 }}>Delete article?</h3>
            <p className="authMessage" style={{ margin: 0 }}>
              This will permanently delete <strong>{deleteModalSlug}</strong>. This action cannot be undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => onSetDeleteModalSlug(null)}>Cancel</button>
              <button
                type="button"
                onClick={() => void onDeleteArticle(deleteModalSlug)}
                style={{
                  border: "1px solid rgba(255, 105, 97, 0.72)",
                  background: "rgba(102, 10, 10, 0.7)",
                  color: "#ffd8d3",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

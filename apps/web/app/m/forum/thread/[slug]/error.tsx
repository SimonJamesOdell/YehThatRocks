"use client";

import Link from "next/link";

export default function ForumThreadError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mobile-empty-state" style={{ padding: "32px 16px", textAlign: "center" }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Could not load thread</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--mobile-text-muted)", marginBottom: 16 }}>
        The database may be temporarily unavailable. Please try again.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <Link
          href="/m?tab=forum"
          style={{
            padding: "8px 18px",
            background: "var(--mobile-surface)",
            color: "var(--mobile-text)",
            border: "1px solid var(--mobile-border)",
            borderRadius: 8,
            fontSize: "0.85rem",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Back to forum
        </Link>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "8px 18px",
            background: "var(--mobile-accent)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

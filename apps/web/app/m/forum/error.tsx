"use client";

import Link from "next/link";

export default function ForumError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mobile-empty-state" style={{ padding: "32px 16px", textAlign: "center" }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Could not load forum</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--mobile-text-muted)", marginBottom: 16 }}>
        The database may be temporarily unavailable. Please try again.
      </p>
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
  );
}

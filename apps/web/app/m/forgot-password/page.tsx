"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function MobileForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Forgot Password</h1>
      </div>

      {sent ? (
        <div>
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <p style={{ color: "var(--mobile-text)", fontSize: "1rem", margin: "0 0 12px" }}>
              If an account with that email exists, we&apos;ve sent a password reset link.
            </p>
            <p style={{ color: "var(--mobile-text-muted)", fontSize: "0.85rem", margin: 0 }}>
              Check your inbox and follow the instructions.
            </p>
          </div>
          <Link
            href="/m/login"
            style={{
              display: "block",
              textAlign: "center",
              color: "var(--mobile-accent)",
              textDecoration: "none",
              marginTop: "12px",
            }}
          >
            Back to login
          </Link>
        </div>
      ) : (
        <form className="mobile-auth-form" onSubmit={handleSubmit}>
          {error && (
            <div className="mobile-auth-error">{error}</div>
          )}

          <div className="mobile-auth-field">
            <label className="mobile-auth-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="mobile-auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <button
            type="submit"
            className="mobile-auth-submit"
            disabled={loading}
          >
            {loading ? "Sending..." : "Send Reset Link"}
          </button>

          <p className="mobile-auth-link">
            <Link href="/m/login">Back to login</Link>
          </p>
        </form>
      )}
    </div>
  );
}

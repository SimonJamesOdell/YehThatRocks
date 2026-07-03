"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type UserInfo = {
  id: number;
  email: string | null;
  screenName: string | null;
};

export default function MobileAccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.status === 401) {
          if (!cancelled) setNeedsAuth(true);
          return;
        }
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        if (!cancelled && data.user) {
          setUser(data.user);
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      setNeedsAuth(true);
      router.push("/m");
    } catch {
      // Silently fail
    }
  }

  if (loading) {
    return (
      <div className="mobile-loading">
        <div className="mobile-loading-spinner" />
      </div>
    );
  }

  if (needsAuth || !user) {
    return (
      <div>
        <div className="mobile-page-header">
          <h1 className="mobile-page-title">Account</h1>
        </div>
        <div className="mobile-empty-state">
          <p>You are not logged in.</p>
          <a href="/m/login" style={{ color: "var(--mobile-accent)", textDecoration: "none", marginTop: "12px", display: "inline-block" }}>
            Log in →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Account</h1>
      </div>

      <div className="mobile-account-section">
        <p className="mobile-account-section-title">Screen Name</p>
        <p className="mobile-account-value">{user.screenName || "—"}</p>
      </div>

      <div className="mobile-account-section">
        <p className="mobile-account-section-title">Email</p>
        <p className="mobile-account-value">{user.email || "—"}</p>
      </div>

      <div className="mobile-account-section">
        <p className="mobile-account-section-title">User ID</p>
        <p className="mobile-account-value">#{user.id}</p>
      </div>

      <button type="button" className="mobile-account-button" onClick={handleLogout}>
        Log Out
      </button>
    </div>
  );
}

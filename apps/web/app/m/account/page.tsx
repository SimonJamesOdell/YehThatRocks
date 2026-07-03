"use client";

import { useEffect, useState } from "react";

type UserInfo = {
  id: number;
  email: string | null;
  screenName: string | null;
};

export default function MobileAccountPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.status === 401) {
          if (!cancelled) setChecked(true);
          return;
        }
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        if (!cancelled && data.user) {
          setUser(data.user);
          setChecked(true);
        }
      } catch {
        if (!cancelled) setChecked(true);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  function handleLogout() {
    fetch("/api/auth/logout", { method: "POST" })
      .finally(() => {
        window.location.href = "/m";
      });
  }

  // Optimistic default: show logged-out state immediately.
  // Only show the logged-in view once the auth check confirms it.
  if (checked && user) {
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

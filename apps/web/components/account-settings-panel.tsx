"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { AuthAccountActions } from "@/components/auth-account-actions";
import { AuthChangePasswordForm } from "@/components/auth-change-password-form";

type AccountUser = {
  id: number;
  email: string | null;
  emailVerifiedAt: string | Date | null;
  screenName: string | null;
  avatarUrl: string | null;
  bio?: string | null;
  location?: string | null;
};

type AccountSettingsPanelProps = {
  user: AccountUser;
};

type AccountHistoryItem = {
  video: {
    id: string;
    title: string;
    channelTitle: string;
  };
  lastWatchedAt: string;
  watchCount: number;
  maxProgressPercent: number;
};

type AccountTab = "details" | "security" | "history";

export function AccountSettingsPanel({ user }: AccountSettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<AccountTab>("details");
  const [screenName, setScreenName] = useState(user.screenName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [location, setLocation] = useState(user.location ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<AccountHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const avatarPreview = useMemo(() => {
    const trimmed = avatarUrl.trim();
    if (trimmed.length === 0) {
      return null;
    }

    return trimmed;
  }, [avatarUrl]);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      try {
        const response = await fetch("/api/auth/profile", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as { user?: Partial<AccountUser> } | null;
        if (cancelled || !payload?.user) {
          return;
        }

        setScreenName(payload.user.screenName ?? "");
        setAvatarUrl(payload.user.avatarUrl ?? "");
        setBio(payload.user.bio ?? "");
        setLocation(payload.user.location ?? "");
      } catch {
        // Keep server-provided fallback values.
      }
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "history") {
      return;
    }

    let cancelled = false;
    setIsHistoryLoading(true);
    setHistoryError(null);

    const loadHistory = async () => {
      try {
        const response = await fetch("/api/watch-history?limit=120", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          if (!cancelled) {
            setHistoryError("Could not load watch history.");
          }
          return;
        }

        const payload = (await response.json().catch(() => null)) as { history?: AccountHistoryItem[] } | null;
        if (!cancelled) {
          setHistoryItems(Array.isArray(payload?.history) ? payload.history : []);
        }
      } catch {
        if (!cancelled) {
          setHistoryError("Could not load watch history.");
        }
      } finally {
        if (!cancelled) {
          setIsHistoryLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  function formatWatchedAt(value: string) {
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) {
      return "Recently watched";
    }

    return timestamp.toLocaleString();
  }

  async function handleSaveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveMessage(null);
    setSaveError(null);
    setIsSaving(true);

    try {
      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          screenName,
          avatarUrl,
          bio,
          location,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { fieldErrors?: Record<string, string[]> } | string } | null;

        if (typeof payload?.error === "string") {
          setSaveError(payload.error);
        } else {
          setSaveError("Could not save your profile details.");
        }
        return;
      }

      const payload = (await response.json().catch(() => null)) as { user?: Partial<AccountUser> } | null;
      if (payload?.user) {
        setScreenName(payload.user.screenName ?? "");
        setAvatarUrl(payload.user.avatarUrl ?? "");
        setBio(payload.user.bio ?? "");
        setLocation(payload.user.location ?? "");
      }

      setSaveMessage("Profile updated.");
    } catch {
      setSaveError("Could not save your profile details.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <div className="railTabs accountTabs" role="tablist" aria-label="Account sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "details"}
          className={activeTab === "details" ? "activeTab" : undefined}
          onClick={() => setActiveTab("details")}
        >
          User details
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "security"}
          className={activeTab === "security" ? "activeTab" : undefined}
          onClick={() => setActiveTab("security")}
        >
          Security
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "history"}
          className={activeTab === "history" ? "activeTab" : undefined}
          onClick={() => setActiveTab("history")}
        >
          Watch history
        </button>
      </div>

      {activeTab === "details" ? (
        <form className="authForm accountDetailsForm" role="tabpanel" aria-label="User details" onSubmit={handleSaveDetails}>
            <div className="accountDetailsLayout">
              <div className="accountDetailsFields">
                <label>
                  <span>Email</span>
                  <input value={user.email ?? "No email"} disabled readOnly />
                </label>

                <label>
                  <span>Screen name</span>
                  <input
                    name="screenName"
                    value={screenName}
                    onChange={(event) => setScreenName(event.currentTarget.value)}
                    minLength={2}
                    maxLength={80}
                    required
                  />
                </label>

                <label>
                  <span>Avatar URL</span>
                  <input
                    name="avatarUrl"
                    value={avatarUrl}
                    onChange={(event) => setAvatarUrl(event.currentTarget.value)}
                    placeholder="https://example.com/my-avatar.jpg"
                    maxLength={500}
                  />
                </label>

                <label>
                  <span>Location</span>
                  <input
                    name="location"
                    value={location}
                    onChange={(event) => setLocation(event.currentTarget.value)}
                    placeholder="City, Country"
                    maxLength={120}
                  />
                </label>
              </div>

              <div className="accountAvatarPreviewWrap" aria-live="polite">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar preview" className="accountAvatarPreviewImage" loading="lazy" />
                ) : (
                  <div className="accountAvatarPreviewFallback" aria-hidden="true">👤</div>
                )}
                <p>Avatar preview</p>
              </div>
            </div>

            <label className="accountBioField">
              <span>Bio</span>
              <textarea
                name="bio"
                value={bio}
                onChange={(event) => setBio(event.currentTarget.value)}
                rows={3}
                maxLength={1200}
                placeholder="Tell people a little about yourself."
              />
            </label>

            <button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save details"}</button>
            {saveMessage ? <p className="authMessage">{saveMessage}</p> : null}
            {saveError ? <p className="authMessage">{saveError}</p> : null}
        </form>
      ) : activeTab === "security" ? (
        <div className="accountSecurityLayout" role="tabpanel" aria-label="Security">
          <div className="accountSecurityColumn">
            <h3 className="accountSecurityHeading">Change password</h3>
            <AuthChangePasswordForm />
          </div>
          {!user.emailVerifiedAt ? (
            <div className="accountSecurityColumn">
              <AuthAccountActions emailVerified={false} showLogout={false} />
            </div>
          ) : null}
        </div>
      ) : (
        <section className="panel featurePanel accountHistoryPanel" role="tabpanel" aria-label="Watch history">
          <div className="panelHeading">
            <span>Watch history</span>
            <strong>{historyItems.length} tracks</strong>
          </div>

          {isHistoryLoading ? <p className="authMessage">Loading watch history...</p> : null}
          {historyError ? <p className="authMessage">{historyError}</p> : null}

          {!isHistoryLoading && !historyError && historyItems.length === 0 ? (
            <p className="authMessage">No watch history yet. Play a few tracks and they will appear here.</p>
          ) : null}

          {!isHistoryLoading && !historyError && historyItems.length > 0 ? (
            <ul className="accountHistoryList">
              {historyItems.map((entry) => (
                <li key={`${entry.video.id}:${entry.lastWatchedAt}`}>
                  <Link href={`/?v=${encodeURIComponent(entry.video.id)}`} className="accountHistoryLink">
                    <strong>{entry.video.title}</strong>
                    <span>{entry.video.channelTitle}</span>
                    <span>{formatWatchedAt(entry.lastWatchedAt)} • {entry.watchCount} plays • {Math.round(entry.maxProgressPercent)}%</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </>
  );
}

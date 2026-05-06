"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { AuthAccountActions } from "@/components/auth-account-actions";
import { AutoplaySettingsEditor } from "@/components/autoplay-settings-editor";
import { AuthChangePasswordForm } from "@/components/auth-change-password-form";
import { AvatarCropModal } from "@/components/avatar-crop-modal";
import { BlockedVideosInfiniteList } from "@/components/blocked-videos-infinite-list";
import { UpgradeToEmailForm } from "@/components/upgrade-to-email-form";
import type { HiddenVideoEntry } from "@/lib/catalog-data";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

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
  initialBlockedVideos: HiddenVideoEntry[];
  initialBlockedHasMore: boolean;
  blockedPageSize?: number;
};

type AccountTab = "details" | "security" | "autoplay" | "blocked";

export function AccountSettingsPanel({
  user,
  initialBlockedVideos,
  initialBlockedHasMore,
  blockedPageSize = 24,
}: AccountSettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<AccountTab>("details");
  const [screenName, setScreenName] = useState(user.screenName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [location, setLocation] = useState(user.location ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  const avatarPreview = useMemo(() => {
    const trimmed = avatarUrl.trim();
    if (trimmed.length === 0) {
      return null;
    }

    return trimmed;
  }, [avatarUrl]);

  useEffect(() => {
    const controller = new AbortController();

    const loadProfile = async () => {
      try {
        const response = await fetchWithAuthRetry("/api/auth/profile", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as { user?: Partial<AccountUser> } | null;
        if (controller.signal.aborted || !payload?.user) {
          return;
        }

        setScreenName(payload.user.screenName ?? "");
        setAvatarUrl(payload.user.avatarUrl ?? "");
        setBio(payload.user.bio ?? "");
        setLocation(payload.user.location ?? "");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // Keep server-provided fallback values.
      }
    };

    void loadProfile();

    return () => {
      controller.abort();
    };
  }, []);

  async function handleSaveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveMessage(null);
    setSaveError(null);
    setIsSaving(true);

    try {
      const response = await fetchWithAuthRetry("/api/auth/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          screenName,
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

  function handleAvatarFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }
    setAvatarMessage(null);
    setAvatarError(null);
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        setCropSrc(reader.result);
      }
    });
    reader.readAsDataURL(file);
    if (avatarInputRef.current) {
      avatarInputRef.current.value = "";
    }
  }

  async function handleCroppedBlob(blob: Blob) {
    setCropSrc(null);
    setIsUploadingAvatar(true);
    const formData = new FormData();
    formData.append("avatar", blob, "avatar.webp");
    try {
      const response = await fetchWithAuthRetry("/api/auth/profile/avatar", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as { user?: Partial<AccountUser>; error?: string } | null;
      if (!response.ok || !payload?.user) {
        setAvatarError(payload?.error ?? "Could not upload your avatar.");
        return;
      }
      setAvatarUrl(payload.user.avatarUrl ?? "");
      setAvatarMessage("Avatar saved.");
    } catch {
      setAvatarError("Could not upload your avatar.");
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function handleAvatarRemove() {
    setAvatarMessage(null);
    setAvatarError(null);
    setIsUploadingAvatar(true);

    try {
      const response = await fetchWithAuthRetry("/api/auth/profile/avatar", {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as { user?: Partial<AccountUser>; error?: string } | null;

      if (!response.ok || !payload?.user) {
        setAvatarError(payload?.error ?? "Could not remove your avatar.");
        return;
      }

      setAvatarUrl(payload.user.avatarUrl ?? "");
      setAvatarMessage("Avatar removed.");
    } catch {
      setAvatarError("Could not remove your avatar.");
    } finally {
      setIsUploadingAvatar(false);
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
          aria-selected={activeTab === "blocked"}
          className={activeTab === "blocked" ? "activeTab" : undefined}
          onClick={() => setActiveTab("blocked")}
        >
          Blocked videos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "autoplay"}
          className={activeTab === "autoplay" ? "activeTab" : undefined}
          onClick={() => setActiveTab("autoplay")}
        >
          Autoplay
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
                  <span>Avatar</span>
                  <div className="accountAvatarControls">
                    <label className={`accountAvatarUploadButton${isUploadingAvatar ? " accountAvatarUploadButtonDisabled" : ""}`}>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        name="avatarFile"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={handleAvatarFileChange}
                        disabled={isUploadingAvatar}
                      />
                      {isUploadingAvatar ? "Uploading..." : "Choose image"}
                    </label>
                  </div>
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
                {isUploadingAvatar ? <p>Uploading avatar...</p> : null}
                {avatarPreview ? (
                  <button
                    type="button"
                    className="accountAvatarRemoveButton"
                    onClick={() => {
                      void handleAvatarRemove();
                    }}
                    disabled={isUploadingAvatar}
                  >
                    Remove avatar
                  </button>
                ) : null}
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
      {avatarMessage ? <p className="authMessage">{avatarMessage}</p> : null}
      {avatarError ? <p className="authMessage">{avatarError}</p> : null}
            {saveMessage ? <p className="authMessage">{saveMessage}</p> : null}
            {saveError ? <p className="authMessage">{saveError}</p> : null}
        </form>
      ) : activeTab === "security" ? (
        <div className="accountSecurityLayout" role="tabpanel" aria-label="Security">
          <div className="accountSecurityColumn">
            <h3 className="accountSecurityHeading">Change password</h3>
            <AuthChangePasswordForm />
          </div>
          {!user.email ? (
            <div className="accountSecurityColumn">
              <h3 className="accountSecurityHeading">Add recovery email</h3>
              <UpgradeToEmailForm onSuccess={() => window.location.reload()} />
            </div>
          ) : null}
          {!user.emailVerifiedAt ? (
            <div className="accountSecurityColumn">
              <AuthAccountActions emailVerified={false} showLogout={false} />
            </div>
          ) : null}
        </div>
      ) : activeTab === "blocked" ? (
        <div role="tabpanel" aria-label="Blocked videos">
          <BlockedVideosInfiniteList
            initialBlockedVideos={initialBlockedVideos}
            initialHasMore={initialBlockedHasMore}
            pageSize={blockedPageSize}
          />
        </div>
      ) : (
        <div role="tabpanel" aria-label="Autoplay settings">
          <AutoplaySettingsEditor className="accountAutoplayPanel" title="Sources" />
        </div>
      )}
      {cropSrc ? (
        <AvatarCropModal
          imageSrc={cropSrc}
          onConfirm={(blob) => { void handleCroppedBlob(blob); }}
          onClose={() => { setCropSrc(null); }}
        />
      ) : null}
    </>
  );
}

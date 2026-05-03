import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { AccountSettingsPanel } from "@/components/account-settings-panel";
import { AuthLogoutButton } from "@/components/auth-logout-button";
import { OverlayHeader } from "@/components/overlay-header";
import { ProtectedAuthGatePanel } from "@/components/protected-auth-gate-panel";
import { isAdminIdentity } from "@/lib/admin-auth";
import { getHiddenVideosForUser } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

export default async function AccountPage() {
  const authState = await getCurrentAuthenticatedUserAuthState();
  const user = authState.status === "authenticated" ? authState.user : null;
  const isAdminUser = Boolean(user && isAdminIdentity(user.id, user.email ?? ""));
  const blockedPageSize = 24;
  const blockedWindow = user
    ? await getHiddenVideosForUser(user.id, { limit: blockedPageSize + 1, offset: 0 })
    : [];
  const hasMoreBlocked = blockedWindow.length > blockedPageSize;
  const initialBlockedVideos = hasMoreBlocked ? blockedWindow.slice(0, blockedPageSize) : blockedWindow;

  return (
    <>
      <OverlayHeader close={false}>
        <strong><span className="whiteAccountGlyph" aria-hidden="true">👤</span> Account</strong>
        <div className="accountTopBarActions">
          {user && isAdminUser ? (
            <Link href="/admin" className="favouritesBlindClose">Admin Panel</Link>
          ) : null}
          {user ? <AuthLogoutButton /> : null}
          <CloseLink />
        </div>
      </OverlayHeader>

      {user ? (
        <AccountSettingsPanel
          user={{
            id: user.id,
            email: user.email,
            emailVerifiedAt: user.emailVerifiedAt,
            screenName: user.screenName,
            avatarUrl: user.avatarUrl,
            bio: user.bio,
            location: user.location,
          }}
          initialBlockedVideos={initialBlockedVideos}
          initialBlockedHasMore={hasMoreBlocked}
          blockedPageSize={blockedPageSize}
        />
      ) : (
          <ProtectedAuthGatePanel
            status={authState.status === "unavailable" ? "unavailable" : "unauthenticated"}
          heading="👤 Session"
          headingDetail="Login required"
          unauthenticatedMessage="You are not currently signed in."
          unavailableMessage={authState.status === "unavailable" ? authState.message : undefined}
        />
      )}
    </>
  );
}

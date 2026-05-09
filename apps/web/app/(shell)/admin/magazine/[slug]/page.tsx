import Link from "next/link";

import { AdminMagazineEditor } from "@/components/admin-magazine-editor";
import { AdminTabLinks } from "@/components/admin-tab-links";
import { CloseLink } from "@/components/close-link";
import { OverlayHeader } from "@/components/overlay-header";
import { ProtectedAuthGatePanel } from "@/components/protected-auth-gate-panel";
import { requireAdminUserAuthState } from "@/lib/admin-auth";

export default async function AdminMagazineEditPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const adminAuthState = await requireAdminUserAuthState();

  return (
    <div className="adminOverlayPage">
      <OverlayHeader close={false}>
        <strong><span className="whiteAccountGlyph" aria-hidden="true">🛠</span> Admin</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <AdminTabLinks activeTab="magazine" enablePendingCount={adminAuthState.status === "authorized"} />
          <CloseLink />
        </div>
      </OverlayHeader>

      {adminAuthState.status === "authorized" ? (
        <div className="interactiveStack">
          <div className="primaryActions compactActions">
            <Link href="/admin?tab=magazine" className="navLink navLinkActive">Back to Magazine List</Link>
          </div>
          <AdminMagazineEditor slug={slug} />
        </div>
      ) : adminAuthState.status === "unavailable" ? (
        <ProtectedAuthGatePanel
          status="unavailable"
          heading="🛠 Session"
          headingDetail="Admin auth unavailable"
          unauthenticatedMessage=""
          unavailableMessage={adminAuthState.message}
          showRegisterAction={false}
        />
      ) : adminAuthState.status === "unauthenticated" ? (
        <ProtectedAuthGatePanel
          status="unauthenticated"
          heading="🛠 Session"
          headingDetail="Admin access required"
          unauthenticatedMessage="Sign in with the administrator account to access this area."
          showRegisterAction={false}
        />
      ) : (
        <section className="panel featurePanel">
          <div className="panelHeading">
            <span><span className="whiteAccountGlyph" aria-hidden="true">🛠</span> Session</span>
            <strong>Admin access required</strong>
          </div>
          <div className="interactiveStack">
            <p className="authMessage">This area is only available to the site administrator account.</p>
            <div className="primaryActions compactActions">
              <Link href="/login" className="navLink navLinkActive">Login</Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

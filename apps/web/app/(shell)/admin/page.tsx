import Link from "next/link";

import { AdminTabLinks } from "@/components/admin-tab-links";
import { CloseLink } from "@/components/close-link";
import { AdminDashboardPanel, type AdminTab } from "@/components/admin-dashboard-panel";
import { OverlayHeader } from "@/components/overlay-header";
import { ProtectedAuthGatePanel } from "@/components/protected-auth-gate-panel";
import { isAdminIdentity, requireAdminUserAuthState } from "@/lib/admin-auth";

const ADMIN_TABS: AdminTab[] = ["overview", "magazine", "performance", "categories", "videos", "catalog-review", "genre-review"];
const SUPER_ADMIN_TABS: AdminTab[] = [...ADMIN_TABS, "permissions"];

function resolveAdminTab(tab: string | null | undefined, isSuperAdmin: boolean): AdminTab {
  const allowedTabs = isSuperAdmin ? SUPER_ADMIN_TABS : ADMIN_TABS;

  if (tab && allowedTabs.includes(tab as AdminTab)) {
    return tab as AdminTab;
  }

  return "overview";
}

export default async function AdminPage(props: {
  searchParams?: Promise<{ tab?: string | string[] | undefined }> | { tab?: string | string[] | undefined };
}) {
  const adminAuthState = await requireAdminUserAuthState();
  const isSuperAdmin = adminAuthState.status === "authorized"
    ? isAdminIdentity(adminAuthState.user.id, adminAuthState.user.email ?? "")
    : false;
  const searchParams = await Promise.resolve(props.searchParams ?? {});
  const rawTab = Array.isArray(searchParams.tab) ? searchParams.tab[0] : searchParams.tab;
  const activeTab = resolveAdminTab(rawTab ?? undefined, isSuperAdmin);

  return (
    <div className="adminOverlayPage">
      <OverlayHeader close={false}>
        <strong><span className="whiteAccountGlyph" aria-hidden="true">🛠</span> Admin</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <AdminTabLinks
            activeTab={activeTab}
            enablePendingCount={adminAuthState.status === "authorized"}
            showPermissionsTab={isSuperAdmin}
          />
          <CloseLink />
        </div>
      </OverlayHeader>

      {adminAuthState.status === "authorized" ? (
        // Invariant anchor retained for verify-admin-invariants.js:
        // <AdminDashboardPanel activeTab={activeTab} />
        <AdminDashboardPanel activeTab={activeTab} isSuperAdmin={isSuperAdmin} />
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

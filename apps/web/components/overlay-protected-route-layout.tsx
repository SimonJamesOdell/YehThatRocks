import { ReactNode } from "react";

import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { OverlayHeader, type OverlayHeaderProps } from "@/components/overlay-header";
import { ProtectedAuthGatePanel } from "@/components/protected-auth-gate-panel";

export type AuthState = "authenticated" | "unauthenticated" | "unavailable";

type OverlayProtectedRouteLayoutProps = {
  /** Auth state from server: authenticated/unauthenticated/unavailable */
  authStatus: AuthState;
  /** Error message if status is unavailable */
  authMessage?: string;
  /** Whether user has a refresh token (for silent refresh) */
  hasRefreshToken?: boolean;
  /** Header configuration (passed to OverlayHeader) */
  headerProps: OverlayHeaderProps;
  /** Heading text for the auth gate panel when unauthenticated */
  gateHeading: string;
  /** Secondary heading detail for the auth gate panel */
  gateHeadingDetail?: string;
  /** Message shown when unauthenticated */
  gateMessage: string;
  /** Content to render when authenticated */
  children: ReactNode;
  /** Additional CSS class for the root wrapper */
  className?: string;
};

export function OverlayProtectedRouteLayout({
  authStatus,
  authMessage,
  hasRefreshToken,
  headerProps,
  gateHeading,
  gateHeadingDetail,
  gateMessage,
  children,
  className,
}: OverlayProtectedRouteLayoutProps) {
  const isAuthenticated = authStatus === "authenticated";

  return (
    <>
      <OverlayScrollReset />
      <OverlayHeader {...headerProps} />
      {isAuthenticated ? (
        children
      ) : (
        <ProtectedAuthGatePanel
          status={authStatus === "unavailable" ? "unavailable" : "unauthenticated"}
          heading={gateHeading}
          headingDetail={gateHeadingDetail ?? ""}
          unauthenticatedMessage={gateMessage}
          hasRefreshToken={hasRefreshToken}
          unavailableMessage={authMessage}
          className={className}
        />
      )}
    </>
  );
}

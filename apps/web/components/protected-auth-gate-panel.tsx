import Link from "next/link";

import { AuthRefreshReload } from "@/components/auth-refresh-reload";
import { AuthStatusRetryButton } from "@/components/auth-status-retry-button";

type ProtectedAuthGatePanelProps = {
  status: "unauthenticated" | "unavailable";
  heading: string;
  headingDetail: string;
  unauthenticatedMessage: string;
  className?: string;
  hasRefreshToken?: boolean;
  showRegisterAction?: boolean;
  unavailableMessage?: string;
};

export function ProtectedAuthGatePanel({
  status,
  heading,
  headingDetail,
  unauthenticatedMessage,
  className = "panel featurePanel",
  hasRefreshToken = false,
  showRegisterAction = true,
  unavailableMessage,
}: ProtectedAuthGatePanelProps) {
  if (status === "unavailable") {
    return (
      <section className={className}>
        <div className="panelHeading">
          <span>{heading}</span>
          <strong>Auth check unavailable</strong>
        </div>
        <div className="interactiveStack">
          <p className="authMessage">
            {unavailableMessage
              ?? "The auth server is not responding, so your authorization status cannot currently be confirmed."}
          </p>
          <p className="authSupportCopy">Try again later, or attempt to reconnect now.</p>
          <div className="primaryActions compactActions">
            <AuthStatusRetryButton label="Retry auth now" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={className}>
      {hasRefreshToken && <AuthRefreshReload />}
      <div className="panelHeading">
        <span>{heading}</span>
        <strong>{headingDetail}</strong>
      </div>
      <div className="interactiveStack">
        <p className="authMessage">{unauthenticatedMessage}</p>
        <div className="primaryActions compactActions">
          <Link href="/login" className="navLink navLinkActive">Login</Link>
          {showRegisterAction ? <Link href="/register" className="navLink">Register</Link> : null}
        </div>
      </div>
    </section>
  );
}
import Link from "next/link";

import { OverlayHeader } from "@/components/overlay-header";
import { AuthLoginForm } from "@/components/auth-login-form";

export default function LoginPage() {
  return (
    <>
      <OverlayHeader title="Login" />

      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Login form</span>
          <strong>Production auth baseline enabled</strong>
        </div>
        <AuthLoginForm />
        <div className="primaryActions compactActions">
          <Link href="/forgot-password" className="navLink">Forgot password?</Link>
        </div>
      </section>
    </>
  );
}

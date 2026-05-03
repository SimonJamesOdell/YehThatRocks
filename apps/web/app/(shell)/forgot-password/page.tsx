import { OverlayHeader } from "@/components/overlay-header";
import { AuthForgotPasswordForm } from "@/components/auth-forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <>
      <OverlayHeader title="Password reset" />

      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Forgot password</span>
          <strong>Issue a one-time reset link</strong>
        </div>
        <AuthForgotPasswordForm />
      </section>
    </>
  );
}

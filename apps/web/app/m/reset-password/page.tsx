import { AuthResetPasswordForm } from "@/components/auth-reset-password-form";

type Props = {
  searchParams: Promise<{ token?: string }>;
};

export default async function MobileResetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams;

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Reset password</h1>
        <p className="mobile-page-subtitle">Choose a new password</p>
      </div>
      {token ? (
        <AuthResetPasswordForm token={token} />
      ) : (
        <p className="mobile-empty-state">Missing reset token. Please use the link from your email.</p>
      )}
    </div>
  );
}

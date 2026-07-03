import Link from "next/link";

type Props = {
  searchParams: Promise<{ status?: string }>;
};

export default async function MobileVerifyEmailPage({ searchParams }: Props) {
  const { status } = await searchParams;

  const heading =
    status === "success"
      ? "Email verified"
      : status === "invalid"
        ? "Invalid link"
        : "Check your email";

  const message =
    status === "success"
      ? "Your email has been verified."
      : status === "invalid"
        ? "That verification link is invalid or expired."
        : "Check your email for the verification link.";

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">{heading}</h1>
        <p className="mobile-page-subtitle">{message}</p>
      </div>
      <div className="mobile-verify-actions">
        <Link href="/m/account" className="mobile-verify-link">Account</Link>
        <Link href="/m/login" className="mobile-verify-link">Login</Link>
      </div>
    </div>
  );
}

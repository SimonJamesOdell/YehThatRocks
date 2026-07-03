import { AuthRegisterForm } from "@/components/auth-register-form";

export default function MobileRegisterPage() {
  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Register</h1>
        <p className="mobile-page-subtitle">Create your account</p>
      </div>
      <AuthRegisterForm />
    </div>
  );
}

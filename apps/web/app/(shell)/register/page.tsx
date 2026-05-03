import { OverlayHeader } from "@/components/overlay-header";
import { AuthRegisterForm } from "@/components/auth-register-form";

export default function RegisterPage() {
  return (
    <>
      <OverlayHeader title="Register" />
      <AuthRegisterForm />
    </>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function AuthRegisterForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const screenName = String(formData.get("screenName") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    const remember = true;

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, screenName, password, remember }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Registration failed. Please try again.");
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="authForm authFormWide" onSubmit={handleSubmit}>
      <label>
        <span>Email</span>
        <input name="email" type="email" placeholder="you@example.com" required autoComplete="email" />
      </label>
      <label>
        <span>Screen name</span>
        <input name="screenName" type="text" placeholder="MetalFan204" required minLength={2} maxLength={40} autoComplete="nickname" />
      </label>
      <label className="authPasswordField">
        <span>Password</span>
        <div className="authPasswordInputWrap">
          <input
            name="password"
            type={isPasswordVisible ? "text" : "password"}
            placeholder="Minimum 8 characters"
            required
            minLength={8}
            autoComplete="new-password"
          />
          <button
            type="button"
            className="authPasswordToggle"
            aria-label={isPasswordVisible ? "Hide password" : "Show password"}
            title={isPasswordVisible ? "Hide password" : "Show password"}
            aria-pressed={isPasswordVisible}
            onClick={() => setIsPasswordVisible((current) => !current)}
          >
            <span aria-hidden="true">👁</span>
          </button>
        </div>
      </label>
      <label className="authPasswordField">
        <span>Confirm password</span>
        <div className="authPasswordInputWrap">
          <input
            name="confirmPassword"
            type={isConfirmPasswordVisible ? "text" : "password"}
            placeholder="Repeat password"
            required
            minLength={8}
            autoComplete="new-password"
          />
          <button
            type="button"
            className="authPasswordToggle"
            aria-label={isConfirmPasswordVisible ? "Hide confirm password" : "Show confirm password"}
            title={isConfirmPasswordVisible ? "Hide confirm password" : "Show confirm password"}
            aria-pressed={isConfirmPasswordVisible}
            onClick={() => setIsConfirmPasswordVisible((current) => !current)}
          >
            <span aria-hidden="true">👁</span>
          </button>
        </div>
      </label>
      <button type="submit" disabled={isSubmitting} className="spanTwoColumns">
        {isSubmitting ? "Registering..." : "Register"}
      </button>
      {error ? <p className="authMessage spanTwoColumns">{error}</p> : null}
    </form>
  );
}

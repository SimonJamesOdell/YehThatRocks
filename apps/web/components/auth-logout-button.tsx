"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const AUTO_LOGIN_SUPPRESS_ONCE_KEY = "ytr:auto-login-suppress-once";

export function AuthLogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout() {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(AUTO_LOGIN_SUPPRESS_ONCE_KEY, "1");
    }

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });

      if (!response.ok) {
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(AUTO_LOGIN_SUPPRESS_ONCE_KEY);
        }
        setIsSubmitting(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(AUTO_LOGIN_SUPPRESS_ONCE_KEY);
      }
      setIsSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      className="favouritesBlindClose accountTopBarAction"
      onClick={handleLogout}
      disabled={isSubmitting}
    >
      {isSubmitting ? "Signing out..." : "Logout"}
    </button>
  );
}

"use client";

import { useEffect } from "react";

export function useAuthSuccessListener(onAuthSuccess: () => void) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleAuthSuccess = () => {
      onAuthSuccess();
    };

    window.addEventListener("ytr:auth-success", handleAuthSuccess);
    return () => {
      window.removeEventListener("ytr:auth-success", handleAuthSuccess);
    };
  }, [onAuthSuccess]);
}

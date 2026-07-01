"use client";

import { useEffect } from "react";
import { subscribeToAuthStateChanges } from "@/lib/auth-sync";

export function useAuthSuccessListener(
  onAuthStateChange: (state: "authenticated" | "logged-out", source: "local" | "cross-tab") => void,
) {
  useEffect(() => {
    return subscribeToAuthStateChanges(onAuthStateChange);
  }, [onAuthStateChange]);
}

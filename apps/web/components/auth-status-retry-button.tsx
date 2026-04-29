"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AuthStatusRetryButtonProps = {
  label?: string;
};

export function AuthStatusRetryButton({ label = "Retry auth" }: AuthStatusRetryButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  function handleRetry() {
    if (isPending) {
      return;
    }

    setIsPending(true);
    router.refresh();
    window.setTimeout(() => {
      setIsPending(false);
    }, 400);
  }

  return (
    <button type="button" onClick={handleRetry} disabled={isPending}>
      {isPending ? "Retrying..." : label}
    </button>
  );
}
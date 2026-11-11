"use client";

import { memo, useState } from "react";

type AuthStatusRetryButtonProps = {
  label?: string;
};

export const AuthStatusRetryButton = memo(function AuthStatusRetryButton({ label = "Retry auth" }: AuthStatusRetryButtonProps) {
  const [isPending, setIsPending] = useState(false);

  function handleRetry() {
    if (isPending) {
      return;
    }

    setIsPending(true);
    // A full document reload re-runs any Cloudflare browser challenge and
    // re-renders server-side with the current auth cookies. A soft
    // router.refresh() would itself be challenged and cannot recover from an
    // expired cf_clearance.
    window.location.reload();
  }

  return (
    <button type="button" onClick={handleRetry} disabled={isPending}>
      {isPending ? "Retrying..." : label}
    </button>
  );
});

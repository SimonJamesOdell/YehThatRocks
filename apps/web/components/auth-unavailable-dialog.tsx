"use client";

import { memo, useCallback } from "react";

type AuthUnavailableDialogProps = {
  message: string;
  isRetrying: boolean;
  retryLabel: string;
  retryButtonLabel: string;
  retryBusyLabel: string;
  dismissLabel: string;
  dismissButtonLabel: string;
  onRetry: () => void;
  onDismiss: () => void;
};

export const AuthUnavailableDialog = memo(function AuthUnavailableDialog({
  message,
  isRetrying,
  retryLabel,
  retryButtonLabel,
  retryBusyLabel,
  dismissLabel,
  dismissButtonLabel,
  onRetry,
  onDismiss,
}: AuthUnavailableDialogProps) {
  const stopPropagation = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div className="authStatusModalOverlay" onClick={onDismiss}>
      <section
        className="authStatusModalDialog"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-labelledby="auth-unavailable-title"
        aria-describedby="auth-unavailable-message"
        onClick={stopPropagation}
      >
        <div className="authStatusModalCopy">
          <strong id="auth-unavailable-title">Auth server unavailable</strong>
          <p id="auth-unavailable-message">{message}</p>
        </div>
        <div className="authStatusModalActions">
          <button
            type="button"
            className="authStatusModalDismiss"
            aria-label={dismissLabel}
            title={dismissLabel}
            onClick={onDismiss}
            disabled={isRetrying}
          >
            {dismissButtonLabel}
          </button>
          <button
            type="button"
            aria-label={retryLabel}
            title={retryLabel}
            onClick={onRetry}
            disabled={isRetrying}
          >
            {isRetrying ? retryBusyLabel : retryButtonLabel}
          </button>
        </div>
      </section>
    </div>
  );
});
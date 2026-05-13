"use client";

type AuthUnavailableDialogProps = {
  message: string;
  isRetrying: boolean;
  retryLabel: string;
  retryButtonLabel: string;
  retryBusyLabel: string;
  onRetry: () => void;
};

export function AuthUnavailableDialog({
  message,
  isRetrying,
  retryLabel,
  retryButtonLabel,
  retryBusyLabel,
  onRetry,
}: AuthUnavailableDialogProps) {
  return (
    <div className="authStatusModalOverlay">
      <section
        className="authStatusModalDialog"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-labelledby="auth-unavailable-title"
        aria-describedby="auth-unavailable-message"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="authStatusModalCopy">
          <strong id="auth-unavailable-title">Auth server unavailable</strong>
          <p id="auth-unavailable-message">{message}</p>
        </div>
        <div className="authStatusModalActions">
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
}

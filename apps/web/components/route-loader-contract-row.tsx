type RouteLoaderContractRowProps = {
  isLoading?: boolean;
  loadingLabel?: string;
  error?: string | null;
  onRetry?: (() => void) | null;
  retryLabel?: string;
  endLabel?: string | null;
  className?: string;
};

export function RouteLoaderContractRow({
  isLoading = false,
  loadingLabel,
  error = null,
  onRetry = null,
  retryLabel = "Retry",
  endLabel = null,
  className,
}: RouteLoaderContractRowProps) {
  const rowClassName = ["routeContractRow", className].filter(Boolean).join(" ");

  return (
    <div className={rowClassName} aria-live="polite" aria-busy={isLoading}>
      {isLoading ? (
        <>
          <span className="playerBootBars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>{loadingLabel ?? "Loading..."}</span>
        </>
      ) : null}
      {!isLoading && error ? <span>{error}</span> : null}
      {!isLoading && error && onRetry ? (
        <button type="button" className="routeContractRetryButton" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
      {!isLoading && !error && endLabel ? <span>{endLabel}</span> : null}
    </div>
  );
}
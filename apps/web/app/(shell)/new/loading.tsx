export default function NewLoading() {
  return (
    <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy="true">
      <span className="playerBootBars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span>Loading new videos...</span>
    </div>
  );
}

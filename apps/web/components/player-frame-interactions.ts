export function shouldShowControlsOnMouseEnter({
  allowDirectIframeInteraction,
}: {
  allowDirectIframeInteraction: boolean;
}) {
  return !allowDirectIframeInteraction;
}

export function shouldHideControlsOnMouseLeave({
  isPlaying,
  allowDirectIframeInteraction,
}: {
  isPlaying: boolean;
  allowDirectIframeInteraction: boolean;
}) {
  return isPlaying && !allowDirectIframeInteraction;
}

export function shouldHideControlsOnBlur({
  nextFocusedNode,
  currentTarget,
  isPlaying,
}: {
  nextFocusedNode: EventTarget | null;
  currentTarget: EventTarget & Node;
  isPlaying: boolean;
}) {
  if (!isPlaying) {
    return false;
  }

  return !(nextFocusedNode instanceof Node) || !currentTarget.contains(nextFocusedNode);
}

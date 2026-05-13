export function getEndedChoiceGridColumns(containerWidth: number) {
  if (containerWidth <= 640) {
    return 1;
  }

  if (containerWidth <= 920) {
    return 2;
  }

  return 4;
}

export function estimateEndedChoiceVisibleCount({
  overlayClientHeight,
  rowHeight,
  columns,
}: {
  overlayClientHeight: number | null;
  rowHeight: number;
  columns: number;
}) {
  if (overlayClientHeight === null) {
    return columns * 2;
  }

  const safeRowHeight = Math.max(1, rowHeight);
  const rowsVisible = Math.max(1, Math.ceil(overlayClientHeight / safeRowHeight) + 1);
  return rowsVisible * columns;
}

export function computeEndedChoiceFirstVisibleIndex({
  overlayScrollTop,
  rowHeight,
  columns,
}: {
  overlayScrollTop: number;
  rowHeight: number;
  columns: number;
}) {
  const safeRowHeight = Math.max(1, rowHeight);
  const rowsScrolled = Math.max(0, Math.floor(overlayScrollTop / safeRowHeight));
  return Math.max(0, rowsScrolled * columns);
}

export function shouldAutoPrimeEndedChoiceRunway({
  showEndedChoiceOverlay,
  endedChoiceUserScrolled,
  endedChoiceFetching,
  endedChoiceHasMore,
  overlayScrollHeight,
  overlayClientHeight,
  endedChoiceGridLength,
  visibleCount,
  endedChoiceScrollRunwayCount,
  endedChoiceHideSeen,
  visibleEndedChoiceVideosLength,
}: {
  showEndedChoiceOverlay: boolean;
  endedChoiceUserScrolled: boolean;
  endedChoiceFetching: boolean;
  endedChoiceHasMore: boolean;
  overlayScrollHeight: number | null;
  overlayClientHeight: number | null;
  endedChoiceGridLength: number;
  visibleCount: number;
  endedChoiceScrollRunwayCount: number;
  endedChoiceHideSeen: boolean;
  visibleEndedChoiceVideosLength: number;
}) {
  if (
    !showEndedChoiceOverlay
    || endedChoiceUserScrolled
    || endedChoiceFetching
    || !endedChoiceHasMore
  ) {
    return false;
  }

  const isScrollable =
    overlayScrollHeight !== null
    && overlayClientHeight !== null
    && overlayScrollHeight > overlayClientHeight + 4;
  const lowRunway = endedChoiceGridLength < visibleCount + endedChoiceScrollRunwayCount;

  const needsSeenRowFill = endedChoiceHideSeen
    && (visibleEndedChoiceVideosLength === 0 || visibleEndedChoiceVideosLength % 4 !== 0);

  return needsSeenRowFill || (!isScrollable && lowRunway);
}

export function resolveDockedRouteNextVideoId({
  routeAutoplayQueueIds,
  currentVideoId,
}: {
  routeAutoplayQueueIds: string[];
  currentVideoId: string;
}) {
  if (routeAutoplayQueueIds.length === 0) {
    return null;
  }

  const currentIndex = routeAutoplayQueueIds.findIndex((videoId) => videoId === currentVideoId);
  return currentIndex >= 0
    ? (routeAutoplayQueueIds[(currentIndex + 1) % routeAutoplayQueueIds.length] ?? null)
    : (routeAutoplayQueueIds[0] ?? null);
}

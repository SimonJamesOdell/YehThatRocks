type PendingQueueItemLike = {
  id: number;
};

export function mergePendingQueuePreservingCurrentOrder<T extends PendingQueueItemLike>(
  currentQueue: T[],
  nextQueue: T[],
): T[] {
  if (currentQueue.length === 0) {
    return nextQueue;
  }

  const nextById = new Map(nextQueue.map((item) => [item.id, item]));

  const retained = currentQueue
    .map((item) => nextById.get(item.id))
    .filter((item): item is T => item !== undefined);
  const retainedIds = new Set(retained.map((item) => item.id));

  const appended = nextQueue.filter((item) => !retainedIds.has(item.id));

  return [...retained, ...appended];
}
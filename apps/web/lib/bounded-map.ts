export function pruneMapToMaxEntries<K, V>(map: Map<K, V>, maxEntries: number) {
  if (maxEntries <= 0) {
    map.clear();
    return;
  }

  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }

    map.delete(oldestKey);
  }
}

export class BoundedMap<K, V> extends Map<K, V> {
  private readonly maxEntries: number;

  constructor(maxEntries: number, entries?: ReadonlyArray<readonly [K, V]> | null) {
    super(entries);
    this.maxEntries = Math.max(0, Math.floor(maxEntries));
    this.pruneToMaxEntries();
  }

  override set(key: K, value: V): this {
    if (this.maxEntries <= 0) {
      this.clear();
      return this;
    }

    if (this.has(key)) {
      super.delete(key);
    }

    super.set(key, value);
    this.pruneToMaxEntries();
    return this;
  }

  private pruneToMaxEntries() {
    while (this.size > this.maxEntries) {
      const oldestKey = this.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }

      this.delete(oldestKey);
    }
  }
}

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

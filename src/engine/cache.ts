export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  public constructor(private maxEntries: number) {}

  public setMaxEntries(maxEntries: number): void {
    this.maxEntries = maxEntries;
    this.trim();
  }

  public get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }

    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  public set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    this.map.set(key, value);
    this.trim();
  }

  private trim(): void {
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value as K | undefined;
      if (oldestKey === undefined) {
        break;
      }

      this.map.delete(oldestKey);
    }
  }
}

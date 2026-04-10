import { describe, expect, it } from "vitest";

import { LruCache } from "../../src/engine/cache";

describe("LruCache", () => {
  it("returns undefined for missing keys", () => {
    const cache = new LruCache<string, number>(2);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts oldest entries when max is exceeded", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("updates max entries dynamically", () => {
    const cache = new LruCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.setMaxEntries(1);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });
});

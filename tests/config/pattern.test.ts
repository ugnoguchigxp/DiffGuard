import { describe, expect, it } from "vitest";

import { matchesAnyGlob, matchesGlob, normalizePathForMatch } from "../../src/config/pattern";

describe("pattern", () => {
  it("matches single-star and double-star globs", () => {
    expect(matchesGlob("src/a.ts", "src/*.ts")).toBe(true);
    expect(matchesGlob("src/nested/a.ts", "src/*.ts")).toBe(false);
    expect(matchesGlob("src/nested/a.ts", "src/**/*.ts")).toBe(true);
  });

  it("matches normalized windows paths", () => {
    expect(normalizePathForMatch(".\\src\\a.ts")).toBe("src/a.ts");
    expect(matchesGlob("src\\a.ts", "src/*.ts")).toBe(true);
  });

  it("matches any glob in list", () => {
    expect(matchesAnyGlob("src/user.ts", ["test/**/*.ts", "src/*.ts"])).toBe(true);
    expect(matchesAnyGlob("docs/readme.md", ["src/*.ts", "test/**/*.ts"])).toBe(false);
  });
});

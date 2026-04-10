import { describe, expect, it } from "vitest";

import {
  scoreCandidate,
  selectRelatedCode,
  tokenize,
} from "../../src/embedding/relatedCodeSelector";

describe("relatedCodeSelector", () => {
  it("tokenizes code-like strings", () => {
    const tokens = tokenize("export const getUser = (id: string) => id;");
    expect(tokens).toEqual(expect.arrayContaining(["export", "const", "getuser", "id", "string"]));
  });

  it("scores higher for more token overlap", () => {
    const high = scoreCandidate("getUser profile", "function getUserProfile() {}");
    const low = scoreCandidate("getUser profile", "const unused = true;");
    expect(high).toBeGreaterThan(low);
  });

  it("selects and sorts related code by score", () => {
    const selected = selectRelatedCode(
      "fetch user profile",
      [
        { id: "a", content: "export const fetchUserProfile = () => {};" },
        { id: "b", content: "const logger = createLogger();" },
        { id: "c", content: "function fetchUser() { return null; }" },
      ],
      2,
      0.05,
    );

    expect(selected).toHaveLength(2);
    expect(selected[0]?.score).toBeGreaterThanOrEqual(selected[1]?.score ?? 0);
    expect(selected.map((item) => item.id)).toEqual(expect.arrayContaining(["a"]));
  });

  it("filters out candidates below minScore", () => {
    const selected = selectRelatedCode(
      "user profile",
      [{ id: "x", content: "totally unrelated text" }],
      3,
      0.5,
    );

    expect(selected).toEqual([]);
  });
});

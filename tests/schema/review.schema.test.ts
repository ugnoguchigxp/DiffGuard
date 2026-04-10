import { describe, expect, it } from "vitest";

import {
  diffGuardConfigSchema,
  reviewInputSchema,
  reviewResultSchema,
} from "../../src/schema/review.schema";

describe("review schemas", () => {
  it("accepts valid review input", () => {
    const parsed = reviewInputSchema.parse({
      diff: "diff --git a/a.ts b/a.ts",
      files: ["src/a.ts"],
    });

    expect(parsed.files).toEqual(["src/a.ts"]);
  });

  it("rejects empty diff", () => {
    expect(() =>
      reviewInputSchema.parse({
        diff: "",
        files: ["src/a.ts"],
      }),
    ).toThrow();
  });

  it("accepts valid review result", () => {
    const parsed = reviewResultSchema.parse({
      schemaVersion: "1.0.0",
      risk: "low",
      blocking: false,
      issues: [],
    });

    expect(parsed.risk).toBe("low");
  });

  it("accepts diffguard config", () => {
    const parsed = diffGuardConfigSchema.parse({
      failOn: "warn",
      outputFormat: "sarif",
      rules: {
        DG001: {
          enabled: true,
          severity: "warn",
        },
      },
      suppressions: [
        {
          ruleId: "DG001",
          file: "src/**/*.ts",
        },
      ],
      plugins: ["./plugins/custom-rule.js"],
      cache: {
        enabled: true,
        maxEntries: 64,
      },
    });

    expect(parsed.failOn).toBe("warn");
    expect(parsed.rules?.DG001?.severity).toBe("warn");
  });
});

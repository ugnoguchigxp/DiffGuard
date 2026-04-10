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
    expect(parsed.levelCounts).toEqual({
      error: 0,
      warn: 0,
      info: 0,
    });
    expect(parsed.findings).toEqual([]);
  });

  it("accepts finding metadata with remediation hint", () => {
    const parsed = reviewResultSchema.parse({
      schemaVersion: "1.0.0",
      risk: "high",
      blocking: true,
      levelCounts: {
        error: 1,
        warn: 0,
        info: 0,
      },
      findings: [
        {
          id: "DG001",
          level: "error",
          message: "public API changed without migration note",
          ruleId: "API_BREAK",
          metadata: {
            blockingReason: "api-compatibility",
            remediation: "restore original signature or add adapter layer",
          },
        },
      ],
      issues: [],
    });

    expect(parsed.findings[0]?.metadata.remediation).toContain("adapter layer");
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

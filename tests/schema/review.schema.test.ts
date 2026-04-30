import { describe, expect, it } from "vitest";

import {
  astmendOperationMetadataSchema,
  diffGuardConfigSchema,
  reviewInputSchema,
  reviewRequestContextSchema,
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

  it("accepts review request context and Astmend operation metadata", () => {
    const context = reviewRequestContextSchema.parse({
      source: "astmend",
      proposalId: "proposal-1",
      patchPlanId: "plan-1",
      intent: "extract",
      constraints: {
        doNotExtract: ["validatePrice"],
        allowedSharedTargets: ["src/shared/safe.ts"],
      },
      astmendOperations: [
        {
          operationId: "op-1",
          type: "extract_function",
          file: "src/features/pricing.ts",
          symbol: "validatePrice",
          destinationFile: "src/shared/pricing.ts",
        },
      ],
    });

    const operation = astmendOperationMetadataSchema.parse(context.astmendOperations?.[0]);
    expect(context.proposalId).toBe("proposal-1");
    expect(operation.operationId).toBe("op-1");
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
            proposalId: "proposal-1",
            operationId: "op-1",
          },
        },
      ],
      issues: [],
      context: {
        proposalId: "proposal-1",
        operationIds: ["op-1"],
      },
      memoryHints: [
        {
          id: "memory-hint-DG001-1",
          severity: "error",
          title: "DiffGuard blocked API_BREAK",
          content: "public API changed without migration note",
          category: "debugging",
          kind: "lesson",
          tags: ["diffguard", "API_BREAK"],
          evidence: [{ type: "finding", value: "API_BREAK" }],
          source: {
            proposalId: "proposal-1",
            operationId: "op-1",
          },
        },
      ],
    });

    expect(parsed.findings[0]?.metadata.remediation).toContain("adapter layer");
    expect(parsed.memoryHints?.[0]?.source?.operationId).toBe("op-1");
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
      semantic: {
        enabled: true,
        maxFiles: 25,
        timeoutMs: 500,
      },
      frameworkRules: {
        react: true,
        tanstackQuery: true,
      },
    });

    expect(parsed.failOn).toBe("warn");
    expect(parsed.rules?.DG001?.severity).toBe("warn");
    expect(parsed.semantic?.enabled).toBe(true);
    expect(parsed.frameworkRules?.react).toBe(true);
  });
});

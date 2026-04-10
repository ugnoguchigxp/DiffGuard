import { describe, expect, it } from "vitest";

import { toSarif } from "../../src/output/sarif";

describe("toSarif", () => {
  it("converts issues to SARIF and deduplicates rules", () => {
    const sarif = toSarif([
      {
        schemaVersion: "1.0.0",
        risk: "high",
        blocking: true,
        issues: [
          {
            type: "missing-update",
            ruleId: "DG001",
            message: "error message",
            severity: "error",
            confidence: 0.9,
            remediation: "fix error",
            file: "src/a.ts",
            line: 10,
          },
          {
            type: "missing-update",
            ruleId: "DG001",
            message: "error message 2",
            severity: "warn",
            confidence: 0.8,
            remediation: "fix warning",
            file: "src/a.ts",
          },
          {
            type: "note-only",
            ruleId: "PLG001",
            message: "note message",
            severity: "info",
            confidence: 0.7,
            remediation: "check note",
          },
        ],
      },
    ]);

    const runs = sarif.runs as Array<{
      tool: { driver: { rules: Array<{ id: string }> } };
      results: Array<{ level: string }>;
    }>;
    expect(runs).toHaveLength(1);
    expect(runs[0]?.tool.driver.rules.map((rule) => rule.id)).toEqual(["DG001", "PLG001"]);
    expect(runs[0]?.results.map((result) => result.level)).toEqual(["error", "warning", "note"]);
  });
});

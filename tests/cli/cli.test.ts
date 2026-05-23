import { describe, expect, it } from "vitest";

import { parseCliArgs, runCli } from "../../src/cli";
import { REVIEW_SCHEMA_VERSION } from "../../src/constants/review";

describe("parseCliArgs", () => {
  it("parses files from csv and repeated --file", () => {
    const args = parseCliArgs([
      "--diff",
      "diff --git a/a.ts b/a.ts",
      "--files",
      "src/a.ts,src/b.ts",
      "--file",
      "src/c.ts",
      "--emit-memory-hints",
      "--compare-candidates",
      "--context-file",
      "/tmp/context.json",
      "--astmend-ops-file",
      "/tmp/ops.json",
      "--pretty",
      "--format",
      "sarif",
      "--fail-on",
      "warn",
    ]);

    expect(args.files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(args.emitMemoryHints).toBe(true);
    expect(args.compareCandidates).toBe(true);
    expect(args.contextFile).toBe("/tmp/context.json");
    expect(args.astmendOpsFile).toBe("/tmp/ops.json");
    expect(args.pretty).toBe(true);
    expect(args.format).toBe("sarif");
    expect(args.failOn).toBe("warn");
  });
});

describe("runCli", () => {
  const baseConfigOverride = {
    loadConfigFn: async () => ({ config: {} }),
    loadPluginRulesFn: async () => [],
  };

  it("prints usage on --help", async () => {
    let stdout = "";
    let stderr = "";

    const code = await runCli({
      argv: ["--help"],
      stdoutWrite: (value) => {
        stdout += value;
      },
      stderrWrite: (value) => {
        stderr += value;
      },
      ...baseConfigOverride,
    });

    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stderr).toBe("");
  });

  it("infers file paths from diff and calls review engine", async () => {
    const reviewCalls: Array<{ diff: string; files: string[] }> = [];
    let stdout = "";

    const code = await runCli({
      argv: [
        "--diff",
        [
          "diff --git a/src/service.ts b/src/service.ts",
          "--- a/src/service.ts",
          "+++ b/src/service.ts",
          "@@ -1,1 +1,1 @@",
          "-export const value = 0;",
          "+export const value = 1;",
        ].join("\n"),
      ],
      stdoutWrite: (value) => {
        stdout += value;
      },
      stderrWrite: () => {},
      reviewDiffFn: async (input) => {
        reviewCalls.push(input);
        return {
          schemaVersion: REVIEW_SCHEMA_VERSION,
          risk: "low",
          blocking: false,
          levelCounts: { error: 0, warn: 0, info: 0 },
          findings: [],
          issues: [],
        };
      },
      ...baseConfigOverride,
    });

    expect(code).toBe(0);
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0]?.files).toEqual(["src/service.ts"]);
    expect(stdout).toContain('"risk":"low"');
  });

  it("returns error when no diff input is provided", async () => {
    let stderr = "";
    const code = await runCli({
      argv: ["--file", "src/service.ts"],
      isStdinTTY: true,
      stderrWrite: (value) => {
        stderr += value;
      },
      stdoutWrite: () => {},
      ...baseConfigOverride,
    });

    expect(code).toBe(1);
    expect(stderr).toContain("Diff input is required");
  });

  it("reads context and Astmend operations from files", async () => {
    let reviewInputContext: unknown;
    let emitMemoryHints = false;

    const code = await runCli({
      argv: [
        "--diff",
        [
          "diff --git a/src/service.ts b/src/service.ts",
          "--- a/src/service.ts",
          "+++ b/src/service.ts",
          "@@ -1,1 +1,1 @@",
          "-export const value = 0;",
          "+export const value = 1;",
        ].join("\n"),
        "--file",
        "src/service.ts",
        "--context-file",
        "/tmp/context.json",
        "--astmend-ops-file",
        "/tmp/ops.json",
        "--emit-memory-hints",
      ],
      readTextFile: async (filePath) => {
        if (filePath === "/tmp/context.json") {
          return JSON.stringify({
            source: "astmend",
            proposalId: "proposal-1",
            astmendOperations: [
              {
                operationId: "op-1",
                type: "rename_symbol",
                file: "src/service.ts",
              },
            ],
          });
        }
        if (filePath === "/tmp/ops.json") {
          return JSON.stringify([
            {
              operationId: "op-2",
              type: "replace_node",
              file: "src/service.ts",
            },
          ]);
        }
        return "";
      },
      stdoutWrite: () => {},
      stderrWrite: () => {},
      reviewDiffFn: async (input, options) => {
        reviewInputContext = input.context;
        emitMemoryHints = options?.emitMemoryHints ?? false;
        return {
          schemaVersion: REVIEW_SCHEMA_VERSION,
          risk: "low",
          blocking: false,
          levelCounts: { error: 0, warn: 0, info: 0 },
          findings: [],
          issues: [],
          context: {
            proposalId: "proposal-1",
            operationIds: ["op-1", "op-2"],
          },
        };
      },
      ...baseConfigOverride,
    });

    expect(code).toBe(0);
    expect(emitMemoryHints).toBe(true);
    expect(reviewInputContext).toMatchObject({
      schemaVersion: REVIEW_SCHEMA_VERSION,
      proposalId: "proposal-1",
      astmendOperations: [{ operationId: "op-1" }, { operationId: "op-2" }],
    });
  });

  it("returns exit code 2 with --fail-on warn", async () => {
    const code = await runCli({
      argv: [
        "--diff",
        [
          "diff --git a/src/task.ts b/src/task.ts",
          "--- a/src/task.ts",
          "+++ b/src/task.ts",
          "@@ -1,1 +1,2 @@",
          "+import { helper } from './util';",
        ].join("\n"),
        "--file",
        "src/task.ts",
        "--fail-on",
        "warn",
      ],
      stdoutWrite: () => {},
      stderrWrite: () => {},
      reviewDiffFn: async () => ({
        schemaVersion: REVIEW_SCHEMA_VERSION,
        risk: "medium",
        blocking: false,
        levelCounts: { error: 0, warn: 1, info: 0 },
        findings: [],
        issues: [
          {
            type: "unused-import",
            ruleId: "DG003",
            message: "warn",
            severity: "warn",
            confidence: 0.8,
            remediation: "remove unused import",
          },
        ],
      }),
      ...baseConfigOverride,
    });

    expect(code).toBe(2);
  });

  it("outputs sarif with --format sarif", async () => {
    let stdout = "";

    const code = await runCli({
      argv: [
        "--diff",
        [
          "diff --git a/src/task.ts b/src/task.ts",
          "--- a/src/task.ts",
          "+++ b/src/task.ts",
          "@@ -1,1 +1,2 @@",
          "+import { helper } from './util';",
        ].join("\n"),
        "--file",
        "src/task.ts",
        "--format",
        "sarif",
      ],
      stdoutWrite: (value) => {
        stdout += value;
      },
      stderrWrite: () => {},
      reviewDiffFn: async () => ({
        schemaVersion: REVIEW_SCHEMA_VERSION,
        risk: "medium",
        blocking: false,
        levelCounts: { error: 0, warn: 1, info: 0 },
        findings: [],
        issues: [
          {
            type: "unused-import",
            ruleId: "DG003",
            message: "warn",
            severity: "warn",
            confidence: 0.8,
            remediation: "remove unused import",
            file: "src/task.ts",
            line: 1,
          },
        ],
      }),
      ...baseConfigOverride,
    });

    expect(code).toBe(0);
    expect(stdout).toContain('"version":"2.1.0"');
    expect(stdout).toContain('"ruleId":"DG003"');
  });

  it("supports batch input", async () => {
    let stdout = "";

    const code = await runCli({
      argv: ["--batch-file", "/tmp/batch.json", "--pretty"],
      readTextFile: async (filePath) => {
        if (filePath === "/tmp/batch.json") {
          return JSON.stringify([
            {
              diff: "diff --git a/src/a.ts b/src/a.ts",
              files: ["src/a.ts"],
            },
          ]);
        }
        return "";
      },
      reviewBatchFn: async (inputs) => {
        expect(inputs).toHaveLength(1);
        return [
          {
            schemaVersion: REVIEW_SCHEMA_VERSION,
            risk: "low",
            blocking: false,
            levelCounts: { error: 0, warn: 0, info: 0 },
            findings: [],
            issues: [],
          },
        ];
      },
      stdoutWrite: (value) => {
        stdout += value;
      },
      stderrWrite: () => {},
      ...baseConfigOverride,
    });

    expect(code).toBe(0);
    expect(stdout).toContain('"results"');
  });

  it("supports batch candidate comparison output", async () => {
    let stdout = "";

    const code = await runCli({
      argv: ["--batch-file", "/tmp/batch.json", "--compare-candidates", "--pretty"],
      readTextFile: async (filePath) => {
        if (filePath === "/tmp/batch.json") {
          return JSON.stringify([
            {
              candidateId: "safe",
              diff: "diff --git a/src/a.ts b/src/a.ts",
              files: ["src/a.ts"],
            },
          ]);
        }
        return "";
      },
      reviewBatchCandidatesFn: async (inputs) => {
        expect(inputs[0]?.candidateId).toBe("safe");
        return {
          schemaVersion: REVIEW_SCHEMA_VERSION,
          results: [
            {
              schemaVersion: REVIEW_SCHEMA_VERSION,
              risk: "low",
              blocking: false,
              levelCounts: { error: 0, warn: 0, info: 0 },
              findings: [],
              issues: [],
            },
          ],
          batchSummary: {
            recommendedCandidateId: "safe",
            reasons: ["safe has the lowest risk score"],
            scores: [
              {
                candidateId: "safe",
                index: 0,
                score: 0,
                blocking: false,
                errors: 0,
                warnings: 0,
                infos: 0,
              },
            ],
          },
        };
      },
      stdoutWrite: (value) => {
        stdout += value;
      },
      stderrWrite: () => {},
      ...baseConfigOverride,
    });

    expect(code).toBe(0);
    expect(stdout).toContain('"batchSummary"');
    expect(stdout).toContain('"recommendedCandidateId": "safe"');
  });

  it("returns parse error for unknown option", async () => {
    let stderr = "";
    const code = await runCli({
      argv: ["--unknown-option"],
      stdoutWrite: () => {},
      stderrWrite: (value) => {
        stderr += value;
      },
      ...baseConfigOverride,
    });

    expect(code).toBe(1);
    expect(stderr).toContain("Unknown option");
  });

  it("rejects removed LLM flags as unknown options", async () => {
    let stderr = "";
    const enableCode = await runCli({
      argv: ["--enable-llm"],
      stdoutWrite: () => {},
      stderrWrite: (value) => {
        stderr += value;
      },
      ...baseConfigOverride,
    });
    const relatedCode = await runCli({
      argv: ["--llm-related-code-file", "/tmp/related.txt"],
      stdoutWrite: () => {},
      stderrWrite: (value) => {
        stderr += value;
      },
      ...baseConfigOverride,
    });

    expect(enableCode).toBe(1);
    expect(relatedCode).toBe(1);
    expect(stderr).toContain("Unknown option: --enable-llm");
    expect(stderr).toContain("Unknown option: --llm-related-code-file");
  });

  it("returns error for invalid batch input payload", async () => {
    let stderr = "";
    const code = await runCli({
      argv: ["--batch-file", "/tmp/bad-batch.json"],
      readTextFile: async () => '{"invalid":true}',
      stdoutWrite: () => {},
      stderrWrite: (value) => {
        stderr += value;
      },
      ...baseConfigOverride,
    });

    expect(code).toBe(1);
    expect(stderr).toContain("Batch input must be an array");
  });

  it("uses failOn from config when CLI option is omitted", async () => {
    const code = await runCli({
      argv: [
        "--diff",
        [
          "diff --git a/src/task.ts b/src/task.ts",
          "--- a/src/task.ts",
          "+++ b/src/task.ts",
          "@@ -1,1 +1,2 @@",
          "+import { helper } from './util';",
        ].join("\n"),
        "--file",
        "src/task.ts",
      ],
      loadConfigFn: async () => ({
        config: {
          failOn: "warn",
          plugins: ["./a-plugin.mjs"],
        },
      }),
      loadPluginRulesFn: async (plugins) => {
        expect(plugins).toEqual(["./a-plugin.mjs"]);
        return [];
      },
      stdoutWrite: () => {},
      stderrWrite: () => {},
      reviewDiffFn: async () => ({
        schemaVersion: REVIEW_SCHEMA_VERSION,
        risk: "medium",
        blocking: false,
        levelCounts: { error: 0, warn: 1, info: 0 },
        findings: [],
        issues: [
          {
            type: "unused-import",
            ruleId: "DG003",
            message: "warn",
            severity: "warn",
            confidence: 0.8,
            remediation: "remove unused import",
          },
        ],
      }),
    });

    expect(code).toBe(2);
  });

  it("returns error when source files cannot be inferred", async () => {
    let stderr = "";
    const code = await runCli({
      argv: ["--diff", "@@ -1,1 +1,1 @@\n-export const a=0;\n+export const a=1;"],
      stdoutWrite: () => {},
      stderrWrite: (value) => {
        stderr += value;
      },
      ...baseConfigOverride,
    });

    expect(code).toBe(1);
    expect(stderr).toContain("Source files are required");
  });
});

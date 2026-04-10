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
      "--enable-llm",
      "--pretty",
      "--format",
      "sarif",
      "--fail-on",
      "warn",
    ]);

    expect(args.files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(args.enableLlm).toBe(true);
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

  it("reads related code from file for LLM input", async () => {
    let relatedCode = "";

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
        "--enable-llm",
        "--llm-related-code-file",
        "/tmp/related.txt",
      ],
      readTextFile: async (filePath) => {
        if (filePath === "/tmp/related.txt") {
          return "export const related = true;";
        }
        return "";
      },
      stdoutWrite: () => {},
      stderrWrite: () => {},
      reviewDiffFn: async (_input, options) => {
        relatedCode = options?.llmRelatedCode ?? "";
        return {
          schemaVersion: REVIEW_SCHEMA_VERSION,
          risk: "low",
          blocking: false,
          levelCounts: { error: 0, warn: 0, info: 0 },
          findings: [],
          issues: [],
          llm: {
            summary: "ok",
            concerns: [],
          },
        };
      },
      ...baseConfigOverride,
    });

    expect(code).toBe(0);
    expect(relatedCode).toBe("export const related = true;");
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

  it("enables llm from env without --enable-llm flag", async () => {
    const previous = process.env.DIFFGUARD_ENABLE_LLM;
    process.env.DIFFGUARD_ENABLE_LLM = "true";

    try {
      let enabledLlm = false;
      const code = await runCli({
        argv: [
          "--diff",
          "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const a=0;\n+export const a=1;",
          "--file",
          "src/a.ts",
        ],
        reviewDiffFn: async (_input, options) => {
          enabledLlm = options?.enableLlm ?? false;
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
      expect(enabledLlm).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.DIFFGUARD_ENABLE_LLM;
      } else {
        process.env.DIFFGUARD_ENABLE_LLM = previous;
      }
    }
  });

  it("builds local-openai-api llm client from env mode", async () => {
    const previousEnable = process.env.DIFFGUARD_ENABLE_LLM;
    const previousMode = process.env.DIFFGUARD_LLM_MODE;

    process.env.DIFFGUARD_ENABLE_LLM = "true";
    process.env.DIFFGUARD_LLM_MODE = "local-openai-api";

    try {
      let hasLlmClient = false;
      const code = await runCli({
        argv: [
          "--diff",
          "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const a=0;\n+export const a=1;",
          "--file",
          "src/a.ts",
        ],
        reviewDiffFn: async (_input, options) => {
          hasLlmClient = typeof options?.llmClient === "function";
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
      expect(hasLlmClient).toBe(true);
    } finally {
      if (previousEnable === undefined) {
        delete process.env.DIFFGUARD_ENABLE_LLM;
      } else {
        process.env.DIFFGUARD_ENABLE_LLM = previousEnable;
      }
      if (previousMode === undefined) {
        delete process.env.DIFFGUARD_LLM_MODE;
      } else {
        process.env.DIFFGUARD_LLM_MODE = previousMode;
      }
    }
  });
});

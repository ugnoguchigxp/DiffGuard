import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { reviewBatch, reviewDiff } from "../../src/engine/reviewEngine";
import type { Rule } from "../../src/types";

const createTempWorkspace = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "diffguard-engine-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  return root;
};

describe("reviewDiff", () => {
  it("returns high risk and blocking=true for missing function updates", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/service.ts");
      const consumerPath = path.join(workspaceRoot, "src/consumer.ts");

      await writeFile(
        servicePath,
        "export function getUser(id: string, verbose: boolean): string { return id; }\n",
      );
      await writeFile(
        consumerPath,
        [
          'import { getUser } from "./service";',
          'export const useUser = (): string => getUser("1", true);',
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export function getUser(id: string): string { return id; }",
        "+export function getUser(id: string, verbose: boolean): string { return id; }",
      ].join("\n");

      const result = await reviewDiff(
        {
          diff,
          files: ["src/service.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [servicePath, consumerPath],
        },
      );

      expect(result.risk).toBe("high");
      expect(result.blocking).toBe(true);
      expect(result.levelCounts.error).toBeGreaterThanOrEqual(1);
      expect(result.findings[0]?.id).toBe("DG001");
      expect(result.findings[0]?.level).toBe("error");
      expect(result.findings[0]?.ruleId).toBe("API_BREAK");
      expect(result.findings[0]?.metadata.blockingReason).toBe("api-compatibility");
      expect(result.issues[0]?.type).toBe("missing-update");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns medium risk for unused imports", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const taskPath = path.join(workspaceRoot, "src/task.ts");
      await writeFile(
        taskPath,
        ['import { unusedHelper } from "./util";', "export const value = 1;", ""].join("\n"),
      );

      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { unusedHelper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const result = await reviewDiff(
        {
          diff,
          files: ["src/task.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [taskPath],
        },
      );

      expect(result.risk).toBe("medium");
      expect(result.blocking).toBe(false);
      expect(result.levelCounts.warn).toBeGreaterThanOrEqual(1);
      expect(result.findings.some((f) => f.ruleId === "UNUSED_IMPORT")).toBe(true);
      expect(result.issues[0]?.type).toBe("unused-import");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("provides remediation hint in metadata", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const controllerPath = path.join(workspaceRoot, "src/userController.ts");
      await writeFile(
        controllerPath,
        [
          "export class UserController {",
          "  run() {",
          "    const repo = new UserRepository();",
          "    return repo.find();",
          "  }",
          "}",
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/userController.ts b/src/userController.ts",
        "--- a/src/userController.ts",
        "+++ b/src/userController.ts",
        "@@ -1,1 +1,2 @@",
        "+const repo = new UserRepository();",
      ].join("\n");

      const result = await reviewDiff(
        {
          diff,
          files: ["src/userController.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [controllerPath],
        },
      );

      const diIssue = result.findings.find((f) => f.ruleId === "DI_VIOLATION");
      expect(diIssue).toBeDefined();
      expect(diIssue?.metadata.remediation).toContain("constructor injection");
      expect(diIssue?.metadata.blockingReason).toBe("di-violation");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("attaches llm result when llm is enabled", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/service.ts");
      await writeFile(servicePath, "export const value = 1;\n");

      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export const value = 0;",
        "+export const value = 1;",
      ].join("\n");

      const result = await reviewDiff(
        {
          diff,
          files: ["src/service.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [servicePath],
          enableLlm: true,
          llmClient: async () => ({
            summary: "LLM summary",
            concerns: ["concern-1"],
          }),
        },
      );

      expect(result.llm?.summary).toBe("LLM summary");
      expect(result.llm?.concerns).toEqual(["concern-1"]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("aggregates issues across multiple files", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/service.ts");
      const consumerPath = path.join(workspaceRoot, "src/consumer.ts");
      const taskPath = path.join(workspaceRoot, "src/task.ts");
      await writeFile(
        servicePath,
        "export function getUser(id: string, verbose: boolean): string { return id; }\n",
      );
      await writeFile(
        consumerPath,
        [
          'import { getUser } from "./service";',
          'export const useUser = () => getUser("1", true);',
          "",
        ].join("\n"),
      );
      await writeFile(
        taskPath,
        ['import { unusedHelper } from "./util";', "export const value = 1;", ""].join("\n"),
      );

      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export function getUser(id: string): string { return id; }",
        "+export function getUser(id: string, verbose: boolean): string { return id; }",
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { unusedHelper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const result = await reviewDiff(
        {
          diff,
          files: ["src/service.ts", "src/task.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [servicePath, consumerPath, taskPath],
        },
      );

      expect(result.risk).toBe("high");
      expect(result.blocking).toBe(true);
      expect(result.issues.map((issue) => issue.type)).toEqual(
        expect.arrayContaining(["missing-update", "unused-import"]),
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns di-violation issue when controller creates repository directly", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const controllerPath = path.join(workspaceRoot, "src/userController.ts");
      await writeFile(
        controllerPath,
        [
          "export class UserController {",
          "  run() {",
          "    const repo = new UserRepository();",
          "    return repo.find();",
          "  }",
          "}",
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/userController.ts b/src/userController.ts",
        "--- a/src/userController.ts",
        "+++ b/src/userController.ts",
        "@@ -1,1 +1,2 @@",
        "+const repo = new UserRepository();",
      ].join("\n");

      const result = await reviewDiff(
        {
          diff,
          files: ["src/userController.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [controllerPath],
        },
      );

      expect(result.issues.some((issue) => issue.type === "di-violation")).toBe(true);
      expect(result.blocking).toBe(true);
      expect(result.risk).toBe("high");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("builds llm relatedCode using selector candidates", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/service.ts");
      await writeFile(servicePath, "export const value = 1;\n");

      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export const value = 0;",
        "+export const value = 1;",
      ].join("\n");

      let relatedCodeFromLlmInput = "";
      await reviewDiff(
        {
          diff,
          files: ["src/service.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [servicePath],
          enableLlm: true,
          relatedCodeCandidates: [
            { id: "a", content: "const unrelated = true;" },
            { id: "b", content: "export const value = 1;" },
          ],
          llmClient: async (input) => {
            relatedCodeFromLlmInput = input.relatedCode;
            return {
              summary: "ok",
              concerns: [],
            };
          },
        },
      );

      expect(relatedCodeFromLlmInput).toContain("export const value = 1;");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("applies rule severity overrides from config", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/service.ts");
      const consumerPath = path.join(workspaceRoot, "src/consumer.ts");
      await writeFile(
        servicePath,
        "export function getUser(id: string, verbose: boolean): string { return id; }\n",
      );
      await writeFile(
        consumerPath,
        [
          'import { getUser } from "./service";',
          'export const useUser = (): string => getUser("1", true);',
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export function getUser(id: string): string { return id; }",
        "+export function getUser(id: string, verbose: boolean): string { return id; }",
      ].join("\n");

      const result = await reviewDiff(
        {
          diff,
          files: ["src/service.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [servicePath, consumerPath],
          config: {
            rules: {
              DG001: {
                severity: "info",
                confidence: 0.5,
                remediation: "custom remediation",
              },
            },
          },
        },
      );

      expect(result.risk).toBe("low");
      expect(result.blocking).toBe(false);
      expect(result.issues[0]?.severity).toBe("info");
      expect(result.issues[0]?.confidence).toBe(0.5);
      expect(result.issues[0]?.remediation).toBe("custom remediation");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("adds fallback blocking reason when override promotes warning to error", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const taskPath = path.join(workspaceRoot, "src/task.ts");
      await writeFile(
        taskPath,
        ['import { unusedHelper } from "./util";', "export const value = 1;", ""].join("\n"),
      );

      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { unusedHelper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const result = await reviewDiff(
        {
          diff,
          files: ["src/task.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [taskPath],
          config: {
            rules: {
              DG003: {
                severity: "error",
              },
            },
          },
        },
      );

      const finding = result.findings.find((item) => item.ruleId === "UNUSED_IMPORT");
      expect(result.blocking).toBe(true);
      expect(finding?.level).toBe("error");
      expect(finding?.metadata.blockingReason).toBe("error-threshold");
      expect(result.issues[0]?.ruleId).toBe("DG003");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("supports suppressions and rule disable", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const taskPath = path.join(workspaceRoot, "src/task.ts");
      await writeFile(
        taskPath,
        ['import { unusedHelper } from "./util";', "export const value = 1;", ""].join("\n"),
      );

      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { unusedHelper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const suppressed = await reviewDiff(
        {
          diff,
          files: ["src/task.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [taskPath],
          config: {
            suppressions: [
              {
                ruleId: "DG003",
                file: "src/task.ts",
                messageIncludes: "未使用",
                expiresOn: "2999-01-01",
              },
            ],
          },
        },
      );

      expect(suppressed.issues).toHaveLength(0);

      const disabledRule = await reviewDiff(
        {
          diff,
          files: ["src/task.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [taskPath],
          config: {
            rules: {
              DG003: {
                enabled: false,
              },
            },
          },
        },
      );
      expect(disabledRule.issues).toHaveLength(0);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps date-only suppression valid through local end-of-day", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await createTempWorkspace();

    try {
      const taskPath = path.join(workspaceRoot, "src/task.ts");
      await writeFile(
        taskPath,
        ['import { unusedHelper } from "./util";', "export const value = 1;", ""].join("\n"),
      );

      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { unusedHelper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      vi.setSystemTime(new Date(2027, 11, 31, 12, 0, 0, 0));
      const activeOnSameDay = await reviewDiff(
        {
          diff,
          files: ["src/task.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [taskPath],
          config: {
            suppressions: [
              {
                ruleId: "DG003",
                file: "src/task.ts",
                expiresOn: "2027-12-31",
              },
            ],
          },
        },
      );

      expect(activeOnSameDay.issues).toHaveLength(0);

      vi.setSystemTime(new Date(2028, 0, 1, 0, 0, 0, 0));
      const expiredNextDay = await reviewDiff(
        {
          diff,
          files: ["src/task.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [taskPath],
          config: {
            suppressions: [
              {
                ruleId: "DG003",
                file: "src/task.ts",
                expiresOn: "2027-12-31",
              },
            ],
          },
        },
      );

      expect(expiredNextDay.issues).toHaveLength(1);
      expect(expiredNextDay.issues[0]?.ruleId).toBe("DG003");
    } finally {
      vi.useRealTimers();
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("supports exclude paths and plugin rules", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/service.ts");
      const consumerPath = path.join(workspaceRoot, "src/consumer.ts");
      await writeFile(
        servicePath,
        "export function getUser(id: string, verbose: boolean): string { return id; }\n",
      );
      await writeFile(
        consumerPath,
        [
          'import { getUser } from "./service";',
          'export const useUser = (): string => getUser("1", true);',
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export function getUser(id: string): string { return id; }",
        "+export function getUser(id: string, verbose: boolean): string { return id; }",
      ].join("\n");

      const pluginRule: Rule = {
        id: "PLG001",
        run: () => [
          {
            id: "PLG001",
            type: "plugin-finding",
            ruleId: "PLG001",
            message: "plugin issue",
            severity: "warn",
            confidence: 0.6,
            remediation: "plugin remediation",
            file: "src/plugin.ts",
            line: 1,
          },
        ],
      };

      const excluded = await reviewDiff(
        {
          diff,
          files: ["src/service.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [servicePath, consumerPath],
          pluginRules: [pluginRule],
          config: {
            excludePaths: ["src/service.ts"],
          },
        },
      );

      expect(excluded.issues.some((issue) => issue.ruleId === "DG001")).toBe(false);
      expect(excluded.issues.some((issue) => issue.ruleId === "PLG001")).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps issues when suppression filters do not match", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const taskPath = path.join(workspaceRoot, "src/task.ts");
      await writeFile(
        taskPath,
        ['import { unusedHelper } from "./util";', "export const value = 1;", ""].join("\n"),
      );

      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { unusedHelper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const result = await reviewDiff(
        {
          diff,
          files: ["src/task.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [taskPath],
          cache: {
            enabled: false,
            maxEntries: 2,
          },
          config: {
            suppressions: [
              { ruleId: "DG003", file: "src/other.ts" },
              { ruleId: "DG003", file: "src/task.ts", symbol: "NotMatch" },
              { ruleId: "DG003", file: "src/task.ts", messageIncludes: "not included" },
              { ruleId: "DG003", file: "src/task.ts", expiresOn: "2000-01-01" },
            ],
          },
        },
      );

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.ruleId).toBe("DG003");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not suppress plugin issue without file when file filter exists", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const sourcePath = path.join(workspaceRoot, "src/a.ts");
      await writeFile(sourcePath, "export const a = 1;\n");
      const diff = [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,1 +1,1 @@",
        "-export const a = 0;",
        "+export const a = 1;",
      ].join("\n");

      const pluginRule: Rule = {
        id: "PLG002",
        run: () => [
          {
            id: "PLG002",
            type: "plugin-finding",
            ruleId: "PLG002",
            message: "plugin issue",
            severity: "warn",
            confidence: 0.4,
            remediation: "fix plugin issue",
          },
        ],
      };

      const result = await reviewDiff(
        { diff, files: ["src/a.ts"] },
        {
          workspaceRoot,
          sourceFilePaths: [sourcePath],
          pluginRules: [pluginRule],
          config: {
            suppressions: [{ ruleId: "PLG002", file: "src/a.ts" }],
          },
        },
      );

      expect(result.issues.some((issue) => issue.ruleId === "PLG002")).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps plugin compatibility when issue id is omitted", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const sourcePath = path.join(workspaceRoot, "src/plugin.ts");
      await writeFile(sourcePath, "export const value = 1;\n");
      const diff = [
        "diff --git a/src/plugin.ts b/src/plugin.ts",
        "--- a/src/plugin.ts",
        "+++ b/src/plugin.ts",
        "@@ -1,1 +1,1 @@",
        "-export const value = 0;",
        "+export const value = 1;",
      ].join("\n");

      const pluginRule: Rule = {
        id: "PLG003",
        run: () => [
          {
            type: "plugin-finding",
            ruleId: "PLG003",
            message: "plugin issue without explicit id",
            severity: "warn",
            confidence: 0.4,
            remediation: "review plugin finding",
          },
        ],
      };

      const result = await reviewDiff(
        { diff, files: ["src/plugin.ts"] },
        {
          workspaceRoot,
          sourceFilePaths: [sourcePath],
          pluginRules: [pluginRule],
        },
      );

      expect(result.issues[0]?.ruleId).toBe("PLG003");
      expect(result.findings[0]?.id).toBe("PLG003");
      expect(result.findings[0]?.metadata.remediation).toBe("review plugin finding");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("supports batch review", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/service.ts");
      await writeFile(servicePath, "export const value = 1;\n");

      const results = await reviewBatch(
        [
          {
            diff: [
              "diff --git a/src/service.ts b/src/service.ts",
              "--- a/src/service.ts",
              "+++ b/src/service.ts",
              "@@ -1,1 +1,1 @@",
              "-export const value = 0;",
              "+export const value = 1;",
            ].join("\n"),
            files: ["src/service.ts"],
          },
        ],
        {
          workspaceRoot,
          sourceFilePaths: [servicePath],
        },
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.schemaVersion).toBe("1.0.0");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not discover workspace files when sourceFilePaths is explicitly empty", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/service.ts");
      const consumerPath = path.join(workspaceRoot, "src/consumer.ts");

      await writeFile(
        servicePath,
        "export function getUser(id: string, verbose: boolean): string { return id; }\n",
      );
      await writeFile(
        consumerPath,
        [
          'import { getUser } from "./service";',
          'export const useUser = (): string => getUser("1", true);',
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export function getUser(id: string): string { return id; }",
        "+export function getUser(id: string, verbose: boolean): string { return id; }",
      ].join("\n");

      const result = await reviewDiff(
        {
          diff,
          files: ["src/service.ts"],
        },
        {
          workspaceRoot,
          sourceFilePaths: [],
        },
      );

      expect(result.issues.some((issue) => issue.type === "missing-update")).toBe(false);
      expect(result.risk).toBe("low");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

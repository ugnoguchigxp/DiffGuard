import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createDiffGuardMcpService } from "../../src/mcp/service";

const parseJsonTextContent = (content: unknown): Record<string, unknown> => {
  if (!Array.isArray(content)) {
    throw new Error("Tool result content is not an array");
  }

  const first = content[0];
  if (!first || typeof first !== "object" || !("type" in first) || !("text" in first)) {
    throw new Error("Tool result content has unexpected shape");
  }

  if (first.type !== "text" || typeof first.text !== "string") {
    throw new Error("Tool result content is not text");
  }

  return JSON.parse(first.text) as Record<string, unknown>;
};

describe("diffGuard MCP service", () => {
  it("exposes transport-free metadata and tool definitions", () => {
    const service = createDiffGuardMcpService();

    expect(service.metadata).toEqual({
      name: "diffguard-mcp",
      version: "0.1.0",
    });
    expect(service.tools.map((tool) => tool.name)).toEqual([
      "analyze_diff",
      "review_diff",
      "review_batch",
    ]);
  });

  it("can analyze a diff without stdio", async () => {
    const service = createDiffGuardMcpService();
    const diff = [
      "diff --git a/src/service.ts b/src/service.ts",
      "--- a/src/service.ts",
      "+++ b/src/service.ts",
      "@@ -1,1 +1,1 @@",
      "-export function getUser(id: string): string { return id; }",
      "+export function getUser(id: string, verbose: boolean): string { return id; }",
    ].join("\n");

    const result = await service.callTool("analyze_diff", { diff });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeDefined();
    const payload = parseJsonTextContent(result.content);
    expect(payload.inferredFiles).toEqual(["src/service.ts"]);
  });

  it("requires workspaceRoot for host-facing review calls", async () => {
    const service = createDiffGuardMcpService();

    const result = await service.callTool("review_diff", {
      diff: "@@ -1,1 +1,1 @@\n-export const a=0;\n+export const a=1;",
      files: ["src/task.ts"],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("workspaceRoot is required");
  });

  it("reviews a diff through the service when workspaceRoot is explicit", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "diffguard-mcp-service-"));
    const service = createDiffGuardMcpService();

    try {
      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { helper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const result = await service.callTool("review_diff", {
        diff,
        files: ["src/task.ts"],
        workspaceRoot,
      });

      expect(result.isError).toBeUndefined();
      const payload = parseJsonTextContent(result.content);
      expect(payload).toHaveProperty("result");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("passes review context and memory hint option through review_diff", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "diffguard-mcp-context-"));
    const service = createDiffGuardMcpService();

    try {
      const sharedPath = path.join(workspaceRoot, "src/shared/pricing.ts");
      await writeFile(path.join(workspaceRoot, ".keep"), "");
      const diff = [
        "diff --git a/src/shared/pricing.ts b/src/shared/pricing.ts",
        "--- /dev/null",
        "+++ b/src/shared/pricing.ts",
        "@@ -0,0 +1,1 @@",
        "+export const validatePrice = () => true;",
      ].join("\n");

      const result = await service.callTool("review_diff", {
        diff,
        files: ["src/shared/pricing.ts"],
        sourceFilePaths: [sharedPath],
        workspaceRoot,
        context: {
          source: "astmend",
          proposalId: "proposal-1",
          constraints: {
            doNotExtract: ["validatePrice"],
          },
        },
        astmendOperations: [
          {
            operationId: "op-1",
            type: "extract_function",
            file: "src/features/pricing.ts",
            destinationFile: "src/shared/pricing.ts",
          },
        ],
        emitMemoryHints: true,
      });

      expect(result.isError).toBeUndefined();
      const payload = parseJsonTextContent(result.content);
      const reviewResult = payload.result as {
        context?: { proposalId?: string; operationIds?: string[] };
        memoryHints?: Array<{ source?: { operationId?: string } }>;
      };
      expect(reviewResult.context?.proposalId).toBe("proposal-1");
      expect(reviewResult.context?.operationIds).toEqual(["op-1"]);
      expect(reviewResult.memoryHints?.[0]?.source?.operationId).toBe("op-1");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns batchSummary when comparing candidates", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "diffguard-mcp-candidates-"));
    const service = createDiffGuardMcpService();

    try {
      const result = await service.callTool("review_batch", {
        workspaceRoot,
        compareCandidates: true,
        items: [
          {
            candidateId: "safe",
            diff: [
              "diff --git a/src/safe.ts b/src/safe.ts",
              "--- a/src/safe.ts",
              "+++ b/src/safe.ts",
              "@@ -1,1 +1,1 @@",
              "-export const safe = 0;",
              "+export const safe = 1;",
            ].join("\n"),
            files: ["src/safe.ts"],
          },
        ],
      });

      expect(result.isError).toBeUndefined();
      const payload = parseJsonTextContent(result.content);
      const summary = payload.batchSummary as { recommendedCandidateId?: string };
      expect(summary.recommendedCandidateId).toBe("safe");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("uses the direct-mode default workspace root when provided", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "diffguard-mcp-direct-"));
    const service = createDiffGuardMcpService({
      defaultWorkspaceRoot: workspaceRoot,
      requireWorkspaceRoot: false,
    });

    try {
      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { helper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const result = await service.callTool("review_diff", {
        diff,
        files: ["src/task.ts"],
      });

      expect(result.isError).toBeUndefined();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not leak workspace .env values into process.env", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "diffguard-mcp-env-"));
    const service = createDiffGuardMcpService();
    const previousMode = process.env.DIFFGUARD_LLM_MODE;
    delete process.env.DIFFGUARD_LLM_MODE;

    try {
      await writeFile(path.join(workspaceRoot, ".env"), "DIFFGUARD_LLM_MODE=local-openai-api\n");

      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { helper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const result = await service.callTool("review_diff", {
        diff,
        files: ["src/task.ts"],
        workspaceRoot,
      });

      expect(result.isError).toBeUndefined();
      expect(process.env.DIFFGUARD_LLM_MODE).toBeUndefined();
    } finally {
      if (previousMode !== undefined) {
        process.env.DIFFGUARD_LLM_MODE = previousMode;
      }
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

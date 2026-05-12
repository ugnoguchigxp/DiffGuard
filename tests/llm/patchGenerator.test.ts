import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { generateFixWithLocalOpenAi } from "../../src/llm/patchGenerator";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

describe("generateFixWithLocalOpenAi", () => {
  it("generates a patch using local openai api", async () => {
    const mockFileContent = "line1\nline2\ncall(old);\nline4";
    vi.mocked(readFileSync).mockReturnValue(mockFileContent);

    const result = await generateFixWithLocalOpenAi(
      {
        diff: "source diff",
        finding: {
          id: "finding1",
          ruleId: "DG001",
          message: "needs update",
          file: "src/target.ts",
          line: 3,
        },
        workspaceRoot: "/root",
      },
      {
        baseUrl: "http://localhost:44448",
        model: "gemma4",
        timeoutMs: 1000,
        maxTokens: 2048,
        temperature: 0.3,
        fetchImpl: async (url, init) => {
          const body = JSON.parse(String(init?.body));
          expect(body.messages[1].content).toContain("call(old);");
          expect(body.max_tokens).toBe(2048);
          expect(body.temperature).toBe(0.3);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: "--- a/src/target.ts\n+++ b/src/target.ts\n@@ -3,1 +3,1 @@\n-call(old);\n+call(new);",
                  },
                },
              ],
            }),
          } as Response;
        },
      },
    );

    expect(result).toBeDefined();
    expect(result?.patch).toContain("+call(new);");
    expect(result?.description).toContain("DG001");
  });

  it("extracts code snippets with code blocks", async () => {
    vi.mocked(readFileSync).mockReturnValue("dummy");

    const result = await generateFixWithLocalOpenAi(
      {
        diff: "diff",
        finding: {
          id: "f1",
          ruleId: "R1",
          message: "m",
          file: "f.ts",
          line: 1,
        },
        workspaceRoot: "/",
      },
      {
        baseUrl: "http://localhost:44448",
        model: "g",
        timeoutMs: 1000,
        maxTokens: 1024,
        temperature: 0,
        fetchImpl: async () => {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: "Here is the fix:\n```diff\n--- a/f.ts\n+++ b/f.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n```",
                  },
                },
              ],
            }),
          } as Response;
        },
      },
    );

    expect(result?.patch).toBe("--- a/f.ts\n+++ b/f.ts\n@@ -1,1 +1,1 @@\n-old\n+new");
  });

  it("returns undefined if API fails", async () => {
    vi.mocked(readFileSync).mockReturnValue("dummy");

    const result = await generateFixWithLocalOpenAi(
      {
        diff: "diff",
        finding: {
          id: "f1",
          ruleId: "R1",
          message: "m",
          file: "f.ts",
          line: 1,
        },
        workspaceRoot: "/",
      },
      {
        baseUrl: "http://localhost:44448",
        model: "g",
        timeoutMs: 1000,
        maxTokens: 1024,
        temperature: 0,
        fetchImpl: async () => {
          return { ok: false, status: 500 } as Response;
        },
      },
    );

    expect(result).toBeUndefined();
  });
});

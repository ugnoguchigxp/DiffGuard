import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createMcpServer } from "../../src/mcp/server";

const createConnectedClient = async () => {
  const server = createMcpServer();
  const client = new Client({
    name: "diffguard-test-client",
    version: "1.0.0",
  });

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const close = async (): Promise<void> => {
    await Promise.all([client.close(), server.close()]);
  };

  return { client, close };
};

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

describe("mcp server", () => {
  it("exposes expected tools", async () => {
    const { client, close } = await createConnectedClient();

    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);

      expect(names).toEqual(
        expect.arrayContaining(["analyze_diff", "review_diff", "review_batch"]),
      );
    } finally {
      await close();
    }
  });

  it("analyzes diff and returns inferred files", async () => {
    const { client, close } = await createConnectedClient();

    try {
      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export function getUser(id: string): string { return id; }",
        "+export function getUser(id: string, verbose: boolean): string { return id; }",
      ].join("\n");

      const result = await client.callTool({
        name: "analyze_diff",
        arguments: { diff },
      });

      expect(result.isError).toBeUndefined();
      const payload = parseJsonTextContent(result.content);
      expect(payload.inferredFiles).toEqual(["src/service.ts"]);
    } finally {
      await close();
    }
  });

  it("reviews a diff and returns json result", async () => {
    const { client, close } = await createConnectedClient();

    try {
      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { helper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const result = await client.callTool({
        name: "review_diff",
        arguments: {
          diff,
          files: ["src/task.ts"],
        },
      });

      expect(result.isError).toBeUndefined();
      const payload = parseJsonTextContent(result.content);
      expect(payload).toHaveProperty("result");
    } finally {
      await close();
    }
  });

  it("reviews a diff and returns sarif format", async () => {
    const { client, close } = await createConnectedClient();

    try {
      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { helper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const result = await client.callTool({
        name: "review_diff",
        arguments: {
          diff,
          files: ["src/task.ts"],
          format: "sarif",
        },
      });

      expect(result.isError).toBeUndefined();
      const payload = parseJsonTextContent(result.content);
      expect(payload).toHaveProperty("sarif");
    } finally {
      await close();
    }
  });

  it("returns tool error for invalid batch items without file headers", async () => {
    const { client, close } = await createConnectedClient();

    try {
      const result = await client.callTool({
        name: "review_batch",
        arguments: {
          items: [{ diff: "@@ -1,1 +1,1 @@\n-export const a=0;\n+export const a=1;" }],
        },
      });

      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });
});

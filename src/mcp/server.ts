#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createDiffGuardMcpService, toErrorMessage } from "./service";

export const createMcpServer = (): McpServer => {
  const service = createDiffGuardMcpService({
    defaultWorkspaceRoot: process.cwd(),
    requireWorkspaceRoot: false,
  });
  const server = new McpServer(service.metadata);

  for (const tool of service.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args) => service.callTool(tool.name, args),
    );
  }

  return server;
};

const main = async (): Promise<void> => {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }

    closed = true;
    await server.close();
  };

  const shutdown = (): void => {
    close().catch((error) => {
      process.stderr.write(`${toErrorMessage(error)}\n`);
    });
  };

  process.stdin.once("close", shutdown);
  process.stdin.once("end", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await server.connect(transport);
};

const isExecutedDirectly = (): boolean => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(entry).href === import.meta.url;
  }
};

if (isExecutedDirectly()) {
  main().catch((error) => {
    const message = toErrorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

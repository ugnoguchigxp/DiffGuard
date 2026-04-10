#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { analyzeDiff } from "../analyzer/diffAnalyzer";
import { loadDotEnvFile } from "../config/dotenv";
import { resolveLlmRuntimeSettings } from "../config/llmRuntime";
import { loadDiffGuardConfig } from "../config/loader";
import { REVIEW_SCHEMA_VERSION } from "../constants/review";
import { reviewBatch, reviewDiff } from "../engine/reviewEngine";
import { reviewWithGemma } from "../llm/gemmaClient";
import { reviewWithLocalOpenAi } from "../llm/localOpenAiClient";
import { toSarif } from "../output/sarif";
import { loadPluginRules } from "../plugins/loader";
import type { DiffGuardConfig, LlmReview, ReviewInput, Rule } from "../types";

interface RuntimeOptions {
  workspaceRoot?: string;
  configPath?: string;
  pluginPaths?: string[];
  enableLlm?: boolean;
}

interface RuntimeContext {
  workspaceRoot: string;
  config: DiffGuardConfig;
  pluginRules: Rule[];
  enableLlm: boolean;
  llmClient?: (input: { diff: string; relatedCode: string }) => Promise<LlmReview>;
}

const toErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : "Unexpected error";
};

const toToolResult = (payload: Record<string, unknown>) => {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
};

const toToolError = (message: string) => {
  return {
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
    isError: true,
  };
};

const mergeConfig = (
  base: DiffGuardConfig,
  overrides: Partial<DiffGuardConfig>,
): DiffGuardConfig => {
  return {
    ...base,
    ...overrides,
    rules: {
      ...(base.rules ?? {}),
      ...(overrides.rules ?? {}),
    },
    suppressions: overrides.suppressions ?? base.suppressions,
    plugins: overrides.plugins ?? base.plugins,
    excludePaths: overrides.excludePaths ?? base.excludePaths,
    cache: {
      ...(base.cache ?? {}),
      ...(overrides.cache ?? {}),
    },
    llm: {
      ...(base.llm ?? {}),
      ...(overrides.llm ?? {}),
    },
  };
};

const createLlmClient = (
  settings: ReturnType<typeof resolveLlmRuntimeSettings>,
): ((input: { diff: string; relatedCode: string }) => Promise<LlmReview>) => {
  if (settings.mode === "local-openai-api") {
    return (input) =>
      reviewWithLocalOpenAi(input, {
        baseUrl: settings.apiBaseUrl,
        model: settings.model,
        timeoutMs: settings.timeoutMs,
        maxTokens: settings.maxTokens,
        temperature: settings.temperature,
      });
  }

  return (input) =>
    reviewWithGemma(input, {
      command: settings.command,
      timeoutMs: settings.timeoutMs,
      noSession: settings.noSession,
      ...(settings.sessionDir ? { sessionDir: settings.sessionDir } : {}),
    });
};

const resolveWorkspaceRoot = (workspaceRoot?: string): string => {
  if (!workspaceRoot || workspaceRoot.trim().length === 0) {
    return process.cwd();
  }

  return path.isAbsolute(workspaceRoot)
    ? workspaceRoot
    : path.resolve(process.cwd(), workspaceRoot);
};

const inferFilesFromDiff = (diff: string): string[] => {
  const analysis = analyzeDiff(diff);
  return analysis.files.map((file) => file.filePath).filter((filePath) => filePath.length > 0);
};

const buildRuntimeContext = async (options: RuntimeOptions): Promise<RuntimeContext> => {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  await loadDotEnvFile(workspaceRoot);

  const loadedConfig = await loadDiffGuardConfig(workspaceRoot, options.configPath);
  const effectiveConfig = mergeConfig(loadedConfig.config, {
    ...(options.pluginPaths && options.pluginPaths.length > 0
      ? { plugins: [...(loadedConfig.config.plugins ?? []), ...options.pluginPaths] }
      : {}),
  });

  const llmSettings = resolveLlmRuntimeSettings(effectiveConfig, options.enableLlm ?? false);
  const pluginRules = effectiveConfig.plugins
    ? await loadPluginRules(effectiveConfig.plugins, workspaceRoot)
    : [];

  return {
    workspaceRoot,
    config: effectiveConfig,
    pluginRules,
    enableLlm: llmSettings.enabled,
    ...(llmSettings.enabled ? { llmClient: createLlmClient(llmSettings) } : {}),
  };
};

export const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "diffguard-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "analyze_diff",
    {
      title: "Analyze Diff",
      description: "Analyze unified diff and return detected change types with file details.",
      inputSchema: {
        diff: z.string().min(1),
      },
    },
    async ({ diff }) => {
      try {
        const analysis = analyzeDiff(diff);
        const payload = {
          analysis,
          inferredFiles: analysis.files
            .map((file) => file.filePath)
            .filter((filePath) => filePath.length > 0),
        };

        return toToolResult(payload);
      } catch (error) {
        return toToolError(toErrorMessage(error));
      }
    },
  );

  server.registerTool(
    "review_diff",
    {
      title: "Review Diff",
      description:
        "Run DiffGuard deterministic review (and optional local LLM review) against unified diff.",
      inputSchema: {
        diff: z.string().min(1),
        files: z.array(z.string().min(1)).optional(),
        workspaceRoot: z.string().min(1).optional(),
        sourceFilePaths: z.array(z.string().min(1)).optional(),
        configPath: z.string().min(1).optional(),
        pluginPaths: z.array(z.string().min(1)).optional(),
        llmRelatedCode: z.string().optional(),
        enableLlm: z.boolean().optional(),
        format: z.enum(["json", "sarif"]).optional(),
      },
    },
    async (args) => {
      try {
        const runtime = await buildRuntimeContext({
          ...(args.workspaceRoot ? { workspaceRoot: args.workspaceRoot } : {}),
          ...(args.configPath ? { configPath: args.configPath } : {}),
          ...(args.pluginPaths ? { pluginPaths: args.pluginPaths } : {}),
          ...(typeof args.enableLlm === "boolean" ? { enableLlm: args.enableLlm } : {}),
        });

        const files =
          args.files && args.files.length > 0 ? args.files : inferFilesFromDiff(args.diff);
        if (files.length === 0) {
          return toToolError(
            "Source files are required. Provide files or include paths in diff headers.",
          );
        }

        const result = await reviewDiff(
          {
            diff: args.diff,
            files,
          },
          {
            workspaceRoot: runtime.workspaceRoot,
            ...(args.sourceFilePaths ? { sourceFilePaths: args.sourceFilePaths } : {}),
            enableLlm: runtime.enableLlm,
            ...(runtime.llmClient ? { llmClient: runtime.llmClient } : {}),
            ...(args.llmRelatedCode ? { llmRelatedCode: args.llmRelatedCode } : {}),
            config: runtime.config,
            pluginRules: runtime.pluginRules,
          },
        );

        if (args.format === "sarif") {
          const sarif = toSarif([result]);
          return toToolResult({ sarif });
        }

        return toToolResult({ result });
      } catch (error) {
        return toToolError(toErrorMessage(error));
      }
    },
  );

  server.registerTool(
    "review_batch",
    {
      title: "Review Batch",
      description: "Run DiffGuard review in batch for multiple diffs.",
      inputSchema: {
        items: z
          .array(
            z.object({
              diff: z.string().min(1),
              files: z.array(z.string().min(1)).optional(),
            }),
          )
          .min(1),
        workspaceRoot: z.string().min(1).optional(),
        configPath: z.string().min(1).optional(),
        pluginPaths: z.array(z.string().min(1)).optional(),
        llmRelatedCode: z.string().optional(),
        enableLlm: z.boolean().optional(),
        format: z.enum(["json", "sarif"]).optional(),
      },
    },
    async (args) => {
      try {
        const runtime = await buildRuntimeContext({
          ...(args.workspaceRoot ? { workspaceRoot: args.workspaceRoot } : {}),
          ...(args.configPath ? { configPath: args.configPath } : {}),
          ...(args.pluginPaths ? { pluginPaths: args.pluginPaths } : {}),
          ...(typeof args.enableLlm === "boolean" ? { enableLlm: args.enableLlm } : {}),
        });

        const reviewInputs: ReviewInput[] = [];
        for (const item of args.items) {
          const files =
            item.files && item.files.length > 0 ? item.files : inferFilesFromDiff(item.diff);
          if (files.length === 0) {
            return toToolError(
              "Source files are required in every batch item. Provide files or include paths in diff headers.",
            );
          }

          reviewInputs.push({
            diff: item.diff,
            files,
          });
        }

        const results = await reviewBatch(reviewInputs, {
          workspaceRoot: runtime.workspaceRoot,
          enableLlm: runtime.enableLlm,
          ...(runtime.llmClient ? { llmClient: runtime.llmClient } : {}),
          ...(args.llmRelatedCode ? { llmRelatedCode: args.llmRelatedCode } : {}),
          config: runtime.config,
          pluginRules: runtime.pluginRules,
        });

        if (args.format === "sarif") {
          const sarif = toSarif(results);
          return toToolResult({ sarif });
        }

        return toToolResult({
          schemaVersion: REVIEW_SCHEMA_VERSION,
          results,
        });
      } catch (error) {
        return toToolError(toErrorMessage(error));
      }
    },
  );

  return server;
};

const main = async (): Promise<void> => {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

const isExecutedDirectly = (): boolean => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return pathToFileURL(entry).href === import.meta.url;
};

if (isExecutedDirectly()) {
  main().catch((error) => {
    const message = toErrorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

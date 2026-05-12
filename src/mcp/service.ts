import path from "node:path";

import { z } from "zod";

import { analyzeDiff } from "../analyzer/diffAnalyzer";
import { loadDotEnvFile } from "../config/dotenv";
import { resolveLlmRuntimeSettings } from "../config/llmRuntime";
import { loadDiffGuardConfig } from "../config/loader";
import { REVIEW_SCHEMA_VERSION } from "../constants/review";
import { mergeReviewRequestContext, mergeReviewRequestContexts } from "../context/requestContext";
import { reviewBatch, reviewBatchCandidates, reviewDiff } from "../engine/reviewEngine";
import { reviewWithGemma } from "../llm/gemmaClient";
import { reviewWithLocalOpenAi } from "../llm/localOpenAiClient";
import { generateFixWithLocalOpenAi } from "../llm/patchGenerator";
import { toSarif } from "../output/sarif";
import { loadPluginRules } from "../plugins/loader";
import {
  astmendOperationMetadataSchema,
  reviewRequestContextSchema,
} from "../schema/review.schema";
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

export interface DiffGuardMcpServiceOptions {
  defaultWorkspaceRoot?: string;
  requireWorkspaceRoot?: boolean;
}

export interface DiffGuardMcpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
}

export interface DiffGuardMcpToolResult {
  [key: string]: unknown;
  content: Array<{
    type: "text";
    text: string;
  }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface DiffGuardMcpService {
  metadata: {
    name: string;
    version: string;
  };
  tools: DiffGuardMcpToolDefinition[];
  callTool: (name: string, args: unknown) => Promise<DiffGuardMcpToolResult>;
}

const analyzeDiffInputSchema = {
  diff: z.string().min(1),
} satisfies z.ZodRawShape;

const reviewDiffInputSchema = {
  diff: z.string().min(1),
  files: z.array(z.string().min(1)).optional(),
  workspaceRoot: z.string().min(1).optional(),
  sourceFilePaths: z.array(z.string().min(1)).optional(),
  configPath: z.string().min(1).optional(),
  pluginPaths: z.array(z.string().min(1)).optional(),
  llmRelatedCode: z.string().optional(),
  enableLlm: z.boolean().optional(),
  context: reviewRequestContextSchema.optional(),
  astmendOperations: z.array(astmendOperationMetadataSchema).optional(),
  emitMemoryHints: z.boolean().optional(),
  format: z.enum(["json", "sarif"]).optional(),
} satisfies z.ZodRawShape;

const reviewBatchInputSchema = {
  items: z
    .array(
      z.object({
        diff: z.string().min(1),
        files: z.array(z.string().min(1)).optional(),
        candidateId: z.string().min(1).optional(),
        context: reviewRequestContextSchema.optional(),
        astmendOperations: z.array(astmendOperationMetadataSchema).optional(),
      }),
    )
    .min(1),
  workspaceRoot: z.string().min(1).optional(),
  configPath: z.string().min(1).optional(),
  pluginPaths: z.array(z.string().min(1)).optional(),
  llmRelatedCode: z.string().optional(),
  enableLlm: z.boolean().optional(),
  context: reviewRequestContextSchema.optional(),
  astmendOperations: z.array(astmendOperationMetadataSchema).optional(),
  emitMemoryHints: z.boolean().optional(),
  compareCandidates: z.boolean().optional(),
  format: z.enum(["json", "sarif"]).optional(),
} satisfies z.ZodRawShape;

const generateFixInputSchema = {
  diff: z.string().min(1),
  finding: z.object({
    id: z.string(),
    ruleId: z.string(),
    message: z.string(),
    file: z.string().optional(),
    line: z.number().optional(),
    symbol: z.string().optional(),
  }),
  workspaceRoot: z.string().min(1).optional(),
  configPath: z.string().min(1).optional(),
} satisfies z.ZodRawShape;

const TOOL_DEFINITIONS: DiffGuardMcpToolDefinition[] = [
  {
    name: "analyze_diff",
    title: "Analyze Diff",
    description: "Analyze unified diff and return detected change types with file details.",
    inputSchema: analyzeDiffInputSchema,
  },
  {
    name: "review_diff",
    title: "Review Diff",
    description:
      "Run DiffGuard deterministic review (and optional local LLM review) against unified diff.",
    inputSchema: reviewDiffInputSchema,
  },
  {
    name: "review_batch",
    title: "Review Batch",
    description: "Run DiffGuard review in batch for multiple diffs.",
    inputSchema: reviewBatchInputSchema,
  },
  {
    name: "generate_fix",
    title: "Generate Fix",
    description: "Generate an AI-driven fix (unified diff) for a specific finding using local LLM.",
    inputSchema: generateFixInputSchema,
  },
];

export const toErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : "Unexpected error";
};

export const toToolResult = (payload: Record<string, unknown>): DiffGuardMcpToolResult => {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
};

export const toToolError = (message: string): DiffGuardMcpToolResult => {
  return {
    content: [
      {
        type: "text",
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

const resolveWorkspaceRoot = (
  workspaceRoot: string | undefined,
  options: DiffGuardMcpServiceOptions,
): string => {
  const fallbackRoot = options.defaultWorkspaceRoot;
  if (!workspaceRoot || workspaceRoot.trim().length === 0) {
    if (fallbackRoot) {
      return fallbackRoot;
    }

    if (options.requireWorkspaceRoot ?? true) {
      throw new Error("workspaceRoot is required for host-facing review calls.");
    }

    return process.cwd();
  }

  if (path.isAbsolute(workspaceRoot)) {
    return workspaceRoot;
  }

  if (fallbackRoot) {
    return path.resolve(fallbackRoot, workspaceRoot);
  }

  if (options.requireWorkspaceRoot ?? true) {
    throw new Error("workspaceRoot must be absolute for host-facing review calls.");
  }

  return path.resolve(process.cwd(), workspaceRoot);
};

const inferFilesFromDiff = (diff: string): string[] => {
  const analysis = analyzeDiff(diff);
  return analysis.files.map((file) => file.filePath).filter((filePath) => filePath.length > 0);
};

const buildRuntimeContext = async (
  runtimeOptions: RuntimeOptions,
  serviceOptions: DiffGuardMcpServiceOptions,
): Promise<RuntimeContext> => {
  const workspaceRoot = resolveWorkspaceRoot(runtimeOptions.workspaceRoot, serviceOptions);
  const dotenv = await loadDotEnvFile(workspaceRoot, ".env", { mutateProcessEnv: false });

  const loadedConfig = await loadDiffGuardConfig(workspaceRoot, runtimeOptions.configPath);
  const effectiveConfig = mergeConfig(loadedConfig.config, {
    ...(runtimeOptions.pluginPaths && runtimeOptions.pluginPaths.length > 0
      ? { plugins: [...(loadedConfig.config.plugins ?? []), ...runtimeOptions.pluginPaths] }
      : {}),
  });

  const llmSettings = resolveLlmRuntimeSettings(
    effectiveConfig,
    runtimeOptions.enableLlm ?? false,
    {
      ...dotenv,
      ...process.env,
    },
  );
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

const reviewDiffTool = async (
  args: z.infer<z.ZodObject<typeof reviewDiffInputSchema>>,
  serviceOptions: DiffGuardMcpServiceOptions,
): Promise<DiffGuardMcpToolResult> => {
  const runtime = await buildRuntimeContext(
    {
      ...(args.workspaceRoot ? { workspaceRoot: args.workspaceRoot } : {}),
      ...(args.configPath ? { configPath: args.configPath } : {}),
      ...(args.pluginPaths ? { pluginPaths: args.pluginPaths } : {}),
      ...(typeof args.enableLlm === "boolean" ? { enableLlm: args.enableLlm } : {}),
    },
    serviceOptions,
  );

  const files = args.files && args.files.length > 0 ? args.files : inferFilesFromDiff(args.diff);
  if (files.length === 0) {
    return toToolError(
      "Source files are required. Provide files or include paths in diff headers.",
    );
  }

  const result = await reviewDiff(
    {
      diff: args.diff,
      files,
      ...(args.context || args.astmendOperations
        ? { context: mergeReviewRequestContext(args.context, args.astmendOperations ?? []) }
        : {}),
    },
    {
      workspaceRoot: runtime.workspaceRoot,
      ...(args.sourceFilePaths ? { sourceFilePaths: args.sourceFilePaths } : {}),
      enableLlm: runtime.enableLlm,
      ...(runtime.llmClient ? { llmClient: runtime.llmClient } : {}),
      ...(args.llmRelatedCode ? { llmRelatedCode: args.llmRelatedCode } : {}),
      config: runtime.config,
      pluginRules: runtime.pluginRules,
      emitMemoryHints: args.emitMemoryHints ?? false,
    },
  );

  if (args.format === "sarif") {
    const sarif = toSarif([result]);
    return toToolResult({ sarif });
  }

  return toToolResult({ result });
};

const reviewBatchTool = async (
  args: z.infer<z.ZodObject<typeof reviewBatchInputSchema>>,
  serviceOptions: DiffGuardMcpServiceOptions,
): Promise<DiffGuardMcpToolResult> => {
  const runtime = await buildRuntimeContext(
    {
      ...(args.workspaceRoot ? { workspaceRoot: args.workspaceRoot } : {}),
      ...(args.configPath ? { configPath: args.configPath } : {}),
      ...(args.pluginPaths ? { pluginPaths: args.pluginPaths } : {}),
      ...(typeof args.enableLlm === "boolean" ? { enableLlm: args.enableLlm } : {}),
    },
    serviceOptions,
  );

  const reviewInputs: ReviewInput[] = [];
  for (const item of args.items) {
    const files = item.files && item.files.length > 0 ? item.files : inferFilesFromDiff(item.diff);
    if (files.length === 0) {
      return toToolError(
        "Source files are required in every batch item. Provide files or include paths in diff headers.",
      );
    }

    reviewInputs.push({
      diff: item.diff,
      files,
      ...(item.candidateId ? { candidateId: item.candidateId } : {}),
      ...(args.context || item.context || args.astmendOperations || item.astmendOperations
        ? {
            context: mergeReviewRequestContext(
              mergeReviewRequestContexts(args.context, item.context),
              [...(args.astmendOperations ?? []), ...(item.astmendOperations ?? [])],
            ),
          }
        : {}),
    });
  }

  const reviewOptions = {
    workspaceRoot: runtime.workspaceRoot,
    enableLlm: runtime.enableLlm,
    ...(runtime.llmClient ? { llmClient: runtime.llmClient } : {}),
    ...(args.llmRelatedCode ? { llmRelatedCode: args.llmRelatedCode } : {}),
    config: runtime.config,
    pluginRules: runtime.pluginRules,
    emitMemoryHints: args.emitMemoryHints ?? false,
  };

  const batchResult = args.compareCandidates
    ? await reviewBatchCandidates(reviewInputs, reviewOptions)
    : undefined;
  const results = batchResult?.results ?? (await reviewBatch(reviewInputs, reviewOptions));

  if (args.format === "sarif") {
    const sarif = toSarif(results);
    return toToolResult({ sarif });
  }

  return toToolResult({
    ...(batchResult ?? {
      schemaVersion: REVIEW_SCHEMA_VERSION,
      results,
    }),
  });
};

export const createDiffGuardMcpService = (
  options: DiffGuardMcpServiceOptions = {},
): DiffGuardMcpService => {
  const serviceOptions: DiffGuardMcpServiceOptions = {
    requireWorkspaceRoot: options.requireWorkspaceRoot ?? true,
    ...(options.defaultWorkspaceRoot ? { defaultWorkspaceRoot: options.defaultWorkspaceRoot } : {}),
  };

  return {
    metadata: {
      name: "diffguard-mcp",
      version: "0.1.0",
    },
    tools: TOOL_DEFINITIONS,
    callTool: async (name, args) => {
      try {
        if (name === "analyze_diff") {
          const parsed = z.object(analyzeDiffInputSchema).parse(args);
          const analysis = analyzeDiff(parsed.diff);
          const payload = {
            analysis,
            inferredFiles: analysis.files
              .map((file) => file.filePath)
              .filter((filePath) => filePath.length > 0),
          };

          return toToolResult(payload);
        }

        if (name === "review_diff") {
          return await reviewDiffTool(z.object(reviewDiffInputSchema).parse(args), serviceOptions);
        }

        if (name === "review_batch") {
          return await reviewBatchTool(
            z.object(reviewBatchInputSchema).parse(args),
            serviceOptions,
          );
        }

        if (name === "generate_fix") {
          const argsObj = z.object(generateFixInputSchema).parse(args);
          const runtime = await buildRuntimeContext(
            {
              ...(argsObj.workspaceRoot ? { workspaceRoot: argsObj.workspaceRoot } : {}),
              ...(argsObj.configPath ? { configPath: argsObj.configPath } : {}),
              enableLlm: true, // Fix generation always requires LLM
            },
            serviceOptions,
          );

          if (!runtime.llmClient) {
            return toToolError("LLM is not enabled or configured correctly.");
          }

          // We need LocalOpenAiClientOptions for generateFixWithLocalOpenAi
          // Since buildRuntimeContext encapsulates the client, we might need a way to get settings
          // For now, let's re-resolve settings or use a simplified approach
          const dotenv = await loadDotEnvFile(runtime.workspaceRoot, ".env", { mutateProcessEnv: false });
          const llmSettings = resolveLlmRuntimeSettings(runtime.config, true, { ...dotenv, ...process.env });

          if (llmSettings.mode !== "local-openai-api") {
            return toToolError("generate_fix currently requires local-openai-api mode (daemon API).");
          }

          if (!argsObj.finding.file || !argsObj.finding.line) {
            return toToolError("finding.file and finding.line are required to generate a fix.");
          }

          const fix = await generateFixWithLocalOpenAi(
            {
              diff: argsObj.diff,
              finding: argsObj.finding,
              workspaceRoot: runtime.workspaceRoot,
            },
            {
              baseUrl: llmSettings.apiBaseUrl,
              model: llmSettings.model,
              timeoutMs: llmSettings.timeoutMs,
              maxTokens: llmSettings.maxTokens,
              temperature: llmSettings.temperature,
            },
          );

          return toToolResult({ fix });
        }

        return toToolError(`Unknown MCP tool: ${name}`);
      } catch (error) {
        return toToolError(toErrorMessage(error));
      }
    },
  };
};

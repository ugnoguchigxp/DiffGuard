#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { analyzeDiff } from "./analyzer/diffAnalyzer";
import { loadDotEnvFile } from "./config/dotenv";
import { resolveLlmRuntimeSettings } from "./config/llmRuntime";
import { loadDiffGuardConfig } from "./config/loader";
import { DEFAULT_FAIL_ON, DEFAULT_OUTPUT_FORMAT, REVIEW_SCHEMA_VERSION } from "./constants/review";
import { reviewBatch, reviewDiff } from "./engine/reviewEngine";
import { reviewWithGemma } from "./llm/gemmaClient";
import { reviewWithLocalOpenAi } from "./llm/localOpenAiClient";
import { toSarif } from "./output/sarif";
import { loadPluginRules } from "./plugins/loader";

import type {
  DiffAnalysis,
  DiffGuardConfig,
  LlmReview,
  ReviewInput,
  ReviewResult,
  Rule,
} from "./types";

const USAGE_TEXT = [
  "DiffGuard CLI",
  "",
  "Usage:",
  "  diffguard --diff-file <path> [--files <a,b,c>] [--workspace-root <path>] [--enable-llm]",
  "  diffguard --diff <text> [--file <path> ...] [--workspace-root <path>] [--enable-llm]",
  "  cat change.diff | diffguard [--workspace-root <path>] [--enable-llm]",
  "  diffguard --batch-file <path> [--workspace-root <path>] [--format json|sarif]",
  "",
  "Options:",
  "  --diff-file <path>           Read unified diff from a file",
  "  --diff <text>                Read unified diff from an argument",
  "  --batch-file <path>          Read batch input JSON",
  "  --files <csv>                Comma separated source file paths",
  "  --file <path>                Single source file path (repeatable)",
  "  --workspace-root <path>      Workspace root for source resolution",
  "  --enable-llm                 Force-enable local LLM review",
  "  --llm-related-code-file <p>  Related code text for LLM prompt",
  "  --config <path>              Load diffguard.config from explicit path",
  "  --plugin <path>              Additional plugin module path (repeatable)",
  "  --fail-on <none|warn|error>  Exit code 2 when matched severity exists",
  "  --format <json|sarif>        Output format",
  "  --pretty                     Pretty-print output",
  "  -h, --help                   Show this help",
].join("\n");

interface CliArgs {
  help: boolean;
  diffText?: string;
  diffFile?: string;
  batchFile?: string;
  files: string[];
  workspaceRoot?: string;
  enableLlm: boolean;
  llmRelatedCodeFile?: string;
  configFile?: string;
  plugins: string[];
  failOn?: "none" | "warn" | "error";
  format?: "json" | "sarif";
  pretty: boolean;
}

interface CliDependencies {
  argv: string[];
  cwd: () => string;
  isStdinTTY: boolean;
  readStdin: () => Promise<string>;
  readTextFile: (filePath: string) => Promise<string>;
  stdoutWrite: (value: string) => void;
  stderrWrite: (value: string) => void;
  analyzeDiffFn: (diff: string) => DiffAnalysis;
  reviewDiffFn: (
    input: ReviewInput,
    options?: {
      workspaceRoot?: string;
      sourceFilePaths?: string[];
      enableLlm?: boolean;
      llmRelatedCode?: string;
      llmClient?: (input: { diff: string; relatedCode: string }) => Promise<LlmReview>;
      config?: DiffGuardConfig;
      pluginRules?: Rule[];
    },
  ) => Promise<ReviewResult>;
  reviewBatchFn: (
    inputs: ReviewInput[],
    options?: {
      workspaceRoot?: string;
      enableLlm?: boolean;
      llmRelatedCode?: string;
      llmClient?: (input: { diff: string; relatedCode: string }) => Promise<LlmReview>;
      config?: DiffGuardConfig;
      pluginRules?: Rule[];
    },
  ) => Promise<ReviewResult[]>;
  loadConfigFn: (
    workspaceRoot: string,
    explicitConfigPath?: string,
  ) => Promise<{ config: DiffGuardConfig; filePath?: string }>;
  loadPluginRulesFn: (pluginPaths: string[], workspaceRoot: string) => Promise<Rule[]>;
  toSarifFn: (results: ReviewResult[]) => Record<string, unknown>;
}

const readAllFromStdin = async (): Promise<string> => {
  const chunks: Uint8Array[] = [];

  for await (const chunk of process.stdin) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
};

const createDefaultDependencies = (): CliDependencies => {
  return {
    argv: process.argv.slice(2),
    cwd: () => process.cwd(),
    isStdinTTY: process.stdin.isTTY ?? false,
    readStdin: readAllFromStdin,
    readTextFile: (filePath) => readFile(filePath, "utf8"),
    stdoutWrite: (value) => {
      process.stdout.write(value);
    },
    stderrWrite: (value) => {
      process.stderr.write(value);
    },
    analyzeDiffFn: analyzeDiff,
    reviewDiffFn: reviewDiff,
    reviewBatchFn: reviewBatch,
    loadConfigFn: loadDiffGuardConfig,
    loadPluginRulesFn: loadPluginRules,
    toSarifFn: toSarif,
  };
};

const requireNextValue = (argv: string[], index: number, name: string): string => {
  const next = argv[index + 1];
  if (!next || next.startsWith("-")) {
    throw new Error(`Missing value for ${name}`);
  }

  return next;
};

const splitCsv = (value: string): string[] => {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const parseFailOn = (value: string): "none" | "warn" | "error" => {
  if (value === "none" || value === "warn" || value === "error") {
    return value;
  }

  throw new Error(`Unsupported --fail-on value: ${value}`);
};

const parseFormat = (value: string): "json" | "sarif" => {
  if (value === "json" || value === "sarif") {
    return value;
  }

  throw new Error(`Unsupported --format value: ${value}`);
};

export const parseCliArgs = (argv: string[]): CliArgs => {
  const result: CliArgs = {
    help: false,
    files: [],
    enableLlm: false,
    plugins: [],
    pretty: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }

    if (arg === "--enable-llm") {
      result.enableLlm = true;
      continue;
    }

    if (arg === "--pretty") {
      result.pretty = true;
      continue;
    }

    if (arg === "--diff-file") {
      result.diffFile = requireNextValue(argv, index, "--diff-file");
      index += 1;
      continue;
    }

    if (arg === "--diff") {
      result.diffText = requireNextValue(argv, index, "--diff");
      index += 1;
      continue;
    }

    if (arg === "--batch-file") {
      result.batchFile = requireNextValue(argv, index, "--batch-file");
      index += 1;
      continue;
    }

    if (arg === "--files") {
      result.files.push(...splitCsv(requireNextValue(argv, index, "--files")));
      index += 1;
      continue;
    }

    if (arg === "--file") {
      result.files.push(requireNextValue(argv, index, "--file"));
      index += 1;
      continue;
    }

    if (arg === "--workspace-root") {
      result.workspaceRoot = requireNextValue(argv, index, "--workspace-root");
      index += 1;
      continue;
    }

    if (arg === "--llm-related-code-file") {
      result.llmRelatedCodeFile = requireNextValue(argv, index, "--llm-related-code-file");
      index += 1;
      continue;
    }

    if (arg === "--config") {
      result.configFile = requireNextValue(argv, index, "--config");
      index += 1;
      continue;
    }

    if (arg === "--plugin") {
      result.plugins.push(requireNextValue(argv, index, "--plugin"));
      index += 1;
      continue;
    }

    if (arg === "--fail-on") {
      result.failOn = parseFailOn(requireNextValue(argv, index, "--fail-on"));
      index += 1;
      continue;
    }

    if (arg === "--format") {
      result.format = parseFormat(requireNextValue(argv, index, "--format"));
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return result;
};

const inferFilesFromDiff = (
  diff: string,
  analyzeDiffFn: CliDependencies["analyzeDiffFn"],
): string[] => {
  const analysis = analyzeDiffFn(diff);
  return analysis.files.map((file) => file.filePath).filter((filePath) => filePath.length > 0);
};

const hasSeverity = (results: ReviewResult[], severity: "warn" | "error"): boolean => {
  const target = severity === "error" ? ["error"] : ["warn", "error"];
  return results.some((result) => result.issues.some((issue) => target.includes(issue.severity)));
};

const determineExitCode = (results: ReviewResult[], failOn: "none" | "warn" | "error"): number => {
  if (failOn === "none") {
    return 0;
  }

  if (failOn === "error") {
    return hasSeverity(results, "error") ? 2 : 0;
  }

  return hasSeverity(results, "warn") ? 2 : 0;
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

const parseBatchInput = (raw: string): ReviewInput[] => {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed as ReviewInput[];
  }

  if (typeof parsed === "object" && parsed !== null && "items" in parsed) {
    const value = (parsed as { items?: unknown }).items;
    if (Array.isArray(value)) {
      return value as ReviewInput[];
    }
  }

  throw new Error("Batch input must be an array of review inputs or an object with { items: [] }.");
};

const renderOutput = (
  format: "json" | "sarif",
  pretty: boolean,
  results: ReviewResult[],
  dependencies: CliDependencies,
  forceBatchShape = false,
): string => {
  if (format === "sarif") {
    const spacing = pretty ? 2 : 0;
    return `${JSON.stringify(dependencies.toSarifFn(results), null, spacing)}\n`;
  }

  const spacing = pretty ? 2 : 0;
  if (results.length === 1 && !forceBatchShape) {
    return `${JSON.stringify(results[0], null, spacing)}\n`;
  }

  return `${JSON.stringify({ schemaVersion: REVIEW_SCHEMA_VERSION, results }, null, spacing)}\n`;
};

export const runCli = async (overrides: Partial<CliDependencies> = {}): Promise<number> => {
  const dependencies = {
    ...createDefaultDependencies(),
    ...overrides,
  } satisfies CliDependencies;

  let args: CliArgs;
  try {
    args = parseCliArgs(dependencies.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse arguments";
    dependencies.stderrWrite(`${message}\n\n${USAGE_TEXT}\n`);
    return 1;
  }

  if (args.help) {
    dependencies.stdoutWrite(`${USAGE_TEXT}\n`);
    return 0;
  }

  try {
    const workspaceRoot = args.workspaceRoot ?? dependencies.cwd();
    await loadDotEnvFile(workspaceRoot);
    const loadedConfig = await dependencies.loadConfigFn(workspaceRoot, args.configFile);
    const effectiveConfig = mergeConfig(loadedConfig.config, {
      ...(args.failOn ? { failOn: args.failOn } : {}),
      ...(args.format ? { outputFormat: args.format } : {}),
      ...(args.plugins.length > 0
        ? { plugins: [...(loadedConfig.config.plugins ?? []), ...args.plugins] }
        : {}),
    });

    const failOn = effectiveConfig.failOn ?? DEFAULT_FAIL_ON;
    const format = effectiveConfig.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
    const llmSettings = resolveLlmRuntimeSettings(effectiveConfig, args.enableLlm);

    const llmRelatedCode = args.llmRelatedCodeFile
      ? await dependencies.readTextFile(args.llmRelatedCodeFile)
      : undefined;

    const pluginRules = effectiveConfig.plugins
      ? await dependencies.loadPluginRulesFn(effectiveConfig.plugins, workspaceRoot)
      : [];

    const reviewOptions = {
      workspaceRoot,
      enableLlm: llmSettings.enabled,
      ...(llmSettings.enabled ? { llmClient: createLlmClient(llmSettings) } : {}),
      ...(llmRelatedCode ? { llmRelatedCode } : {}),
      config: effectiveConfig,
      pluginRules,
    };

    if (args.batchFile) {
      const raw = await dependencies.readTextFile(args.batchFile);
      const batchInputs = parseBatchInput(raw);
      const results = await dependencies.reviewBatchFn(batchInputs, reviewOptions);

      dependencies.stdoutWrite(renderOutput(format, args.pretty, results, dependencies, true));
      return determineExitCode(results, failOn);
    }

    let diff = args.diffText;
    if (!diff && args.diffFile) {
      diff = await dependencies.readTextFile(args.diffFile);
    }

    if (!diff && !dependencies.isStdinTTY) {
      diff = await dependencies.readStdin();
    }

    if (!diff || diff.trim().length === 0) {
      dependencies.stderrWrite("Diff input is required. Use --diff-file, --diff, or stdin.\n");
      return 1;
    }

    const files =
      args.files.length > 0 ? args.files : inferFilesFromDiff(diff, dependencies.analyzeDiffFn);
    if (files.length === 0) {
      dependencies.stderrWrite(
        "Source files are required. Pass --files/--file or include paths in the diff headers.\n",
      );
      return 1;
    }

    const result = await dependencies.reviewDiffFn(
      {
        diff,
        files,
      },
      {
        ...reviewOptions,
        sourceFilePaths: files,
      },
    );

    dependencies.stdoutWrite(renderOutput(format, args.pretty, [result], dependencies));
    return determineExitCode([result], failOn);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CLI execution failed";
    dependencies.stderrWrite(`${message}\n`);
    return 1;
  }
};

const isExecutedDirectly = (): boolean => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return pathToFileURL(entry).href === import.meta.url;
};

if (isExecutedDirectly()) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

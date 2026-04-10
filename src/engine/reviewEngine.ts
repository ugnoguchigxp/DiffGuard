import { analyzeDiff } from "../analyzer/diffAnalyzer";
import { matchesGlob, normalizePathForMatch } from "../config/pattern";
import { DEFAULT_RELATED_CODE_LIMIT, MIN_RELATED_CODE_SCORE } from "../constants/embedding";
import { DEFAULT_CACHE_MAX_ENTRIES, REVIEW_SCHEMA_VERSION } from "../constants/review";
import { buildContext } from "../context/contextBuilder";
import {
  type CodeCandidate,
  type ScoredCodeCandidate,
  selectRelatedCode,
} from "../embedding/relatedCodeSelector";
import { LruCache } from "../engine/cache";
import { type GemmaReviewInput, reviewWithGemma } from "../llm/gemmaClient";
import { DEFAULT_RULES, runRules } from "../rules";
import {
  diffGuardConfigSchema,
  reviewBatchInputSchema,
  reviewInputSchema,
  reviewResultSchema,
} from "../schema/review.schema";
import type {
  DiffAnalysis,
  DiffGuardConfig,
  Issue,
  LlmReview,
  ReviewInput,
  ReviewResult,
  Rule,
  RuleConfig,
  SuppressionConfig,
} from "../types";
import { computeRisk, isBlocking } from "./risk";

const analysisCache = new LruCache<string, DiffAnalysis>(DEFAULT_CACHE_MAX_ENTRIES);

const toUnique = <T extends string>(values: T[]): T[] => {
  return Array.from(new Set(values));
};

const clone = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

const getCachedAnalysis = (
  diff: string,
  cacheEnabled: boolean,
  maxEntries: number,
): DiffAnalysis => {
  if (!cacheEnabled) {
    return analyzeDiff(diff);
  }

  analysisCache.setMaxEntries(maxEntries);

  const cached = analysisCache.get(diff);
  if (cached) {
    return clone(cached);
  }

  const analysis = analyzeDiff(diff);
  analysisCache.set(diff, analysis);
  return clone(analysis);
};

const isExcludedPath = (filePath: string, excludePaths: string[]): boolean => {
  const normalizedFilePath = normalizePathForMatch(filePath);
  return excludePaths.some((pattern) => {
    const normalizedPattern = normalizePathForMatch(pattern);
    return (
      matchesGlob(normalizedFilePath, normalizedPattern) ||
      normalizedFilePath === normalizedPattern ||
      normalizedFilePath.endsWith(`/${normalizedPattern}`)
    );
  });
};

const filterAnalysisByExcludePaths = (
  analysis: DiffAnalysis,
  excludePaths: string[],
): DiffAnalysis => {
  if (excludePaths.length === 0) {
    return analysis;
  }

  const files = analysis.files.filter((file) => !isExcludedPath(file.filePath, excludePaths));
  return {
    files,
    changeTypes: toUnique(files.flatMap((file) => file.changeTypes)),
  };
};

const filterFilePaths = (filePaths: string[], excludePaths: string[]): string[] => {
  if (excludePaths.length === 0) {
    return filePaths;
  }

  return filePaths.filter((filePath) => !isExcludedPath(filePath, excludePaths));
};

const mergeRules = (rules: Rule[]): Rule[] => {
  const map = new Map<string, Rule>();
  for (const rule of rules) {
    map.set(rule.id, rule);
  }

  return Array.from(map.values());
};

const isRuleEnabled = (rule: Rule, configRules?: Record<string, RuleConfig>): boolean => {
  if (!configRules) {
    return true;
  }

  return configRules[rule.id]?.enabled !== false;
};

const applyRuleOverrides = (issues: Issue[], configRules?: Record<string, RuleConfig>): Issue[] => {
  if (!configRules) {
    return issues;
  }

  return issues.map((issue) => {
    const override = configRules[issue.ruleId];
    if (!override) {
      return issue;
    }

    return {
      ...issue,
      ...(override.severity ? { severity: override.severity } : {}),
      ...(typeof override.confidence === "number" ? { confidence: override.confidence } : {}),
      ...(override.remediation ? { remediation: override.remediation } : {}),
    };
  });
};

const isSuppressionExpired = (suppression: SuppressionConfig): boolean => {
  if (!suppression.expiresOn) {
    return false;
  }

  const parsed = Date.parse(suppression.expiresOn);
  if (Number.isNaN(parsed)) {
    return false;
  }

  return Date.now() > parsed;
};

const suppressionMatches = (issue: Issue, suppression: SuppressionConfig): boolean => {
  if (isSuppressionExpired(suppression)) {
    return false;
  }

  if (suppression.ruleId && suppression.ruleId !== issue.ruleId) {
    return false;
  }

  if (suppression.file) {
    if (!issue.file) {
      return false;
    }

    if (!isExcludedPath(issue.file, [suppression.file])) {
      return false;
    }
  }

  if (suppression.symbol) {
    if (!issue.symbol || issue.symbol !== suppression.symbol) {
      return false;
    }
  }

  if (suppression.messageIncludes && !issue.message.includes(suppression.messageIncludes)) {
    return false;
  }

  return true;
};

const applySuppressions = (issues: Issue[], suppressions?: SuppressionConfig[]): Issue[] => {
  if (!suppressions || suppressions.length === 0) {
    return issues;
  }

  return issues.filter((issue) => {
    return !suppressions.some((suppression) => suppressionMatches(issue, suppression));
  });
};

export interface ReviewEngineOptions {
  workspaceRoot?: string;
  sourceFilePaths?: string[];
  enableLlm?: boolean;
  llmRelatedCode?: string;
  relatedCodeCandidates?: CodeCandidate[];
  relatedCodeLimit?: number;
  relatedCodeMinScore?: number;
  relatedCodeSelector?: (
    query: string,
    candidates: CodeCandidate[],
    limit: number,
    minScore: number,
  ) => ScoredCodeCandidate[];
  llmClient?: (input: GemmaReviewInput) => Promise<LlmReview>;
  config?: DiffGuardConfig;
  pluginRules?: Rule[];
  rules?: Rule[];
  cache?: {
    enabled?: boolean;
    maxEntries?: number;
  };
}

export const reviewDiff = async (
  input: ReviewInput,
  options: ReviewEngineOptions = {},
): Promise<ReviewResult> => {
  const validatedInput = reviewInputSchema.parse(input);
  const effectiveConfig = diffGuardConfigSchema.parse(options.config ?? {});

  const cacheEnabled = options.cache?.enabled ?? effectiveConfig.cache?.enabled ?? true;
  const cacheMaxEntries =
    options.cache?.maxEntries ?? effectiveConfig.cache?.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;

  const analysis = filterAnalysisByExcludePaths(
    getCachedAnalysis(validatedInput.diff, cacheEnabled, cacheMaxEntries),
    effectiveConfig.excludePaths ?? [],
  );

  const filteredSourceFilePaths = options.sourceFilePaths
    ? filterFilePaths(options.sourceFilePaths, effectiveConfig.excludePaths ?? [])
    : filterFilePaths(validatedInput.files, effectiveConfig.excludePaths ?? []);

  const context = await buildContext(analysis, {
    ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
    sourceFilePaths: filteredSourceFilePaths,
  });

  const activeRules = mergeRules([
    ...(options.rules ?? DEFAULT_RULES),
    ...(options.pluginRules ?? []),
  ]).filter((rule) => isRuleEnabled(rule, effectiveConfig.rules));

  const rawIssues = runRules(context, activeRules);
  const overriddenIssues = applyRuleOverrides(rawIssues, effectiveConfig.rules);
  const issues = applySuppressions(overriddenIssues, effectiveConfig.suppressions);

  const result: ReviewResult = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    risk: computeRisk(issues),
    blocking: isBlocking(issues),
    issues,
  };

  if (options.enableLlm) {
    const llmClient = options.llmClient ?? reviewWithGemma;
    const relatedCode = options.llmRelatedCode
      ? options.llmRelatedCode
      : options.relatedCodeCandidates && options.relatedCodeCandidates.length > 0
        ? (options.relatedCodeSelector ?? selectRelatedCode)(
            validatedInput.diff,
            options.relatedCodeCandidates,
            options.relatedCodeLimit ?? DEFAULT_RELATED_CODE_LIMIT,
            options.relatedCodeMinScore ?? MIN_RELATED_CODE_SCORE,
          )
            .map((candidate) => candidate.content)
            .join("\n\n")
        : "";
    const llm = await llmClient({
      diff: validatedInput.diff,
      relatedCode,
    });
    result.llm = llm;
  }

  return reviewResultSchema.parse(result);
};

export const reviewBatch = async (
  inputs: ReviewInput[],
  options: ReviewEngineOptions = {},
): Promise<ReviewResult[]> => {
  const validated = reviewBatchInputSchema.parse({ items: inputs });
  return Promise.all(validated.items.map((item) => reviewDiff(item, options)));
};

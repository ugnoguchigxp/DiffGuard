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
  Finding,
  Issue,
  IssueMetadata,
  LlmReview,
  ReviewInput,
  ReviewResult,
  Rule,
  RuleConfig,
  Severity,
  SuppressionConfig,
} from "../types";
import { computeRisk, isBlocking } from "./risk";

const analysisCache = new LruCache<string, DiffAnalysis>(DEFAULT_CACHE_MAX_ENTRIES);
const FINDING_RULE_ID_BY_RULE_ID: Record<string, string> = {
  DG001: "API_BREAK",
  DG002: "INTERFACE_CHANGE",
  DG003: "UNUSED_IMPORT",
  DG004: "DI_VIOLATION",
};
const BLOCKING_REASON_BY_FINDING_RULE_ID: Record<string, string> = {
  API_BREAK: "api-compatibility",
  DI_VIOLATION: "di-violation",
};

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

    const nextIssue: Issue = { ...issue };
    if (override.severity) {
      nextIssue.severity = override.severity;
    }
    if (typeof override.confidence === "number") {
      nextIssue.confidence = override.confidence;
    }
    if (override.remediation) {
      nextIssue.remediation = override.remediation;
      nextIssue.metadata = {
        ...(issue.metadata ?? {}),
        remediation: override.remediation,
      };
    }

    return nextIssue;
  });
};

const parseSuppressionExpiry = (value: string): number | undefined => {
  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return undefined;
    }

    return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
};

const isSuppressionExpired = (suppression: SuppressionConfig): boolean => {
  if (!suppression.expiresOn) {
    return false;
  }

  const expiresAt = parseSuppressionExpiry(suppression.expiresOn);
  if (expiresAt === undefined) {
    return false;
  }

  return Date.now() > expiresAt;
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

const toFindingRuleId = (issue: Issue): string => {
  const mappedFromRuleId = FINDING_RULE_ID_BY_RULE_ID[issue.ruleId];
  if (mappedFromRuleId) {
    return mappedFromRuleId;
  }

  if (issue.id) {
    const mappedFromIssueId = FINDING_RULE_ID_BY_RULE_ID[issue.id];
    if (mappedFromIssueId) {
      return mappedFromIssueId;
    }
  }

  return issue.ruleId;
};

const toFindingId = (issue: Issue, index: number): string => {
  if (issue.id && issue.id.length > 0) {
    return issue.id;
  }

  if (issue.ruleId.length > 0) {
    return issue.ruleId;
  }

  return `DGGEN${String(index + 1).padStart(3, "0")}`;
};

const toFindingMetadata = (issue: Issue, findingRuleId: string): IssueMetadata => {
  const remediation = issue.metadata?.remediation ?? issue.remediation;
  if (issue.severity !== "error") {
    return { remediation };
  }

  return {
    blockingReason:
      issue.metadata?.blockingReason ??
      BLOCKING_REASON_BY_FINDING_RULE_ID[findingRuleId] ??
      "error-threshold",
    remediation,
  };
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

  const levelCounts: Record<Severity, number> = issues.reduce<Record<Severity, number>>(
    (acc, issue) => {
      acc[issue.severity] += 1;
      return acc;
    },
    { error: 0, warn: 0, info: 0 },
  );

  const findings: Finding[] = issues.map((issue, index) => {
    const findingRuleId = toFindingRuleId(issue);
    return {
      id: toFindingId(issue, index),
      level: issue.severity,
      message: issue.message,
      file: issue.file,
      line: issue.line,
      ruleId: findingRuleId,
      metadata: toFindingMetadata(issue, findingRuleId),
    };
  });
  const blocking = isBlocking(issues);
  if (
    blocking &&
    !findings.some((finding) => finding.level === "error" && finding.metadata.blockingReason)
  ) {
    const firstErrorIndex = findings.findIndex((finding) => finding.level === "error");
    if (firstErrorIndex >= 0) {
      const firstError = findings[firstErrorIndex];
      if (firstError) {
        findings[firstErrorIndex] = {
          ...firstError,
          metadata: {
            ...firstError.metadata,
            blockingReason: "error-threshold",
          },
        };
      }
    }
  }

  const result: ReviewResult = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    risk: computeRisk(issues),
    blocking,
    levelCounts,
    findings,
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

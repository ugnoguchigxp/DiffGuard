import { analyzeDiff } from "../analyzer/diffAnalyzer";
import { matchesGlob, normalizePathForMatch } from "../config/pattern";
import { DEFAULT_CACHE_MAX_ENTRIES, REVIEW_SCHEMA_VERSION } from "../constants/review";
import { buildContext } from "../context/contextBuilder";
import { buildReviewResultContext, mergeReviewRequestContext } from "../context/requestContext";
import { LruCache } from "../engine/cache";
import { DEFAULT_RULES, runRules } from "../rules";
import { REACT_RULES, TANSTACK_QUERY_RULES } from "../rules/frameworkRules";
import {
  diffGuardConfigSchema,
  reviewBatchInputSchema,
  reviewBatchResultSchema,
  reviewInputSchema,
  reviewResultSchema,
} from "../schema/review.schema";
import type {
  DiffAnalysis,
  DiffGuardConfig,
  Finding,
  GnosisMemoryHint,
  Issue,
  IssueMetadata,
  ReviewBatchCandidateScore,
  ReviewBatchResult,
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
  DG_CONV_001: "DO_NOT_EXTRACT_VIOLATION",
  DG_SEM_001: "SEMANTIC_API_IMPACT",
  DG_REACT_001: "REACT_HOOK_ORDER",
  DG_QUERY_001: "TANSTACK_QUERY_KEY_MISMATCH",
};
const BLOCKING_REASON_BY_FINDING_RULE_ID: Record<string, string> = {
  API_BREAK: "api-compatibility",
  DI_VIOLATION: "di-violation",
  DO_NOT_EXTRACT_VIOLATION: "do-not-extract-violation",
  SEMANTIC_API_IMPACT: "semantic-api-impact",
  REACT_HOOK_ORDER: "react-hook-order",
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

const attachRequestMetadata = (
  issues: Issue[],
  resultContext:
    | {
        proposalId?: string | undefined;
        patchPlanId?: string | undefined;
        operationIds?: string[] | undefined;
      }
    | undefined,
): Issue[] => {
  if (!resultContext) {
    return issues;
  }

  const operationId = resultContext.operationIds?.[0];
  return issues.map((issue) => ({
    ...issue,
    metadata: {
      ...(issue.metadata ?? {}),
      ...(resultContext.proposalId ? { proposalId: resultContext.proposalId } : {}),
      ...(resultContext.patchPlanId ? { patchPlanId: resultContext.patchPlanId } : {}),
      ...(operationId ? { operationId } : {}),
    },
  }));
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
  const contextMetadata = {
    ...(issue.metadata?.proposalId ? { proposalId: issue.metadata.proposalId } : {}),
    ...(issue.metadata?.patchPlanId ? { patchPlanId: issue.metadata.patchPlanId } : {}),
    ...(issue.metadata?.operationId ? { operationId: issue.metadata.operationId } : {}),
  };
  if (issue.severity !== "error") {
    return { remediation, ...contextMetadata };
  }

  return {
    blockingReason:
      issue.metadata?.blockingReason ??
      BLOCKING_REASON_BY_FINDING_RULE_ID[findingRuleId] ??
      "error-threshold",
    remediation,
    ...contextMetadata,
  };
};

const categoryForFinding = (finding: Finding): GnosisMemoryHint["category"] => {
  if (finding.ruleId.includes("DI") || finding.ruleId.includes("EXTRACT")) {
    return "architecture";
  }
  if (finding.ruleId.includes("UNUSED_IMPORT")) {
    return "coding_convention";
  }
  return "debugging";
};

export const buildMemoryHints = (
  findings: Finding[],
  resultContext?: ReviewResult["context"],
): GnosisMemoryHint[] => {
  return findings
    .filter((finding) => finding.level === "error")
    .map((finding, index) => {
      const operationId = finding.metadata.operationId ?? resultContext?.operationIds?.[0];
      const evidence: GnosisMemoryHint["evidence"] = [
        {
          type: "finding",
          value: `${finding.ruleId}: ${finding.message}`,
        },
      ];
      if (operationId) {
        evidence.push({
          type: "operation",
          value: operationId,
        });
      }
      const source = {
        ...((finding.metadata.proposalId ?? resultContext?.proposalId)
          ? { proposalId: finding.metadata.proposalId ?? resultContext?.proposalId }
          : {}),
        ...((finding.metadata.patchPlanId ?? resultContext?.patchPlanId)
          ? { patchPlanId: finding.metadata.patchPlanId ?? resultContext?.patchPlanId }
          : {}),
        ...(operationId ? { operationId } : {}),
      };

      return {
        id: `memory-hint-${finding.id}-${index + 1}`,
        severity: finding.level,
        title: `DiffGuard blocked ${finding.ruleId}`,
        content: `${finding.message} Remediation: ${finding.metadata.remediation}`,
        category: categoryForFinding(finding),
        kind: "lesson",
        tags: ["diffguard", finding.ruleId, finding.metadata.blockingReason ?? "blocking"],
        evidence,
        ...(Object.keys(source).length > 0 ? { source } : {}),
      };
    });
};

export interface ReviewEngineOptions {
  workspaceRoot?: string;
  sourceFilePaths?: string[];
  config?: DiffGuardConfig;
  pluginRules?: Rule[];
  rules?: Rule[];
  emitMemoryHints?: boolean;
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
  const requestContext = mergeReviewRequestContext(validatedInput.context);
  const resultContext = buildReviewResultContext(requestContext);

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
    ...(requestContext ? { requestContext } : {}),
    semantic: effectiveConfig.semantic ?? {},
  });

  const activeRules = mergeRules([
    ...(options.rules ?? DEFAULT_RULES),
    ...(effectiveConfig.frameworkRules?.react ? REACT_RULES : []),
    ...(effectiveConfig.frameworkRules?.tanstackQuery ? TANSTACK_QUERY_RULES : []),
    ...(options.pluginRules ?? []),
  ]).filter((rule) => isRuleEnabled(rule, effectiveConfig.rules));

  const rawIssues = runRules(context, activeRules);
  const overriddenIssues = applyRuleOverrides(rawIssues, effectiveConfig.rules);
  const issues = attachRequestMetadata(
    applySuppressions(overriddenIssues, effectiveConfig.suppressions),
    resultContext,
  );

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
    ...(resultContext ? { context: resultContext } : {}),
  };

  if (options.emitMemoryHints) {
    result.memoryHints = buildMemoryHints(findings, resultContext);
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

const scoreCandidate = (
  result: ReviewResult,
  input: ReviewInput,
  index: number,
): ReviewBatchCandidateScore => {
  const errors = result.levelCounts.error;
  const warnings = result.levelCounts.warn;
  const infos = result.levelCounts.info;
  const score = (result.blocking ? 1000 : 0) + errors * 100 + warnings * 10 + infos;

  return {
    candidateId: input.candidateId ?? `candidate-${index + 1}`,
    index,
    score,
    blocking: result.blocking,
    errors,
    warnings,
    infos,
  };
};

export const reviewBatchCandidates = async (
  inputs: ReviewInput[],
  options: ReviewEngineOptions = {},
): Promise<ReviewBatchResult> => {
  const validated = reviewBatchInputSchema.parse({ items: inputs });
  const results = await Promise.all(validated.items.map((item) => reviewDiff(item, options)));
  const scores = validated.items.map((item, index) => {
    const result = results[index];
    if (!result) {
      throw new Error(`Missing review result for batch item ${index}.`);
    }

    return scoreCandidate(result, item, index);
  });
  const sortedScores = [...scores].sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }

    return left.index - right.index;
  });
  const recommended = sortedScores[0];
  const result: ReviewBatchResult = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    results,
    batchSummary: {
      ...(recommended ? { recommendedCandidateId: recommended.candidateId } : {}),
      reasons: recommended
        ? [
            `${recommended.candidateId} has the lowest risk score (${recommended.score}) with ${recommended.errors} errors and ${recommended.warnings} warnings.`,
          ]
        : [],
      scores,
    },
  };

  return reviewBatchResultSchema.parse(result);
};

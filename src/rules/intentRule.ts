import { matchesGlob, normalizePathForMatch } from "../config/pattern";
import type { Issue, Rule } from "../types";

const ID = "DG_CONV_001";
const SHARED_PATH_PATTERN = /(^|\/)(shared|common)(\/|$)/;

const pathMatches = (filePath: string, patterns: string[]): boolean => {
  const normalizedFilePath = normalizePathForMatch(filePath);
  return patterns.some((pattern) => {
    const normalizedPattern = normalizePathForMatch(pattern);
    return (
      matchesGlob(normalizedFilePath, normalizedPattern) ||
      normalizedFilePath === normalizedPattern ||
      normalizedFilePath.endsWith(`/${normalizedPattern}`)
    );
  });
};

const isSharedTarget = (filePath: string): boolean => {
  return SHARED_PATH_PATTERN.test(normalizePathForMatch(filePath));
};

const containsProtectedLogic = (line: string, values: string[]): string | undefined => {
  return values.find((value) => line.includes(value));
};

const buildIssue = (params: {
  file: string;
  line?: number;
  hunk?: string;
  symbol?: string;
}): Issue => {
  const remediation =
    "Keep protected logic in its original feature boundary or update the review context allowedSharedTargets.";
  return {
    id: ID,
    type: "do-not-extract-violation",
    ruleId: ID,
    message: "doNotExtract protected logic was moved into a shared/common target.",
    severity: "error",
    confidence: 0.88,
    remediation,
    file: params.file,
    ...(params.line ? { line: params.line } : {}),
    ...(params.hunk ? { hunk: params.hunk } : {}),
    ...(params.symbol ? { symbol: params.symbol } : {}),
    metadata: {
      blockingReason: "do-not-extract-violation",
      remediation,
    },
  };
};

export const intentRule: Rule = {
  id: ID,
  name: "do-not-extract-violation",
  defaultSeverity: "error",
  defaultConfidence: 0.88,
  defaultRemediation:
    "Keep protected logic in its original feature boundary or update allowedSharedTargets.",
  run: (ctx) => {
    const doNotExtract = ctx.requestContext?.constraints?.doNotExtract ?? [];
    if (doNotExtract.length === 0) {
      return [];
    }

    const allowedSharedTargets = ctx.requestContext?.constraints?.allowedSharedTargets ?? [];
    const issues: Issue[] = [];

    for (const file of ctx.analysis.files) {
      if (!isSharedTarget(file.filePath)) {
        continue;
      }

      if (pathMatches(file.filePath, allowedSharedTargets)) {
        continue;
      }

      for (const detail of file.addedLineDetails) {
        const protectedSymbol = containsProtectedLogic(detail.text, doNotExtract);
        if (!protectedSymbol) {
          continue;
        }

        issues.push(
          buildIssue({
            file: file.filePath,
            ...(detail.line ? { line: detail.line } : {}),
            ...(detail.hunk ? { hunk: detail.hunk } : {}),
            symbol: detail.symbol ?? protectedSymbol,
          }),
        );
      }
    }

    return issues;
  },
};

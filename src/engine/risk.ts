import type { RiskLevel, Severity } from "../types";

export interface IssueLike {
  severity: Severity;
}

export const computeRisk = (issues: IssueLike[]): RiskLevel => {
  const hasError = issues.some((issue) => issue.severity === "error");
  if (hasError) {
    return "high";
  }

  const hasWarn = issues.some((issue) => issue.severity === "warn");
  if (hasWarn) {
    return "medium";
  }

  return "low";
};

export const isBlocking = (issues: IssueLike[]): boolean => {
  return issues.some((issue) => issue.severity === "error");
};

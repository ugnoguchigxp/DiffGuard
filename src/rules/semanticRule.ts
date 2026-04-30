import type { Issue, Rule, SemanticImpact } from "../types";

const ID = "DG_SEM_001";

const buildIssue = (impact: SemanticImpact): Issue => {
  const remediation =
    "Update external call sites or keep a backward-compatible exported API adapter.";
  return {
    id: ID,
    type: impact.type,
    ruleId: ID,
    message: impact.message,
    severity: "error",
    confidence: 0.9,
    remediation,
    file: impact.file,
    ...(impact.line ? { line: impact.line } : {}),
    ...(impact.hunk ? { hunk: impact.hunk } : {}),
    symbol: impact.symbol,
    metadata: {
      blockingReason: "semantic-api-impact",
      remediation,
    },
  };
};

export const semanticRule: Rule = {
  id: ID,
  name: "semantic-api-impact",
  defaultSeverity: "error",
  defaultConfidence: 0.9,
  defaultRemediation:
    "Update external call sites or keep a backward-compatible exported API adapter.",
  run: (ctx) => ctx.semanticImpacts.map(buildIssue),
};

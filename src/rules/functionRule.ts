import type { Issue, Rule } from "../types";

const ID = "DG001";

const resolveLocation = (
  ctx: Parameters<Rule["run"]>[0],
): {
  file?: string;
  line?: number;
  hunk?: string;
  symbol?: string;
} => {
  const file = ctx.analysis.files.find((item) => item.hasFunctionSignatureChange);
  if (!file) {
    return {};
  }

  const targetSymbol = file.changedFunctionNames[0];
  const detail = targetSymbol
    ? (file.addedLineDetails.find((line) => line.symbol === targetSymbol) ??
      file.removedLineDetails[0])
    : (file.addedLineDetails[0] ?? file.removedLineDetails[0]);

  return {
    file: file.filePath,
    ...(detail?.line ? { line: detail.line } : {}),
    ...(detail?.hunk ? { hunk: detail.hunk } : {}),
    ...(targetSymbol ? { symbol: targetSymbol } : {}),
  };
};

const buildIssue = (location: ReturnType<typeof resolveLocation>): Issue => {
  return {
    id: ID,
    type: "missing-update",
    ruleId: ID,
    message: "public API changed without migration note",
    severity: "error",
    confidence: 0.92,
    remediation: "restore original signature or add adapter layer",
    ...location,
    metadata: {
      blockingReason: "api-compatibility",
      remediation: "restore original signature or add adapter layer",
    },
  };
};

export const functionRule: Rule = {
  id: ID,
  name: "function-signature-missing-update",
  defaultSeverity: "error",
  defaultConfidence: 0.92,
  defaultRemediation: "restore original signature or add adapter layer",
  run: (ctx) => {
    if (!ctx.functionChanged || !ctx.missingCallSites) {
      return [];
    }

    return [buildIssue(resolveLocation(ctx))];
  },
};

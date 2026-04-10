import type { Issue, Rule } from "../types";

const RULE_ID = "DG001";

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
    type: "missing-update",
    ruleId: RULE_ID,
    message: "関数シグネチャ変更に対して呼び出し側の更新漏れが疑われます。",
    severity: "error",
    confidence: 0.92,
    remediation:
      "変更した関数の呼び出し元を追跡し、引数・戻り値・型定義の整合性を更新してください。",
    ...location,
  };
};

export const functionRule: Rule = {
  id: RULE_ID,
  name: "function-signature-missing-update",
  defaultSeverity: "error",
  defaultConfidence: 0.92,
  defaultRemediation:
    "変更した関数の呼び出し元を追跡し、引数・戻り値・型定義の整合性を更新してください。",
  run: (ctx) => {
    if (!ctx.functionChanged || !ctx.missingCallSites) {
      return [];
    }

    return [buildIssue(resolveLocation(ctx))];
  },
};

import type { Issue, Rule } from "../types";

const ID = "DG002";

const resolveLocation = (
  ctx: Parameters<Rule["run"]>[0],
): {
  file?: string;
  line?: number;
  hunk?: string;
  symbol?: string;
} => {
  const file = ctx.analysis.files.find((item) => item.hasInterfaceChange);
  if (!file) {
    return {};
  }

  const targetSymbol = file.changedInterfaceNames[0];
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
  const remediation =
    "interface 利用箇所の型エラーを確認し、必要なプロパティ・実装を追従更新してください。";
  return {
    id: ID,
    type: "interface-impact",
    ruleId: ID,
    message: "interface 変更の影響範囲に未追従の利用箇所が疑われます。",
    severity: "warn",
    confidence: 0.82,
    remediation,
    ...location,
    metadata: {
      remediation,
    },
  };
};

export const interfaceRule: Rule = {
  id: ID,
  name: "interface-impact",
  defaultSeverity: "warn",
  defaultConfidence: 0.82,
  defaultRemediation:
    "interface 利用箇所の型エラーを確認し、必要なプロパティ・実装を追従更新してください。",
  run: (ctx) => {
    if (!ctx.interfaceChanged || !ctx.unhandledUsage) {
      return [];
    }

    return [buildIssue(resolveLocation(ctx))];
  },
};

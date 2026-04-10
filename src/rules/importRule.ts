import type { Issue, Rule } from "../types";

const RULE_ID = "DG003";

const resolveLocation = (
  ctx: Parameters<Rule["run"]>[0],
): {
  file?: string;
  line?: number;
  hunk?: string;
  symbol?: string;
} => {
  const file = ctx.analysis.files.find((item) => item.hasImportAdded);
  if (!file) {
    return {};
  }

  const detail = file.addedLineDetails.find((line) => line.text.startsWith("import "));
  return {
    file: file.filePath,
    ...(detail?.line ? { line: detail.line } : {}),
    ...(detail?.hunk ? { hunk: detail.hunk } : {}),
    ...(file.addedImportIdentifiers[0] ? { symbol: file.addedImportIdentifiers[0] } : {}),
  };
};

const buildIssue = (location: ReturnType<typeof resolveLocation>): Issue => {
  return {
    type: "unused-import",
    ruleId: RULE_ID,
    message: "追加された import が未使用の可能性があります。",
    severity: "warn",
    confidence: 0.8,
    remediation: "不要な import は削除し、必要であれば参照箇所を追加してください。",
    ...location,
  };
};

export const importRule: Rule = {
  id: RULE_ID,
  name: "unused-import",
  defaultSeverity: "warn",
  defaultConfidence: 0.8,
  defaultRemediation: "不要な import は削除し、必要であれば参照箇所を追加してください。",
  run: (ctx) => {
    if (!ctx.importAdded || !ctx.notUsed) {
      return [];
    }

    return [buildIssue(resolveLocation(ctx))];
  },
};

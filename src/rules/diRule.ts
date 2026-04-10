import type { Issue, Rule } from "../types";

const CONTROLLER_PATH_PATTERN = /(^|\/)[A-Za-z0-9_-]*controller[A-Za-z0-9_-]*\.(ts|tsx)$/i;
const NEW_REPOSITORY_PATTERN = /\bnew\s+([A-Za-z_$][\w$]*Repository)\b/;
const RULE_ID = "DG004";

const resolveLocation = (
  ctx: Parameters<Rule["run"]>[0],
): {
  file?: string;
  line?: number;
  hunk?: string;
  symbol?: string;
} => {
  const file = ctx.analysis.files.find((candidate) => {
    return (
      CONTROLLER_PATH_PATTERN.test(candidate.filePath) &&
      candidate.addedLines.some((line) => NEW_REPOSITORY_PATTERN.test(line))
    );
  });

  if (!file) {
    return {};
  }

  const detail = file.addedLineDetails.find((line) => NEW_REPOSITORY_PATTERN.test(line.text));
  const symbolMatch = detail?.text.match(NEW_REPOSITORY_PATTERN);

  return {
    file: file.filePath,
    ...(detail?.line ? { line: detail.line } : {}),
    ...(detail?.hunk ? { hunk: detail.hunk } : {}),
    ...(symbolMatch?.[1] ? { symbol: symbolMatch[1] } : {}),
  };
};

const buildIssue = (location: ReturnType<typeof resolveLocation>): Issue => {
  return {
    type: "di-violation",
    ruleId: RULE_ID,
    message:
      "Controller 層で Repository の直接生成を検出しました。DI コンテナ経由で注入してください。",
    severity: "error",
    confidence: 0.95,
    remediation:
      "Repository の new を削除し、constructor injection などで依存を受け取ってください。",
    ...location,
  };
};

export const diRule: Rule = {
  id: RULE_ID,
  name: "di-violation",
  defaultSeverity: "error",
  defaultConfidence: 0.95,
  defaultRemediation:
    "Repository の new を削除し、constructor injection などで依存を受け取ってください。",
  run: (ctx) => {
    if (!ctx.controllerHasNewRepository) {
      return [];
    }

    return [buildIssue(resolveLocation(ctx))];
  },
};

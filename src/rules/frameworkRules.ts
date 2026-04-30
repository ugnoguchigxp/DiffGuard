import type { DiffLineDetail, Issue, Rule } from "../types";

const HOOK_IN_CONDITIONAL_ID = "DG_REACT_001";
const QUERY_KEY_MISMATCH_ID = "DG_QUERY_001";

const HOOK_CALL_PATTERN = /\buse[A-Z][A-Za-z0-9_]*\s*\(/;
const CONDITIONAL_PATTERN = /^(?:if|for|while|switch)\b/;
const BARE_CONDITIONAL_PATTERN = /^(?:if|for|while|switch)\b.*\)\s*$/;
const QUERY_LINE_PATTERN = /\b(?:useQuery|queryOptions)\s*\(/;
const QUERY_KEY_PATTERN = /queryKey\s*:\s*\[([^\]]*)\]/;
const QUERY_FN_PATTERN = /queryFn\s*:\s*(?:async\s*)?\([^)]*\)\s*=>\s*([^,}]+)/;
const IDENTIFIER_PATTERN = /\b[A-Za-z_$][\w$]*\b/g;
const QUERY_REF_PATTERN = /(?:Id|ID)$/;

const braceDelta = (line: string): number => {
  return (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
};

const buildHookIssue = (detail: DiffLineDetail, filePath: string): Issue => {
  const remediation = "Move hook calls to the top level of the React component or custom hook.";
  return {
    id: HOOK_IN_CONDITIONAL_ID,
    type: "react-hook-conditional",
    ruleId: HOOK_IN_CONDITIONAL_ID,
    message: "React hook appears to be called inside a conditional statement.",
    severity: "error",
    confidence: 0.86,
    remediation,
    file: filePath,
    ...(detail.line ? { line: detail.line } : {}),
    ...(detail.hunk ? { hunk: detail.hunk } : {}),
    metadata: {
      blockingReason: "react-hook-order",
      remediation,
    },
  };
};

const buildQueryIssue = (
  detail: DiffLineDetail,
  filePath: string,
  missingIdentifier: string,
): Issue => {
  const remediation = `Include ${missingIdentifier} in queryKey or stop using it in queryFn.`;
  return {
    id: QUERY_KEY_MISMATCH_ID,
    type: "tanstack-query-key-mismatch",
    ruleId: QUERY_KEY_MISMATCH_ID,
    message: `queryFn references ${missingIdentifier}, but queryKey does not include it.`,
    severity: "warn",
    confidence: 0.78,
    remediation,
    file: filePath,
    ...(detail.line ? { line: detail.line } : {}),
    ...(detail.hunk ? { hunk: detail.hunk } : {}),
    symbol: missingIdentifier,
    metadata: {
      remediation,
    },
  };
};

export const reactHookRule: Rule = {
  id: HOOK_IN_CONDITIONAL_ID,
  name: "react-hook-conditional",
  defaultSeverity: "error",
  defaultConfidence: 0.86,
  defaultRemediation: "Move hook calls to the top level of the React component or custom hook.",
  run: (ctx) => {
    const issues: Issue[] = [];
    for (const file of ctx.analysis.files) {
      if (!file.filePath.endsWith(".tsx") && !file.filePath.endsWith(".jsx")) {
        continue;
      }

      let conditionalDepth = 0;
      let pendingConditionalStatement = false;
      for (const detail of file.addedLineDetails) {
        const startsConditional = CONDITIONAL_PATTERN.test(detail.text);
        const hookInConditionalLine = startsConditional && HOOK_CALL_PATTERN.test(detail.text);
        const hookInConditionalBlock = conditionalDepth > 0 && HOOK_CALL_PATTERN.test(detail.text);
        const hookInPendingConditional =
          pendingConditionalStatement && HOOK_CALL_PATTERN.test(detail.text);
        if (hookInConditionalLine || hookInConditionalBlock || hookInPendingConditional) {
          issues.push(buildHookIssue(detail, file.filePath));
        }

        const delta = braceDelta(detail.text);
        if (startsConditional && delta > 0) {
          conditionalDepth += delta;
        } else if (
          startsConditional &&
          !hookInConditionalLine &&
          BARE_CONDITIONAL_PATTERN.test(detail.text)
        ) {
          pendingConditionalStatement = true;
        } else if (pendingConditionalStatement && detail.text.trim().length > 0) {
          pendingConditionalStatement = false;
        }
        if (!startsConditional) {
          conditionalDepth = Math.max(0, conditionalDepth + delta);
        }
      }
    }

    return issues;
  },
};

const extractQueryKeyText = (line: string): string => {
  return line.match(QUERY_KEY_PATTERN)?.[1] ?? "";
};

const extractQueryFnReferences = (line: string): string[] => {
  const expression = line.match(QUERY_FN_PATTERN)?.[1] ?? "";
  const matches = expression.matchAll(IDENTIFIER_PATTERN);
  return Array.from(matches)
    .map((match) => match[0])
    .filter((identifier) => QUERY_REF_PATTERN.test(identifier));
};

export const tanstackQueryRule: Rule = {
  id: QUERY_KEY_MISMATCH_ID,
  name: "tanstack-query-key-mismatch",
  defaultSeverity: "warn",
  defaultConfidence: 0.78,
  defaultRemediation: "Include queryFn input identifiers in queryKey.",
  run: (ctx) => {
    const issues: Issue[] = [];
    for (const file of ctx.analysis.files) {
      if (!file.filePath.endsWith(".ts") && !file.filePath.endsWith(".tsx")) {
        continue;
      }

      for (const detail of file.addedLineDetails) {
        if (!QUERY_LINE_PATTERN.test(detail.text) || !detail.text.includes("queryFn")) {
          continue;
        }

        const queryKeyText = extractQueryKeyText(detail.text);
        for (const reference of extractQueryFnReferences(detail.text)) {
          if (!queryKeyText.includes(reference)) {
            issues.push(buildQueryIssue(detail, file.filePath, reference));
            break;
          }
        }
      }
    }

    return issues;
  },
};

export const REACT_RULES: Rule[] = [reactHookRule];
export const TANSTACK_QUERY_RULES: Rule[] = [tanstackQueryRule];

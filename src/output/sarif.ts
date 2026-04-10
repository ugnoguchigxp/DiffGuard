import type { Issue, ReviewResult } from "../types";

interface RuleDescriptor {
  id: string;
  name: string;
  shortDescription: {
    text: string;
  };
  help: {
    text: string;
  };
}

const toSarifLevel = (severity: Issue["severity"]): "note" | "warning" | "error" => {
  if (severity === "error") {
    return "error";
  }

  if (severity === "warn") {
    return "warning";
  }

  return "note";
};

const toRuleDescriptor = (issue: Issue): RuleDescriptor => {
  return {
    id: issue.ruleId,
    name: issue.type,
    shortDescription: {
      text: issue.message,
    },
    help: {
      text: issue.remediation,
    },
  };
};

export const toSarif = (results: ReviewResult[]): Record<string, unknown> => {
  const issues = results.flatMap((result) => result.issues);
  const ruleMap = new Map<string, RuleDescriptor>();

  for (const issue of issues) {
    if (!ruleMap.has(issue.ruleId)) {
      ruleMap.set(issue.ruleId, toRuleDescriptor(issue));
    }
  }

  return {
    version: "2.1.0",
    $schema: "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json",
    runs: [
      {
        tool: {
          driver: {
            name: "DiffGuard",
            rules: Array.from(ruleMap.values()),
          },
        },
        results: issues.map((issue) => {
          return {
            ruleId: issue.ruleId,
            level: toSarifLevel(issue.severity),
            message: {
              text: issue.message,
            },
            locations: issue.file
              ? [
                  {
                    physicalLocation: {
                      artifactLocation: {
                        uri: issue.file,
                      },
                      ...(issue.line
                        ? {
                            region: {
                              startLine: issue.line,
                            },
                          }
                        : {}),
                    },
                  },
                ]
              : [],
            properties: {
              type: issue.type,
              confidence: issue.confidence,
              remediation: issue.remediation,
              ...(issue.hunk ? { hunk: issue.hunk } : {}),
              ...(issue.symbol ? { symbol: issue.symbol } : {}),
            },
          };
        }),
      },
    ],
  };
};

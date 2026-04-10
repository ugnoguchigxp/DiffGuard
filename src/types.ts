export type ChangeType = "function-signature" | "interface-change" | "import-change";

export type RiskLevel = "low" | "medium" | "high";
export type Severity = "info" | "warn" | "error";

export type IssueType = string;

export interface ReviewInput {
  diff: string;
  files: string[];
}

export interface ReviewBatchInput {
  items: ReviewInput[];
}

export interface Issue {
  type: IssueType;
  ruleId: string;
  message: string;
  severity: Severity;
  confidence: number;
  remediation: string;
  file?: string | undefined;
  line?: number | undefined;
  hunk?: string | undefined;
  symbol?: string | undefined;
}

export interface LlmReview {
  summary: string;
  concerns: string[];
}

export type LlmMode = "gemma-command" | "local-openai-api";

export interface ReviewResult {
  schemaVersion: string;
  risk: RiskLevel;
  blocking: boolean;
  issues: Issue[];
  llm?: LlmReview | undefined;
}

export interface DiffLineDetail {
  text: string;
  line?: number | undefined;
  hunk?: string | undefined;
  symbol?: string | undefined;
}

export interface FileDiffAnalysis {
  filePath: string;
  addedLines: string[];
  removedLines: string[];
  addedLineDetails: DiffLineDetail[];
  removedLineDetails: DiffLineDetail[];
  changeTypes: ChangeType[];
  hasFunctionSignatureChange: boolean;
  hasInterfaceChange: boolean;
  hasImportChange: boolean;
  hasImportAdded: boolean;
  changedFunctionNames: string[];
  changedInterfaceNames: string[];
  addedImportIdentifiers: string[];
  touchedCallIdentifiers: string[];
}

export interface DiffAnalysis {
  files: FileDiffAnalysis[];
  changeTypes: ChangeType[];
}

export interface ReviewContext {
  analysis: DiffAnalysis;
  functionChanged: boolean;
  interfaceChanged: boolean;
  importAdded: boolean;
  missingCallSites: boolean;
  unhandledUsage: boolean;
  notUsed: boolean;
  controllerHasNewRepository: boolean;
}

export interface Rule {
  id: string;
  name?: string;
  defaultSeverity?: Severity;
  defaultConfidence?: number;
  defaultRemediation?: string;
  run: (ctx: ReviewContext) => Issue[];
}

export interface RuleConfig {
  enabled?: boolean | undefined;
  severity?: Severity | undefined;
  confidence?: number | undefined;
  remediation?: string | undefined;
}

export interface SuppressionConfig {
  ruleId?: string | undefined;
  file?: string | undefined;
  symbol?: string | undefined;
  messageIncludes?: string | undefined;
  reason?: string | undefined;
  expiresOn?: string | undefined;
}

export interface DiffGuardConfig {
  failOn?: "none" | "warn" | "error" | undefined;
  outputFormat?: "json" | "sarif" | undefined;
  rules?: Record<string, RuleConfig> | undefined;
  excludePaths?: string[] | undefined;
  suppressions?: SuppressionConfig[] | undefined;
  plugins?: string[] | undefined;
  cache?:
    | {
        enabled?: boolean | undefined;
        maxEntries?: number | undefined;
      }
    | undefined;
  llm?:
    | {
        enabled?: boolean | undefined;
        mode?: LlmMode | undefined;
        command?: string | undefined;
        timeoutMs?: number | undefined;
        sessionDir?: string | undefined;
        noSession?: boolean | undefined;
        apiBaseUrl?: string | undefined;
        model?: string | undefined;
        maxTokens?: number | undefined;
        temperature?: number | undefined;
      }
    | undefined;
}

export type ChangeType = "function-signature" | "interface-change" | "import-change";

export type RiskLevel = "low" | "medium" | "high";
export type Severity = "info" | "warn" | "error";

export type IssueType = string;

export type ReviewRequestSource = "converge" | "astmend" | "manual" | "unknown";
export type ReviewRequestIntent =
  | "refactor"
  | "extract"
  | "move"
  | "rename"
  | "api-change"
  | "cleanup";

export interface AstmendOperationMetadata {
  operationId: string;
  type:
    | "rename_symbol"
    | "move_symbol"
    | "extract_function"
    | "replace_node"
    | "delete_node"
    | "insert_node";
  file: string;
  symbol?: string | undefined;
  destinationFile?: string | undefined;
  beforeHash?: string | undefined;
  afterHash?: string | undefined;
}

export interface ReviewRequestContext {
  schemaVersion?: "1.0.0" | undefined;
  source?: ReviewRequestSource | undefined;
  proposalId?: string | undefined;
  patchPlanId?: string | undefined;
  intent?: ReviewRequestIntent | undefined;
  constraints?:
    | {
        doNotExtract?: string[] | undefined;
        allowedSharedTargets?: string[] | undefined;
        forbiddenSharedTargets?: string[] | undefined;
        architecturalBoundaries?:
          | Array<{
              from: string;
              to: string;
              allowed: boolean;
              reason?: string | undefined;
            }>
          | undefined;
      }
    | undefined;
  astmendOperations?: AstmendOperationMetadata[] | undefined;
}

export interface ReviewInput {
  diff: string;
  files: string[];
  candidateId?: string | undefined;
  context?: ReviewRequestContext | undefined;
}

export interface ReviewBatchInput {
  items: ReviewInput[];
}

export interface ReviewBatchCandidateScore {
  candidateId: string;
  index: number;
  score: number;
  blocking: boolean;
  errors: number;
  warnings: number;
  infos: number;
}

export interface ReviewBatchSummary {
  recommendedCandidateId?: string | undefined;
  reasons: string[];
  scores: ReviewBatchCandidateScore[];
}

export interface ReviewBatchResult {
  schemaVersion: string;
  results: ReviewResult[];
  batchSummary?: ReviewBatchSummary | undefined;
}

export interface IssueMetadata {
  blockingReason?: string | undefined;
  remediation?: string | undefined;
  proposalId?: string | undefined;
  patchPlanId?: string | undefined;
  operationId?: string | undefined;
}

export interface SuggestedFix {
  description: string;
  patch: string;
}

export interface Issue {
  id?: string | undefined;
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
  metadata?: IssueMetadata | undefined;
  fix?: SuggestedFix | undefined;
}

export interface LlmReview {
  summary: string;
  concerns: string[];
}

export type LlmMode = "gemma-command" | "local-openai-api";

export interface Finding {
  id: string;
  level: Severity;
  message: string;
  file?: string | undefined;
  line?: number | undefined;
  symbol?: string | undefined;
  ruleId: string;
  metadata: IssueMetadata;
  fix?: SuggestedFix | undefined;
}

export interface ReviewResult {
  schemaVersion: string;
  risk: RiskLevel;
  blocking: boolean;
  levelCounts: Record<Severity, number>;
  findings: Finding[];
  issues: Issue[];
  llm?: LlmReview | undefined;
  context?:
    | {
        proposalId?: string | undefined;
        patchPlanId?: string | undefined;
        operationIds?: string[] | undefined;
      }
    | undefined;
  memoryHints?: GnosisMemoryHint[] | undefined;
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

export type SemanticImpactType = "export-signature-change" | "export-removed";

export interface SemanticImpact {
  type: SemanticImpactType;
  file: string;
  symbol: string;
  message: string;
  line?: number | undefined;
  hunk?: string | undefined;
  referenceCount: number;
}

export interface ReviewContext {
  analysis: DiffAnalysis;
  requestContext?: ReviewRequestContext | undefined;
  semanticImpacts: SemanticImpact[];
  functionChanged: boolean;
  interfaceChanged: boolean;
  importAdded: boolean;
  missingCallSites: boolean;
  unhandledUsage: boolean;
  notUsed: boolean;
  controllerHasNewRepository: boolean;
}

export interface GnosisMemoryHint {
  id: string;
  severity: Severity;
  title: string;
  content: string;
  category: "architecture" | "debugging" | "testing" | "coding_convention" | "workflow";
  kind: "lesson" | "risk" | "rule" | "procedure";
  tags: string[];
  evidence: Array<{
    type: "finding" | "issue" | "diff" | "operation";
    value: string;
  }>;
  source?:
    | {
        proposalId?: string | undefined;
        patchPlanId?: string | undefined;
        operationId?: string | undefined;
      }
    | undefined;
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
  semantic?:
    | {
        enabled?: boolean | undefined;
        maxFiles?: number | undefined;
        timeoutMs?: number | undefined;
      }
    | undefined;
  frameworkRules?:
    | {
        react?: boolean | undefined;
        tanstackQuery?: boolean | undefined;
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

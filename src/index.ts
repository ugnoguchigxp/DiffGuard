export { analyzeDiff } from "./analyzer/diffAnalyzer";
export {
  buildMemoryHints,
  reviewBatch,
  reviewBatchCandidates,
  reviewDiff,
} from "./engine/reviewEngine";
export type {
  DiffGuardMcpService,
  DiffGuardMcpServiceOptions,
  DiffGuardMcpToolDefinition,
  DiffGuardMcpToolResult,
} from "./mcp/service";
export { createDiffGuardMcpService } from "./mcp/service";
export type {
  AstmendOperationMetadata,
  DiffAnalysis,
  DiffGuardConfig,
  GnosisMemoryHint,
  ReviewBatchCandidateScore,
  ReviewBatchResult,
  ReviewBatchSummary,
  ReviewInput,
  ReviewRequestContext,
  ReviewResult,
  Rule,
  SemanticImpact,
  SemanticImpactType,
} from "./types";

export { analyzeDiff } from "./analyzer/diffAnalyzer";
export { reviewBatch, reviewDiff } from "./engine/reviewEngine";
export type {
  DiffGuardMcpService,
  DiffGuardMcpServiceOptions,
  DiffGuardMcpToolDefinition,
  DiffGuardMcpToolResult,
} from "./mcp/service";
export { createDiffGuardMcpService } from "./mcp/service";
export type {
  DiffAnalysis,
  DiffGuardConfig,
  ReviewInput,
  ReviewResult,
  Rule,
} from "./types";

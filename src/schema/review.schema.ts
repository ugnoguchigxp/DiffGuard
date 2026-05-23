import { z } from "zod";

export const changeTypeSchema = z.enum(["function-signature", "interface-change", "import-change"]);

export const severitySchema = z.enum(["info", "warn", "error"]);

export const issueTypeSchema = z.string().min(1);

export const astmendOperationMetadataSchema = z.object({
  operationId: z.string().min(1),
  type: z.enum([
    "rename_symbol",
    "move_symbol",
    "extract_function",
    "replace_node",
    "delete_node",
    "insert_node",
  ]),
  file: z.string().min(1),
  symbol: z.string().min(1).optional(),
  destinationFile: z.string().min(1).optional(),
  beforeHash: z.string().min(1).optional(),
  afterHash: z.string().min(1).optional(),
});

export const reviewRequestContextSchema = z.object({
  schemaVersion: z.literal("1.0.0").optional(),
  source: z.enum(["converge", "astmend", "manual", "unknown"]).optional(),
  proposalId: z.string().min(1).optional(),
  patchPlanId: z.string().min(1).optional(),
  intent: z.enum(["refactor", "extract", "move", "rename", "api-change", "cleanup"]).optional(),
  constraints: z
    .object({
      doNotExtract: z.array(z.string().min(1)).optional(),
      allowedSharedTargets: z.array(z.string().min(1)).optional(),
      forbiddenSharedTargets: z.array(z.string().min(1)).optional(),
      architecturalBoundaries: z
        .array(
          z.object({
            from: z.string().min(1),
            to: z.string().min(1),
            allowed: z.boolean(),
            reason: z.string().min(1).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  astmendOperations: z.array(astmendOperationMetadataSchema).optional(),
});

export const reviewInputSchema = z.object({
  diff: z.string().min(1),
  files: z.array(z.string().min(1)),
  candidateId: z.string().min(1).optional(),
  context: reviewRequestContextSchema.optional(),
});

export const reviewBatchInputSchema = z.object({
  items: z.array(reviewInputSchema),
});

export const reviewBatchCandidateScoreSchema = z.object({
  candidateId: z.string().min(1),
  index: z.number().int().nonnegative(),
  score: z.number().nonnegative(),
  blocking: z.boolean(),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  infos: z.number().int().nonnegative(),
});

export const reviewBatchSummarySchema = z.object({
  recommendedCandidateId: z.string().min(1).optional(),
  reasons: z.array(z.string().min(1)),
  scores: z.array(reviewBatchCandidateScoreSchema),
});

export const issueMetadataSchema = z.object({
  blockingReason: z.string().optional(),
  remediation: z.string().optional(),
  proposalId: z.string().optional(),
  patchPlanId: z.string().optional(),
  operationId: z.string().optional(),
});

export const issueSchema = z.object({
  id: z.string().min(1).optional(),
  type: issueTypeSchema,
  ruleId: z.string().min(1),
  message: z.string().min(1),
  severity: severitySchema,
  confidence: z.number().min(0).max(1),
  remediation: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  hunk: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  metadata: issueMetadataSchema.optional(),
});

export const findingMetadataSchema = issueMetadataSchema.extend({
  remediation: z.string().min(1),
});

export const findingSchema = z.object({
  id: z.string().min(1),
  level: severitySchema,
  message: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  ruleId: z.string().min(1),
  metadata: findingMetadataSchema,
});

export const levelCountsSchema = z.object({
  error: z.number().int().nonnegative(),
  warn: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});

export const reviewResultContextSchema = z.object({
  proposalId: z.string().min(1).optional(),
  patchPlanId: z.string().min(1).optional(),
  operationIds: z.array(z.string().min(1)).optional(),
});

export const gnosisMemoryHintSchema = z.object({
  id: z.string().min(1),
  severity: severitySchema,
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.enum(["architecture", "debugging", "testing", "coding_convention", "workflow"]),
  kind: z.enum(["lesson", "risk", "rule", "procedure"]),
  tags: z.array(z.string().min(1)),
  evidence: z.array(
    z.object({
      type: z.enum(["finding", "issue", "diff", "operation"]),
      value: z.string().min(1),
    }),
  ),
  source: z
    .object({
      proposalId: z.string().min(1).optional(),
      patchPlanId: z.string().min(1).optional(),
      operationId: z.string().min(1).optional(),
    })
    .optional(),
});

export const reviewResultSchema = z.object({
  schemaVersion: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]),
  blocking: z.boolean(),
  levelCounts: levelCountsSchema.default({
    error: 0,
    warn: 0,
    info: 0,
  }),
  findings: z.array(findingSchema).default([]),
  issues: z.array(issueSchema),
  context: reviewResultContextSchema.optional(),
  memoryHints: z.array(gnosisMemoryHintSchema).optional(),
});

export const reviewBatchResultSchema = z.object({
  schemaVersion: z.string().min(1),
  results: z.array(reviewResultSchema),
  batchSummary: reviewBatchSummarySchema.optional(),
});

const ruleConfigSchema = z.object({
  enabled: z.boolean().optional(),
  severity: severitySchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  remediation: z.string().min(1).optional(),
});

const suppressionConfigSchema = z.object({
  ruleId: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  messageIncludes: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  expiresOn: z.string().min(1).optional(),
});

export const diffGuardConfigSchema = z
  .object({
    failOn: z.enum(["none", "warn", "error"]).optional(),
    outputFormat: z.enum(["json", "sarif"]).optional(),
    rules: z.record(z.string().min(1), ruleConfigSchema).optional(),
    excludePaths: z.array(z.string().min(1)).optional(),
    suppressions: z.array(suppressionConfigSchema).optional(),
    plugins: z.array(z.string().min(1)).optional(),
    cache: z
      .object({
        enabled: z.boolean().optional(),
        maxEntries: z.number().int().positive().optional(),
      })
      .optional(),
    semantic: z
      .object({
        enabled: z.boolean().optional(),
        maxFiles: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .optional(),
    frameworkRules: z
      .object({
        react: z.boolean().optional(),
        tanstackQuery: z.boolean().optional(),
      })
      .optional(),
    // Legacy LLM config is explicitly rejected while other unknown keys remain forward-compatible.
    llm: z.never().optional(),
  })
  .strip();

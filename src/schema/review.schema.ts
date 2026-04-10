import { z } from "zod";

export const changeTypeSchema = z.enum(["function-signature", "interface-change", "import-change"]);

export const severitySchema = z.enum(["info", "warn", "error"]);

export const issueTypeSchema = z.string().min(1);

export const reviewInputSchema = z.object({
  diff: z.string().min(1),
  files: z.array(z.string().min(1)),
});

export const reviewBatchInputSchema = z.object({
  items: z.array(reviewInputSchema),
});

export const issueSchema = z.object({
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
});

export const llmReviewSchema = z.object({
  summary: z.string(),
  concerns: z.array(z.string()),
});

export const reviewResultSchema = z.object({
  schemaVersion: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]),
  blocking: z.boolean(),
  issues: z.array(issueSchema),
  llm: llmReviewSchema.optional(),
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

export const diffGuardConfigSchema = z.object({
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
  llm: z
    .object({
      enabled: z.boolean().optional(),
      mode: z.enum(["gemma-command", "local-openai-api"]).optional(),
      command: z.string().min(1).optional(),
      timeoutMs: z.number().int().positive().optional(),
      sessionDir: z.string().min(1).optional(),
      noSession: z.boolean().optional(),
      apiBaseUrl: z.string().url().optional(),
      model: z.string().min(1).optional(),
      maxTokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional(),
});

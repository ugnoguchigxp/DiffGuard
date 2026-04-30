import { REVIEW_SCHEMA_VERSION } from "../constants/review";
import {
  astmendOperationMetadataSchema,
  reviewRequestContextSchema,
} from "../schema/review.schema";
import type { AstmendOperationMetadata, ReviewRequestContext, ReviewResult } from "../types";

const toUnique = (values: string[]): string[] => Array.from(new Set(values));

const mergeUnique = (left: string[] = [], right: string[] = []): string[] => {
  return toUnique([...left, ...right]);
};

export const parseReviewRequestContext = (value: unknown): ReviewRequestContext => {
  const parsed = reviewRequestContextSchema.parse(value);
  return {
    schemaVersion: parsed.schemaVersion ?? REVIEW_SCHEMA_VERSION,
    ...(parsed.source ? { source: parsed.source } : {}),
    ...(parsed.proposalId ? { proposalId: parsed.proposalId } : {}),
    ...(parsed.patchPlanId ? { patchPlanId: parsed.patchPlanId } : {}),
    ...(parsed.intent ? { intent: parsed.intent } : {}),
    ...(parsed.constraints ? { constraints: parsed.constraints } : {}),
    ...(parsed.astmendOperations && parsed.astmendOperations.length > 0
      ? { astmendOperations: parsed.astmendOperations }
      : {}),
  };
};

export const parseAstmendOperations = (value: unknown): AstmendOperationMetadata[] => {
  return astmendOperationMetadataSchema.array().parse(value);
};

export const mergeAstmendOperations = (
  base: AstmendOperationMetadata[] = [],
  overrides: AstmendOperationMetadata[] = [],
): AstmendOperationMetadata[] => {
  const map = new Map<string, AstmendOperationMetadata>();
  for (const operation of base) {
    map.set(operation.operationId, operation);
  }
  for (const operation of overrides) {
    map.set(operation.operationId, operation);
  }

  return Array.from(map.values());
};

export const mergeReviewRequestContext = (
  base?: ReviewRequestContext,
  astmendOperations: AstmendOperationMetadata[] = [],
): ReviewRequestContext | undefined => {
  if (!base && astmendOperations.length === 0) {
    return undefined;
  }

  const parsedBase: ReviewRequestContext = base
    ? parseReviewRequestContext(base)
    : { schemaVersion: REVIEW_SCHEMA_VERSION };
  const mergedOperations = mergeAstmendOperations(
    parsedBase.astmendOperations ?? [],
    astmendOperations,
  );

  return {
    ...parsedBase,
    ...(mergedOperations.length > 0 ? { astmendOperations: mergedOperations } : {}),
  };
};

export const mergeReviewRequestContexts = (
  base?: ReviewRequestContext,
  override?: ReviewRequestContext,
  astmendOperations: AstmendOperationMetadata[] = [],
): ReviewRequestContext | undefined => {
  if (!base && !override && astmendOperations.length === 0) {
    return undefined;
  }

  const parsedBase = base ? parseReviewRequestContext(base) : undefined;
  const parsedOverride = override ? parseReviewRequestContext(override) : undefined;
  const baseConstraints = parsedBase?.constraints;
  const overrideConstraints = parsedOverride?.constraints;
  const constraints =
    baseConstraints || overrideConstraints
      ? {
          doNotExtract: mergeUnique(
            baseConstraints?.doNotExtract,
            overrideConstraints?.doNotExtract,
          ),
          allowedSharedTargets: mergeUnique(
            baseConstraints?.allowedSharedTargets,
            overrideConstraints?.allowedSharedTargets,
          ),
          forbiddenSharedTargets: mergeUnique(
            baseConstraints?.forbiddenSharedTargets,
            overrideConstraints?.forbiddenSharedTargets,
          ),
          architecturalBoundaries: [
            ...(baseConstraints?.architecturalBoundaries ?? []),
            ...(overrideConstraints?.architecturalBoundaries ?? []),
          ],
        }
      : undefined;
  const cleanedConstraints =
    constraints &&
    (constraints.doNotExtract.length > 0 ||
      constraints.allowedSharedTargets.length > 0 ||
      constraints.forbiddenSharedTargets.length > 0 ||
      constraints.architecturalBoundaries.length > 0)
      ? {
          ...(constraints.doNotExtract.length > 0
            ? { doNotExtract: constraints.doNotExtract }
            : {}),
          ...(constraints.allowedSharedTargets.length > 0
            ? { allowedSharedTargets: constraints.allowedSharedTargets }
            : {}),
          ...(constraints.forbiddenSharedTargets.length > 0
            ? { forbiddenSharedTargets: constraints.forbiddenSharedTargets }
            : {}),
          ...(constraints.architecturalBoundaries.length > 0
            ? { architecturalBoundaries: constraints.architecturalBoundaries }
            : {}),
        }
      : undefined;

  return mergeReviewRequestContext(
    {
      ...((parsedOverride?.schemaVersion ?? parsedBase?.schemaVersion)
        ? { schemaVersion: parsedOverride?.schemaVersion ?? parsedBase?.schemaVersion }
        : {}),
      ...((parsedOverride?.source ?? parsedBase?.source)
        ? { source: parsedOverride?.source ?? parsedBase?.source }
        : {}),
      ...((parsedOverride?.proposalId ?? parsedBase?.proposalId)
        ? { proposalId: parsedOverride?.proposalId ?? parsedBase?.proposalId }
        : {}),
      ...((parsedOverride?.patchPlanId ?? parsedBase?.patchPlanId)
        ? { patchPlanId: parsedOverride?.patchPlanId ?? parsedBase?.patchPlanId }
        : {}),
      ...((parsedOverride?.intent ?? parsedBase?.intent)
        ? { intent: parsedOverride?.intent ?? parsedBase?.intent }
        : {}),
      ...(cleanedConstraints ? { constraints: cleanedConstraints } : {}),
      astmendOperations: mergeAstmendOperations(
        parsedBase?.astmendOperations ?? [],
        parsedOverride?.astmendOperations ?? [],
      ),
    },
    astmendOperations,
  );
};

export const buildReviewResultContext = (
  requestContext?: ReviewRequestContext,
): ReviewResult["context"] => {
  if (!requestContext) {
    return undefined;
  }

  const operationIds = toUnique(
    (requestContext.astmendOperations ?? []).map((operation) => operation.operationId),
  );
  if (!requestContext.proposalId && !requestContext.patchPlanId && operationIds.length === 0) {
    return undefined;
  }

  return {
    ...(requestContext.proposalId ? { proposalId: requestContext.proposalId } : {}),
    ...(requestContext.patchPlanId ? { patchPlanId: requestContext.patchPlanId } : {}),
    ...(operationIds.length > 0 ? { operationIds } : {}),
  };
};

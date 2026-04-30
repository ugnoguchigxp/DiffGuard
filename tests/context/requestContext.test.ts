import { describe, expect, it } from "vitest";

import {
  buildReviewResultContext,
  mergeReviewRequestContext,
  mergeReviewRequestContexts,
  parseReviewRequestContext,
} from "../../src/context/requestContext";

describe("request context helpers", () => {
  it("defaults schema version while parsing sparse context", () => {
    expect(parseReviewRequestContext({ source: "manual" })).toEqual({
      schemaVersion: "1.0.0",
      source: "manual",
    });
  });

  it("returns undefined when no context or operations are supplied", () => {
    expect(mergeReviewRequestContext()).toBeUndefined();
    expect(mergeReviewRequestContexts()).toBeUndefined();
  });

  it("creates a context from standalone Astmend operations", () => {
    expect(
      mergeReviewRequestContext(undefined, [
        {
          operationId: "op-1",
          type: "rename_symbol",
          file: "src/domain/pricing.ts",
        },
      ]),
    ).toEqual({
      schemaVersion: "1.0.0",
      astmendOperations: [
        {
          operationId: "op-1",
          type: "rename_symbol",
          file: "src/domain/pricing.ts",
        },
      ],
    });
  });

  it("lets later Astmend operations replace the same operation id", () => {
    expect(
      mergeReviewRequestContext(
        {
          astmendOperations: [
            {
              operationId: "op-1",
              type: "extract_function",
              file: "src/domain/pricing.ts",
              symbol: "calculatePrice",
            },
          ],
        },
        [
          {
            operationId: "op-1",
            type: "rename_symbol",
            file: "src/domain/pricing.ts",
            symbol: "calculatePrice",
          },
        ],
      ),
    ).toMatchObject({
      astmendOperations: [
        {
          operationId: "op-1",
          type: "rename_symbol",
        },
      ],
    });
  });

  it("deep-merges constraints and Astmend operations", () => {
    const merged = mergeReviewRequestContexts(
      {
        source: "astmend",
        proposalId: "proposal-1",
        constraints: {
          doNotExtract: ["validatePrice"],
          allowedSharedTargets: ["src/shared/safe.ts"],
        },
        astmendOperations: [
          {
            operationId: "op-1",
            type: "extract_function",
            file: "src/features/pricing.ts",
          },
        ],
      },
      {
        patchPlanId: "plan-1",
        constraints: {
          doNotExtract: ["calculateDiscount"],
          forbiddenSharedTargets: ["src/shared/pricing.ts"],
        },
        astmendOperations: [
          {
            operationId: "op-2",
            type: "replace_node",
            file: "src/features/pricing.ts",
          },
        ],
      },
    );

    expect(merged).toMatchObject({
      schemaVersion: "1.0.0",
      source: "astmend",
      proposalId: "proposal-1",
      patchPlanId: "plan-1",
      constraints: {
        doNotExtract: ["validatePrice", "calculateDiscount"],
        allowedSharedTargets: ["src/shared/safe.ts"],
        forbiddenSharedTargets: ["src/shared/pricing.ts"],
      },
      astmendOperations: [{ operationId: "op-1" }, { operationId: "op-2" }],
    });
  });

  it("keeps override scalar fields and base-only constraints", () => {
    expect(
      mergeReviewRequestContexts(
        {
          source: "converge",
          proposalId: "proposal-1",
          intent: "refactor",
          constraints: {
            architecturalBoundaries: [
              {
                from: "src/routes/**",
                to: "src/db/**",
                allowed: false,
                reason: "routes must use services",
              },
            ],
          },
        },
        {
          source: "manual",
          patchPlanId: "plan-1",
        },
      ),
    ).toMatchObject({
      schemaVersion: "1.0.0",
      source: "manual",
      proposalId: "proposal-1",
      patchPlanId: "plan-1",
      intent: "refactor",
      constraints: {
        architecturalBoundaries: [
          {
            from: "src/routes/**",
            to: "src/db/**",
            allowed: false,
            reason: "routes must use services",
          },
        ],
      },
    });
  });

  it("drops empty merged constraints", () => {
    expect(
      mergeReviewRequestContexts(
        {
          constraints: {
            doNotExtract: [],
            allowedSharedTargets: [],
          },
        },
        {
          constraints: {
            forbiddenSharedTargets: [],
            architecturalBoundaries: [],
          },
        },
      ),
    ).toEqual({
      schemaVersion: "1.0.0",
    });
  });

  it("builds compact result context only when identifiers exist", () => {
    expect(buildReviewResultContext()).toBeUndefined();
    expect(buildReviewResultContext({ schemaVersion: "1.0.0", source: "manual" })).toBeUndefined();
    expect(
      buildReviewResultContext({
        schemaVersion: "1.0.0",
        proposalId: "proposal-1",
        patchPlanId: "plan-1",
        astmendOperations: [
          {
            operationId: "op-1",
            type: "replace_node",
            file: "src/domain/pricing.ts",
          },
          {
            operationId: "op-1",
            type: "replace_node",
            file: "src/domain/pricing.ts",
          },
        ],
      }),
    ).toEqual({
      proposalId: "proposal-1",
      patchPlanId: "plan-1",
      operationIds: ["op-1"],
    });
  });
});

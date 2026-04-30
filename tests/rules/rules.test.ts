import { describe, expect, it } from "vitest";

import { diRule } from "../../src/rules/diRule";
import { reactHookRule, tanstackQueryRule } from "../../src/rules/frameworkRules";
import { functionRule } from "../../src/rules/functionRule";
import { importRule } from "../../src/rules/importRule";
import { runRules } from "../../src/rules/index";
import { intentRule } from "../../src/rules/intentRule";
import { interfaceRule } from "../../src/rules/interfaceRule";

import type { ReviewContext } from "../../src/types";

const baseContext: ReviewContext = {
  analysis: { files: [], changeTypes: [] },
  semanticImpacts: [],
  functionChanged: false,
  interfaceChanged: false,
  importAdded: false,
  missingCallSites: false,
  unhandledUsage: false,
  notUsed: false,
  controllerHasNewRepository: false,
};

describe("rules", () => {
  it("functionRule emits missing-update when function call-site is missing", () => {
    const issues = functionRule.run({
      ...baseContext,
      functionChanged: true,
      missingCallSites: true,
      analysis: {
        files: [
          {
            filePath: "src/service.ts",
            addedLines: [
              "export function getUser(id: string, verbose: boolean): string { return id; }",
            ],
            removedLines: ["export function getUser(id: string): string { return id; }"],
            addedLineDetails: [
              {
                text: "export function getUser(id: string, verbose: boolean): string { return id; }",
                line: 1,
                hunk: "@@ -1,1 +1,1 @@",
                symbol: "getUser",
              },
            ],
            removedLineDetails: [],
            changeTypes: ["function-signature"],
            hasFunctionSignatureChange: true,
            hasInterfaceChange: false,
            hasImportChange: false,
            hasImportAdded: false,
            changedFunctionNames: ["getUser"],
            changedInterfaceNames: [],
            addedImportIdentifiers: [],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: ["function-signature"],
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe("missing-update");
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.ruleId).toBe("DG001");
    expect(issues[0]?.line).toBe(1);
    expect(issues[0]?.symbol).toBe("getUser");
  });

  it("interfaceRule emits interface-impact for unhandled usage", () => {
    const issues = interfaceRule.run({
      ...baseContext,
      interfaceChanged: true,
      unhandledUsage: true,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe("interface-impact");
    expect(issues[0]?.ruleId).toBe("DG002");
  });

  it("importRule emits unused-import when added import is not used", () => {
    const issues = importRule.run({
      ...baseContext,
      importAdded: true,
      notUsed: true,
      analysis: {
        files: [
          {
            filePath: "src/task.ts",
            addedLines: ['import { helper } from "./util";'],
            removedLines: [],
            addedLineDetails: [{ text: 'import { helper } from "./util";', line: 1 }],
            removedLineDetails: [],
            changeTypes: ["import-change"],
            hasFunctionSignatureChange: false,
            hasInterfaceChange: false,
            hasImportChange: true,
            hasImportAdded: true,
            changedFunctionNames: [],
            changedInterfaceNames: [],
            addedImportIdentifiers: ["helper"],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: ["import-change"],
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe("unused-import");
    expect(issues[0]?.ruleId).toBe("DG003");
  });

  it("runRules aggregates issues", () => {
    const issues = runRules({
      ...baseContext,
      functionChanged: true,
      missingCallSites: true,
      importAdded: true,
      notUsed: true,
    });

    expect(issues.map((issue) => issue.type)).toEqual(["missing-update", "unused-import"]);
  });

  it("diRule emits di-violation when controller creates repository directly", () => {
    const issues = diRule.run({
      ...baseContext,
      controllerHasNewRepository: true,
      analysis: {
        files: [
          {
            filePath: "src/userController.ts",
            addedLines: ["const repo = new UserRepository();"],
            removedLines: [],
            addedLineDetails: [
              {
                text: "const repo = new UserRepository();",
                line: 3,
                hunk: "@@ -1,1 +1,2 @@",
              },
            ],
            removedLineDetails: [],
            changeTypes: [],
            hasFunctionSignatureChange: false,
            hasInterfaceChange: false,
            hasImportChange: false,
            hasImportAdded: false,
            changedFunctionNames: [],
            changedInterfaceNames: [],
            addedImportIdentifiers: [],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: [],
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe("di-violation");
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.file).toBe("src/userController.ts");
    expect(issues[0]?.ruleId).toBe("DG004");
  });

  it("intentRule blocks doNotExtract logic moved into shared targets", () => {
    const issues = intentRule.run({
      ...baseContext,
      requestContext: {
        constraints: {
          doNotExtract: ["validatePrice"],
        },
      },
      analysis: {
        files: [
          {
            filePath: "src/shared/pricing.ts",
            addedLines: ["export const validatePrice = () => true;"],
            removedLines: [],
            addedLineDetails: [
              {
                text: "export const validatePrice = () => true;",
                line: 1,
                hunk: "@@ -0,0 +1,1 @@",
                symbol: "validatePrice",
              },
            ],
            removedLineDetails: [],
            changeTypes: [],
            hasFunctionSignatureChange: false,
            hasInterfaceChange: false,
            hasImportChange: false,
            hasImportAdded: false,
            changedFunctionNames: [],
            changedInterfaceNames: [],
            addedImportIdentifiers: [],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: [],
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.ruleId).toBe("DG_CONV_001");
    expect(issues[0]?.metadata?.blockingReason).toBe("do-not-extract-violation");
  });

  it("intentRule allows configured shared targets", () => {
    const issues = intentRule.run({
      ...baseContext,
      requestContext: {
        constraints: {
          doNotExtract: ["validatePrice"],
          allowedSharedTargets: ["src/shared/pricing.ts"],
        },
      },
      analysis: {
        files: [
          {
            filePath: "src/shared/pricing.ts",
            addedLines: ["export const validatePrice = () => true;"],
            removedLines: [],
            addedLineDetails: [{ text: "export const validatePrice = () => true;", line: 1 }],
            removedLineDetails: [],
            changeTypes: [],
            hasFunctionSignatureChange: false,
            hasInterfaceChange: false,
            hasImportChange: false,
            hasImportAdded: false,
            changedFunctionNames: [],
            changedInterfaceNames: [],
            addedImportIdentifiers: [],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: [],
      },
    });

    expect(issues).toHaveLength(0);
  });

  it("reactHookRule flags hook calls in conditionals", () => {
    const issues = reactHookRule.run({
      ...baseContext,
      analysis: {
        files: [
          {
            filePath: "src/Component.tsx",
            addedLines: ["if (enabled) useEffect(() => {}, []);"],
            removedLines: [],
            addedLineDetails: [{ text: "if (enabled) useEffect(() => {}, []);", line: 10 }],
            removedLineDetails: [],
            changeTypes: [],
            hasFunctionSignatureChange: false,
            hasInterfaceChange: false,
            hasImportChange: false,
            hasImportAdded: false,
            changedFunctionNames: [],
            changedInterfaceNames: [],
            addedImportIdentifiers: [],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: [],
      },
    });

    expect(issues[0]?.ruleId).toBe("DG_REACT_001");
  });

  it("reactHookRule flags hook calls inside conditional blocks", () => {
    const issues = reactHookRule.run({
      ...baseContext,
      analysis: {
        files: [
          {
            filePath: "src/Component.tsx",
            addedLines: ["if (enabled) {", "  useEffect(() => {}, []);", "}"],
            removedLines: [],
            addedLineDetails: [
              { text: "if (enabled) {", line: 10 },
              { text: "  useEffect(() => {}, []);", line: 11 },
              { text: "}", line: 12 },
            ],
            removedLineDetails: [],
            changeTypes: [],
            hasFunctionSignatureChange: false,
            hasInterfaceChange: false,
            hasImportChange: false,
            hasImportAdded: false,
            changedFunctionNames: [],
            changedInterfaceNames: [],
            addedImportIdentifiers: [],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: [],
      },
    });

    expect(issues[0]?.ruleId).toBe("DG_REACT_001");
    expect(issues[0]?.line).toBe(11);
  });

  it("reactHookRule does not keep single-line condition state open", () => {
    const issues = reactHookRule.run({
      ...baseContext,
      analysis: {
        files: [
          {
            filePath: "src/Component.tsx",
            addedLines: ["if (enabled) return null;", "useEffect(() => {}, []);"],
            removedLines: [],
            addedLineDetails: [
              { text: "if (enabled) return null;", line: 10 },
              { text: "useEffect(() => {}, []);", line: 11 },
            ],
            removedLineDetails: [],
            changeTypes: [],
            hasFunctionSignatureChange: false,
            hasInterfaceChange: false,
            hasImportChange: false,
            hasImportAdded: false,
            changedFunctionNames: [],
            changedInterfaceNames: [],
            addedImportIdentifiers: [],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: [],
      },
    });

    expect(issues).toHaveLength(0);
  });

  it("reactHookRule ignores non-React files", () => {
    const issues = reactHookRule.run({
      ...baseContext,
      analysis: {
        files: [
          {
            filePath: "src/util.ts",
            addedLines: ["if (enabled) useEffect(() => {}, []);"],
            removedLines: [],
            addedLineDetails: [{ text: "if (enabled) useEffect(() => {}, []);", line: 1 }],
            removedLineDetails: [],
            changeTypes: [],
            hasFunctionSignatureChange: false,
            hasInterfaceChange: false,
            hasImportChange: false,
            hasImportAdded: false,
            changedFunctionNames: [],
            changedInterfaceNames: [],
            addedImportIdentifiers: [],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: [],
      },
    });

    expect(issues).toHaveLength(0);
  });

  it("tanstackQueryRule flags queryFn identifiers missing from queryKey", () => {
    const issues = tanstackQueryRule.run({
      ...baseContext,
      analysis: {
        files: [
          {
            filePath: "src/query.ts",
            addedLines: ['useQuery({ queryKey: ["user"], queryFn: () => fetchUser(userId) });'],
            removedLines: [],
            addedLineDetails: [
              {
                text: 'useQuery({ queryKey: ["user"], queryFn: () => fetchUser(userId) });',
                line: 4,
              },
            ],
            removedLineDetails: [],
            changeTypes: [],
            hasFunctionSignatureChange: false,
            hasInterfaceChange: false,
            hasImportChange: false,
            hasImportAdded: false,
            changedFunctionNames: [],
            changedInterfaceNames: [],
            addedImportIdentifiers: [],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: [],
      },
    });

    expect(issues[0]?.ruleId).toBe("DG_QUERY_001");
    expect(issues[0]?.symbol).toBe("userId");
  });

  it("tanstackQueryRule allows queryFn identifiers included in queryKey", () => {
    const issues = tanstackQueryRule.run({
      ...baseContext,
      analysis: {
        files: [
          {
            filePath: "src/query.ts",
            addedLines: [
              'useQuery({ queryKey: ["user", userId], queryFn: () => fetchUser(userId) });',
            ],
            removedLines: [],
            addedLineDetails: [
              {
                text: 'useQuery({ queryKey: ["user", userId], queryFn: () => fetchUser(userId) });',
                line: 4,
              },
            ],
            removedLineDetails: [],
            changeTypes: [],
            hasFunctionSignatureChange: false,
            hasInterfaceChange: false,
            hasImportChange: false,
            hasImportAdded: false,
            changedFunctionNames: [],
            changedInterfaceNames: [],
            addedImportIdentifiers: [],
            touchedCallIdentifiers: [],
          },
        ],
        changeTypes: [],
      },
    });

    expect(issues).toHaveLength(0);
  });
});

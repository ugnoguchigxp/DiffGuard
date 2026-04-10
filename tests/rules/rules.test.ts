import { describe, expect, it } from "vitest";

import { diRule } from "../../src/rules/diRule";
import { functionRule } from "../../src/rules/functionRule";
import { importRule } from "../../src/rules/importRule";
import { runRules } from "../../src/rules/index";
import { interfaceRule } from "../../src/rules/interfaceRule";

import type { ReviewContext } from "../../src/types";

const baseContext: ReviewContext = {
  analysis: { files: [], changeTypes: [] },
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
});

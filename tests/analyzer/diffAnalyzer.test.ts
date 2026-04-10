import { describe, expect, it } from "vitest";

import { analyzeDiff } from "../../src/analyzer/diffAnalyzer";

describe("analyzeDiff", () => {
  it("detects function signature changes", () => {
    const diff = [
      "diff --git a/src/userService.ts b/src/userService.ts",
      "--- a/src/userService.ts",
      "+++ b/src/userService.ts",
      "@@ -1,3 +1,3 @@",
      "-export function getUser(id: string): string {",
      "+export function getUser(id: string, verbose: boolean): string {",
      " return id;",
      "}",
    ].join("\n");

    const result = analyzeDiff(diff);
    expect(result.changeTypes).toContain("function-signature");
    expect(result.files[0]?.changedFunctionNames).toContain("getUser");
    expect(result.files[0]?.addedLineDetails[0]?.line).toBe(1);
    expect(result.files[0]?.addedLineDetails[0]?.hunk).toBe("@@ -1,3 +1,3 @@");
    expect(result.files[0]?.addedLineDetails[0]?.symbol).toBe("getUser");
  });

  it("detects interface changes", () => {
    const diff = [
      "diff --git a/src/models.ts b/src/models.ts",
      "--- a/src/models.ts",
      "+++ b/src/models.ts",
      "@@ -1,3 +1,3 @@",
      "-export interface User { id: string }",
      "+export interface User { id: string; name: string }",
    ].join("\n");

    const result = analyzeDiff(diff);
    expect(result.changeTypes).toContain("interface-change");
    expect(result.files[0]?.changedInterfaceNames).toContain("User");
  });

  it("detects import changes and extracts imported identifiers", () => {
    const diff = [
      "diff --git a/src/task.ts b/src/task.ts",
      "--- a/src/task.ts",
      "+++ b/src/task.ts",
      "@@ -1,2 +1,3 @@",
      '+import defaultValue, { helper as renamedHelper } from "./util";',
      " export const value = 1;",
    ].join("\n");

    const result = analyzeDiff(diff);
    expect(result.changeTypes).toContain("import-change");
    expect(result.files[0]?.hasImportAdded).toBe(true);
    expect(result.files[0]?.addedImportIdentifiers).toEqual(
      expect.arrayContaining(["defaultValue", "renamedHelper"]),
    );
  });

  it("detects export default function signature changes", () => {
    const diff = [
      "diff --git a/src/handler.ts b/src/handler.ts",
      "--- a/src/handler.ts",
      "+++ b/src/handler.ts",
      "@@ -1,1 +1,1 @@",
      "-export default function handle(id: string): string { return id; }",
      "+export default function handle(id: string, force: boolean): string { return id; }",
    ].join("\n");

    const result = analyzeDiff(diff);
    expect(result.changeTypes).toContain("function-signature");
    expect(result.files[0]?.changedFunctionNames).toContain("handle");
  });

  it("detects class method signature changes without explicit return types", () => {
    const diff = [
      "diff --git a/src/userService.ts b/src/userService.ts",
      "--- a/src/userService.ts",
      "+++ b/src/userService.ts",
      "@@ -1,3 +1,3 @@",
      "-public getUser(id: string) { return id; }",
      "+public getUser(id: string, verbose: boolean) { return id; }",
    ].join("\n");

    const result = analyzeDiff(diff);
    expect(result.changeTypes).toContain("function-signature");
    expect(result.files[0]?.changedFunctionNames).toContain("getUser");
  });

  it("parses Astmend style Index diff headers", () => {
    const diff = [
      "Index: src/a.ts",
      "===================================================================",
      "--- src/a.ts",
      "+++ src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-export function a(id: string) { return id; }",
      "+export function a(id: string, enabled: boolean) { return id; }",
    ].join("\n");

    const result = analyzeDiff(diff);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.filePath).toBe("src/a.ts");
    expect(result.files[0]?.changedFunctionNames).toContain("a");
  });
});

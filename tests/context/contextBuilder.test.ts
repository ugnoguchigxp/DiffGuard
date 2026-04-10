import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeDiff } from "../../src/analyzer/diffAnalyzer";
import { buildContext } from "../../src/context/contextBuilder";

const createTempWorkspace = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "diffguard-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  return root;
};

describe("buildContext", () => {
  it("detects missing call-site updates for function signature changes", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/service.ts");
      const consumerPath = path.join(workspaceRoot, "src/consumer.ts");

      await writeFile(
        servicePath,
        "export function getUser(id: string, verbose: boolean): string { return id; }\n",
      );
      await writeFile(
        consumerPath,
        [
          'import { getUser } from "./service";',
          'export const useUser = (): string => getUser("1", true);',
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export function getUser(id: string): string { return id; }",
        "+export function getUser(id: string, verbose: boolean): string { return id; }",
      ].join("\n");

      const context = await buildContext(analyzeDiff(diff), {
        workspaceRoot,
        sourceFilePaths: [servicePath, consumerPath],
      });

      expect(context.functionChanged).toBe(true);
      expect(context.missingCallSites).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("detects unhandled usages for interface changes", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const modelPath = path.join(workspaceRoot, "src/models.ts");
      const consumerPath = path.join(workspaceRoot, "src/consumer.ts");

      await writeFile(modelPath, "export interface User { id: string; name: string; }\n");
      await writeFile(
        consumerPath,
        [
          'import type { User } from "./models";',
          "export const toName = (user: User): string => user.name;",
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/models.ts b/src/models.ts",
        "--- a/src/models.ts",
        "+++ b/src/models.ts",
        "@@ -1,1 +1,1 @@",
        "-export interface User { id: string; }",
        "+export interface User { id: string; name: string; }",
      ].join("\n");

      const context = await buildContext(analyzeDiff(diff), {
        workspaceRoot,
        sourceFilePaths: [modelPath, consumerPath],
      });

      expect(context.interfaceChanged).toBe(true);
      expect(context.unhandledUsage).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("detects unused imports from added import lines", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const taskPath = path.join(workspaceRoot, "src/task.ts");
      await writeFile(
        taskPath,
        ['import { unusedHelper } from "./util";', "export const value = 1;", ""].join("\n"),
      );

      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { unusedHelper } from "./util";',
        " export const value = 1;",
      ].join("\n");

      const context = await buildContext(analyzeDiff(diff), {
        workspaceRoot,
        sourceFilePaths: [taskPath],
      });

      expect(context.importAdded).toBe(true);
      expect(context.notUsed).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("uses src discovery when sourceFilePaths is omitted", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const modelPath = path.join(workspaceRoot, "src/models.ts");
      await writeFile(modelPath, "export interface User { id: string; }\n");

      const diff = [
        "diff --git a/src/models.ts b/src/models.ts",
        "--- a/src/models.ts",
        "+++ b/src/models.ts",
        "@@ -1,1 +1,1 @@",
        "-export interface User { id: string; }",
        "+export interface User { id: string; name: string; }",
      ].join("\n");

      const context = await buildContext(analyzeDiff(diff), {
        workspaceRoot,
      });

      expect(context.interfaceChanged).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("refreshes discovered src files between calls", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const modelPath = path.join(workspaceRoot, "src/models.ts");
      const consumerPath = path.join(workspaceRoot, "src/consumer.ts");
      await writeFile(modelPath, "export interface User { id: string; name: string; }\n");

      const diff = [
        "diff --git a/src/models.ts b/src/models.ts",
        "--- a/src/models.ts",
        "+++ b/src/models.ts",
        "@@ -1,1 +1,1 @@",
        "-export interface User { id: string; }",
        "+export interface User { id: string; name: string; }",
      ].join("\n");

      const first = await buildContext(analyzeDiff(diff), {
        workspaceRoot,
      });

      expect(first.unhandledUsage).toBe(false);

      await writeFile(
        consumerPath,
        [
          'import type { User } from "./models";',
          "export const getName = (user: User): string => user.name;",
          "",
        ].join("\n"),
      );

      const second = await buildContext(analyzeDiff(diff), {
        workspaceRoot,
      });

      expect(second.unhandledUsage).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not mark missing call sites when call updates are included in diff", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/service.ts");
      const consumerPath = path.join(workspaceRoot, "src/consumer.ts");

      await writeFile(
        servicePath,
        "export function getUser(id: string, verbose: boolean): string { return id; }\n",
      );
      await writeFile(
        consumerPath,
        [
          'import { getUser } from "./service";',
          'export const useUser = () => getUser("1", true);',
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export function getUser(id: string): string { return id; }",
        "+export function getUser(id: string, verbose: boolean): string { return id; }",
        "diff --git a/src/consumer.ts b/src/consumer.ts",
        "--- a/src/consumer.ts",
        "+++ b/src/consumer.ts",
        "@@ -1,2 +1,2 @@",
        '-export const useUser = () => getUser("1");',
        '+export const useUser = () => getUser("1", true);',
      ].join("\n");

      const context = await buildContext(analyzeDiff(diff), {
        workspaceRoot,
        sourceFilePaths: [servicePath, consumerPath],
      });

      expect(context.missingCallSites).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not mark notUsed when imported symbol is referenced", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const taskPath = path.join(workspaceRoot, "src/task.ts");
      await writeFile(
        taskPath,
        ['import { usedHelper } from "./util";', "export const value = usedHelper();", ""].join(
          "\n",
        ),
      );

      const diff = [
        "diff --git a/src/task.ts b/src/task.ts",
        "--- a/src/task.ts",
        "+++ b/src/task.ts",
        "@@ -1,1 +1,2 @@",
        '+import { usedHelper } from "./util";',
        " export const value = usedHelper();",
      ].join("\n");

      const context = await buildContext(analyzeDiff(diff), {
        workspaceRoot,
        sourceFilePaths: [taskPath],
      });

      expect(context.notUsed).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("detects DI violation hints in controller file changes", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const controllerPath = path.join(workspaceRoot, "src/userController.ts");
      await writeFile(
        controllerPath,
        [
          "export class UserController {",
          "  run() {",
          "    const repo = new UserRepository();",
          "    return repo.find();",
          "  }",
          "}",
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/userController.ts b/src/userController.ts",
        "--- a/src/userController.ts",
        "+++ b/src/userController.ts",
        "@@ -1,3 +1,4 @@",
        "+const repo = new UserRepository();",
      ].join("\n");

      const context = await buildContext(analyzeDiff(diff), {
        workspaceRoot,
        sourceFilePaths: [controllerPath],
      });

      expect(context.controllerHasNewRepository).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not flag DI violation for non-controller files", async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const servicePath = path.join(workspaceRoot, "src/userService.ts");
      await writeFile(
        servicePath,
        [
          "export class UserService {",
          "  run() {",
          "    const repo = new UserRepository();",
          "    return repo.find();",
          "  }",
          "}",
          "",
        ].join("\n"),
      );

      const diff = [
        "diff --git a/src/userService.ts b/src/userService.ts",
        "--- a/src/userService.ts",
        "+++ b/src/userService.ts",
        "@@ -1,3 +1,4 @@",
        "+const repo = new UserRepository();",
      ].join("\n");

      const context = await buildContext(analyzeDiff(diff), {
        workspaceRoot,
        sourceFilePaths: [servicePath],
      });

      expect(context.controllerHasNewRepository).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

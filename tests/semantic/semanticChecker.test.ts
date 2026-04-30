import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";

import { analyzeDiff } from "../../src/analyzer/diffAnalyzer";
import { detectSemanticImpacts } from "../../src/semantic/semanticChecker";

const createProject = async (
  files: Record<string, string>,
): Promise<{ project: Project; root: string; paths: string[] }> => {
  const root = await mkdtemp(path.join(tmpdir(), "diffguard-semantic-"));
  const paths: string[] = [];

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    paths.push(absolutePath);
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  for (const filePath of paths) {
    project.addSourceFileAtPath(filePath);
  }

  return { project, root, paths };
};

describe("detectSemanticImpacts", () => {
  it("does not run unless semantic checking is enabled", async () => {
    const { project, root } = await createProject({
      "src/service.ts": "export function getUser(id: string, verbose: boolean) { return id; }\n",
      "src/consumer.ts": 'import { getUser } from "./service"; getUser("1", true);\n',
    });

    try {
      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export function getUser(id: string) { return id; }",
        "+export function getUser(id: string, verbose: boolean) { return id; }",
      ].join("\n");

      const impacts = detectSemanticImpacts(analyzeDiff(diff), project.getSourceFiles(), root);

      expect(impacts).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects exported signature changes with external references", async () => {
    const { project, root } = await createProject({
      "src/service.ts": "export function getUser(id: string, verbose: boolean) { return id; }\n",
      "src/consumer.ts": 'import { getUser } from "./service"; getUser("1", true);\n',
    });

    try {
      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +1,1 @@",
        "-export function getUser(id: string) { return id; }",
        "+export function getUser(id: string, verbose: boolean) { return id; }",
      ].join("\n");

      const impacts = detectSemanticImpacts(analyzeDiff(diff), project.getSourceFiles(), root, {
        enabled: true,
      });

      expect(impacts[0]?.type).toBe("export-signature-change");
      expect(impacts[0]?.symbol).toBe("getUser");
      expect(impacts[0]?.referenceCount).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects removed exports and respects maxFiles guard", async () => {
    const { project, root } = await createProject({
      "src/service.ts": "export function getUser(id: string) { return id; }\n",
      "src/consumer.ts": 'import { getUser } from "./service"; getUser("1");\n',
    });

    try {
      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -1,1 +0,0 @@",
        "-export function getUser(id: string) { return id; }",
      ].join("\n");

      expect(
        detectSemanticImpacts(analyzeDiff(diff), project.getSourceFiles(), root, {
          enabled: true,
          maxFiles: 1,
        }),
      ).toEqual([]);

      const impacts = detectSemanticImpacts(analyzeDiff(diff), project.getSourceFiles(), root, {
        enabled: true,
      });

      expect(impacts[0]?.type).toBe("export-removed");
      expect(impacts[0]?.symbol).toBe("getUser");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

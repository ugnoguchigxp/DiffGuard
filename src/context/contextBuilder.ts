import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { Project, type SourceFile, SyntaxKind } from "ts-morph";

import type { DiffAnalysis, ReviewContext } from "../types";

const normalizePath = (value: string): string => {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
};

const resolveAbsolutePath = (workspaceRoot: string, value: string): string => {
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
};

const collectTypeScriptFiles = async (directoryPath: string): Promise<string[]> => {
  if (!existsSync(directoryPath)) {
    return [];
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }

  return files;
};

const countIdentifierInSourceFile = (sourceFile: SourceFile, identifier: string): number => {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((node) => node.getText() === identifier).length;
};

const toUnique = (values: string[]): string[] => {
  return Array.from(new Set(values));
};

const CONTROLLER_PATH_PATTERN = /(^|\/)[A-Za-z0-9_-]*controller[A-Za-z0-9_-]*\.(ts|tsx)$/i;
const NEW_REPOSITORY_PATTERN = /\bnew\s+[A-Za-z_$][\w$]*Repository\b/;

interface BuildContextOptions {
  workspaceRoot?: string;
  sourceFilePaths?: string[];
}

export const buildContext = async (
  analysis: DiffAnalysis,
  options: BuildContextOptions = {},
): Promise<ReviewContext> => {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const explicitSourceFilePaths = options.sourceFilePaths;
  const hasExplicitSourceFilePaths = explicitSourceFilePaths !== undefined;
  const sourceFilePaths = hasExplicitSourceFilePaths
    ? explicitSourceFilePaths.map((filePath) => resolveAbsolutePath(workspaceRoot, filePath))
    : await collectTypeScriptFiles(path.join(workspaceRoot, "src"));

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  for (const sourceFilePath of sourceFilePaths) {
    project.addSourceFileAtPathIfExists(sourceFilePath);
  }

  const sourceFiles = project.getSourceFiles();
  const touchedFiles = new Set(analysis.files.map((file) => normalizePath(file.filePath)));

  const changedFunctionNames = toUnique(
    analysis.files.flatMap((file) => file.changedFunctionNames),
  );
  const changedInterfaceNames = toUnique(
    analysis.files.flatMap((file) => file.changedInterfaceNames),
  );

  const functionChanged = analysis.changeTypes.includes("function-signature");
  const interfaceChanged = analysis.changeTypes.includes("interface-change");
  const importAdded = analysis.files.some((file) => file.hasImportAdded);

  let missingCallSites = false;
  for (const functionName of changedFunctionNames) {
    const identifierCount = sourceFiles.reduce((count, sourceFile) => {
      return count + countIdentifierInSourceFile(sourceFile, functionName);
    }, 0);

    const callTouched = analysis.files.some((file) =>
      file.touchedCallIdentifiers.includes(functionName),
    );

    if (identifierCount > 1 && !callTouched) {
      missingCallSites = true;
      break;
    }
  }

  let unhandledUsage = false;
  for (const interfaceName of changedInterfaceNames) {
    for (const sourceFile of sourceFiles) {
      const relativePath = normalizePath(path.relative(workspaceRoot, sourceFile.getFilePath()));
      if (touchedFiles.has(relativePath)) {
        continue;
      }

      if (countIdentifierInSourceFile(sourceFile, interfaceName) > 0) {
        unhandledUsage = true;
        break;
      }
    }

    if (unhandledUsage) {
      break;
    }
  }

  let notUsed = false;
  for (const file of analysis.files) {
    if (file.addedImportIdentifiers.length === 0) {
      continue;
    }

    const targetSourceFile = sourceFiles.find((sourceFile) => {
      const relativePath = normalizePath(path.relative(workspaceRoot, sourceFile.getFilePath()));
      return relativePath === normalizePath(file.filePath);
    });

    if (!targetSourceFile) {
      continue;
    }

    for (const identifier of file.addedImportIdentifiers) {
      if (countIdentifierInSourceFile(targetSourceFile, identifier) <= 1) {
        notUsed = true;
        break;
      }
    }

    if (notUsed) {
      break;
    }
  }

  const controllerHasNewRepository = analysis.files.some((file) => {
    if (!CONTROLLER_PATH_PATTERN.test(normalizePath(file.filePath))) {
      return false;
    }

    return file.addedLines.some((line) => NEW_REPOSITORY_PATTERN.test(line));
  });

  return {
    analysis,
    functionChanged,
    interfaceChanged,
    importAdded,
    missingCallSites,
    unhandledUsage,
    notUsed,
    controllerHasNewRepository,
  };
};

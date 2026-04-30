import path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";

import type { DiffAnalysis, DiffLineDetail, SemanticImpact } from "../types";

export interface SemanticCheckerOptions {
  enabled?: boolean | undefined;
  maxFiles?: number | undefined;
  timeoutMs?: number | undefined;
}

const EXPORTED_DECLARATION_PATTERN =
  /^export\s+(?:default\s+)?(?:(?:async\s+)?function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)\b/;

const normalizePath = (value: string): string => {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
};

const normalizeDeclaration = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const extractExportedSymbol = (line: string): string | undefined => {
  const match = line.match(EXPORTED_DECLARATION_PATTERN);
  return match?.[1];
};

const countIdentifierReferences = (
  sourceFiles: SourceFile[],
  workspaceRoot: string,
  touchedFilePath: string,
  symbol: string,
): number => {
  const normalizedTouchedPath = normalizePath(touchedFilePath);

  return sourceFiles.reduce((count, sourceFile) => {
    const relativePath = normalizePath(path.relative(workspaceRoot, sourceFile.getFilePath()));
    if (relativePath === normalizedTouchedPath) {
      return count;
    }

    return (
      count +
      sourceFile
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .filter((node) => node.getText() === symbol).length
    );
  }, 0);
};

const findAddedDeclaration = (
  addedLineDetails: DiffLineDetail[],
  symbol: string,
): DiffLineDetail | undefined => {
  return addedLineDetails.find((detail) => extractExportedSymbol(detail.text) === symbol);
};

export const detectSemanticImpacts = (
  analysis: DiffAnalysis,
  sourceFiles: SourceFile[],
  workspaceRoot: string,
  options: SemanticCheckerOptions = {},
): SemanticImpact[] => {
  if (!options.enabled) {
    return [];
  }

  const maxFiles = options.maxFiles ?? 200;
  if (sourceFiles.length > maxFiles) {
    return [];
  }

  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 3000;
  const impacts: SemanticImpact[] = [];

  for (const file of analysis.files) {
    for (const removed of file.removedLineDetails) {
      if (Date.now() - startedAt > timeoutMs) {
        return impacts;
      }

      const symbol = extractExportedSymbol(removed.text);
      if (!symbol) {
        continue;
      }

      const referenceCount = countIdentifierReferences(
        sourceFiles,
        workspaceRoot,
        file.filePath,
        symbol,
      );
      if (referenceCount === 0) {
        continue;
      }

      const added = findAddedDeclaration(file.addedLineDetails, symbol);
      if (!added) {
        impacts.push({
          type: "export-removed",
          file: file.filePath,
          symbol,
          message: `Exported symbol ${symbol} was removed while external references remain.`,
          ...(removed.line ? { line: removed.line } : {}),
          ...(removed.hunk ? { hunk: removed.hunk } : {}),
          referenceCount,
        });
        continue;
      }

      if (normalizeDeclaration(removed.text) !== normalizeDeclaration(added.text)) {
        impacts.push({
          type: "export-signature-change",
          file: file.filePath,
          symbol,
          message: `Exported symbol ${symbol} changed while external references remain.`,
          ...(added.line ? { line: added.line } : {}),
          ...(added.hunk ? { hunk: added.hunk } : {}),
          referenceCount,
        });
      }
    }
  }

  return impacts;
};

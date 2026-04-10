import {
  DIFF_GIT_HEADER_PREFIX,
  DIFF_INDEX_HEADER_PREFIX,
  DIFF_NEW_FILE_PREFIX,
  DIFF_OLD_FILE_PREFIX,
  DIFF_SEPARATOR_PREFIX,
  FUNCTION_SIGNATURE_CHANGE,
  IMPORT_CHANGE,
  INTERFACE_CHANGE,
} from "../constants/analysis";
import type { ChangeType, DiffAnalysis, DiffLineDetail, FileDiffAnalysis } from "../types";

const FUNCTION_DECLARATION_PATTERNS = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]+>)?\s*\(/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:<[^>]+>\s*)?\([^)]*\)\s*=>/,
  /^(?!(?:if|for|while|switch|catch|function|return)\b)(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:override\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?::\s*[^=]+)?\s*\{/,
] as const;

const INTERFACE_DECLARATION_PATTERN = /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/;
const IMPORT_LINE_PATTERN = /^import\s+.+\s+from\s+["'].+["'];?$/;
const CALL_IDENTIFIER_PATTERN = /\b([A-Za-z_$][\w$]*)\s*\(/g;
const HUNK_HEADER_PATTERN = /^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/;

const CONTROL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "typeof",
]);

const normalizeDiffPath = (raw: string): string => {
  const trimmed = raw.trim().replace(/^"|"$/g, "");
  if (trimmed === "/dev/null") {
    return "";
  }

  const withoutPrefix =
    trimmed.startsWith("a/") || trimmed.startsWith("b/") ? trimmed.slice(2) : trimmed;
  return withoutPrefix.replace(/\\/g, "/");
};

const extractDiffFilePath = (value: string): string => {
  const withoutTimestamp = value.split("\t")[0] ?? value;
  return normalizeDiffPath(withoutTimestamp);
};

const toUnique = <T extends string>(values: T[]): T[] => {
  return Array.from(new Set(values));
};

const extractFunctionName = (line: string): string | null => {
  for (const pattern of FUNCTION_DECLARATION_PATTERNS) {
    const match = line.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
};

const extractInterfaceName = (line: string): string | null => {
  const match = line.match(INTERFACE_DECLARATION_PATTERN);
  return match?.[1] ?? null;
};

const extractImportIdentifiers = (line: string): string[] => {
  if (!IMPORT_LINE_PATTERN.test(line)) {
    return [];
  }

  const identifiers: string[] = [];
  const namedMatch = line.match(/import(?:.+?,)?\s*\{([^}]+)\}/);
  if (namedMatch?.[1]) {
    const namedParts = namedMatch[1].split(",").map((part) => part.trim());
    for (const part of namedParts) {
      const aliasMatch = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (aliasMatch?.[2]) {
        identifiers.push(aliasMatch[2]);
      } else if (aliasMatch?.[1]) {
        identifiers.push(aliasMatch[1]);
      }
    }
  }

  const defaultMatch = line.match(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/);
  if (defaultMatch?.[1]) {
    identifiers.push(defaultMatch[1]);
  }

  const namespaceMatch = line.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch?.[1]) {
    identifiers.push(namespaceMatch[1]);
  }

  return toUnique(identifiers);
};

const extractCallIdentifiers = (line: string): string[] => {
  const declarationName = extractFunctionName(line);
  if (extractInterfaceName(line) || IMPORT_LINE_PATTERN.test(line)) {
    return [];
  }

  const values: string[] = [];
  const matches = line.matchAll(CALL_IDENTIFIER_PATTERN);

  for (const match of matches) {
    const candidate = match[1];
    if (!candidate || CONTROL_KEYWORDS.has(candidate)) {
      continue;
    }

    if (declarationName && candidate === declarationName) {
      continue;
    }

    values.push(candidate);
  }

  return toUnique(values);
};

const createEmptyFileDiff = (filePath: string): FileDiffAnalysis => {
  return {
    filePath,
    addedLines: [],
    removedLines: [],
    addedLineDetails: [],
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
  };
};

const finalizeFileDiff = (fileDiff: FileDiffAnalysis): FileDiffAnalysis => {
  return {
    ...fileDiff,
    changeTypes: toUnique(fileDiff.changeTypes),
    changedFunctionNames: toUnique(fileDiff.changedFunctionNames),
    changedInterfaceNames: toUnique(fileDiff.changedInterfaceNames),
    addedImportIdentifiers: toUnique(fileDiff.addedImportIdentifiers),
    touchedCallIdentifiers: toUnique(fileDiff.touchedCallIdentifiers),
  };
};

const markChangeType = (fileDiff: FileDiffAnalysis, changeType: ChangeType): void => {
  fileDiff.changeTypes.push(changeType);
  if (changeType === FUNCTION_SIGNATURE_CHANGE) {
    fileDiff.hasFunctionSignatureChange = true;
  }
  if (changeType === INTERFACE_CHANGE) {
    fileDiff.hasInterfaceChange = true;
  }
  if (changeType === IMPORT_CHANGE) {
    fileDiff.hasImportChange = true;
  }
};

const parseHunkHeader = (
  line: string,
): {
  oldLineStart: number;
  newLineStart: number;
} | null => {
  const match = line.match(HUNK_HEADER_PATTERN);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return {
    oldLineStart: Number(match[1]),
    newLineStart: Number(match[2]),
  };
};

const toLineDetail = (
  text: string,
  line: number | undefined,
  hunk: string,
  symbol?: string,
): DiffLineDetail => {
  return {
    text,
    ...(typeof line === "number" ? { line } : {}),
    ...(hunk.length > 0 ? { hunk } : {}),
    ...(symbol ? { symbol } : {}),
  };
};

export const analyzeDiff = (diff: string): DiffAnalysis => {
  const lines = diff.split(/\r?\n/);
  const files: FileDiffAnalysis[] = [];

  let currentFile: FileDiffAnalysis | null = null;
  let currentHunk = "";
  let oldLineNumber: number | undefined;
  let newLineNumber: number | undefined;

  const startFile = (filePath: string): void => {
    if (currentFile) {
      files.push(finalizeFileDiff(currentFile));
    }

    currentFile = createEmptyFileDiff(filePath);
    currentHunk = "";
    oldLineNumber = undefined;
    newLineNumber = undefined;
  };

  for (const rawLine of lines) {
    if (rawLine.startsWith(DIFF_GIT_HEADER_PREFIX)) {
      const match = rawLine.match(/^diff --git a\/(.+) b\/(.+)$/);
      const filePath = match?.[2] ? normalizeDiffPath(match[2]) : "";
      startFile(filePath);
      continue;
    }

    if (rawLine.startsWith(DIFF_INDEX_HEADER_PREFIX)) {
      const indexPath = normalizeDiffPath(rawLine.slice(DIFF_INDEX_HEADER_PREFIX.length));
      startFile(indexPath);
      continue;
    }

    if (rawLine.startsWith(DIFF_SEPARATOR_PREFIX)) {
      continue;
    }

    if (!currentFile) {
      continue;
    }
    const activeFile = currentFile as FileDiffAnalysis;

    if (rawLine.startsWith(DIFF_OLD_FILE_PREFIX)) {
      continue;
    }

    if (rawLine.startsWith(DIFF_NEW_FILE_PREFIX)) {
      const newPath = extractDiffFilePath(rawLine.slice(DIFF_NEW_FILE_PREFIX.length));
      if (newPath) {
        activeFile.filePath = newPath;
      }
      continue;
    }

    if (rawLine.startsWith("@@")) {
      currentHunk = rawLine;
      const hunk = parseHunkHeader(rawLine);
      oldLineNumber = hunk?.oldLineStart;
      newLineNumber = hunk?.newLineStart;
      continue;
    }

    if (rawLine.startsWith("\\ No newline at end of file")) {
      continue;
    }

    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      const line = rawLine.slice(1).trim();
      const functionName = extractFunctionName(line);
      const interfaceName = extractInterfaceName(line);
      const symbol = functionName ?? interfaceName ?? undefined;
      const lineNumber = newLineNumber;

      activeFile.addedLines.push(line);
      activeFile.addedLineDetails.push(toLineDetail(line, lineNumber, currentHunk, symbol));

      if (typeof newLineNumber === "number") {
        newLineNumber += 1;
      }

      if (functionName) {
        markChangeType(activeFile, FUNCTION_SIGNATURE_CHANGE);
        activeFile.changedFunctionNames.push(functionName);
      }

      if (interfaceName) {
        markChangeType(activeFile, INTERFACE_CHANGE);
        activeFile.changedInterfaceNames.push(interfaceName);
      }

      if (IMPORT_LINE_PATTERN.test(line)) {
        markChangeType(activeFile, IMPORT_CHANGE);
        activeFile.hasImportAdded = true;
        activeFile.addedImportIdentifiers.push(...extractImportIdentifiers(line));
      }

      activeFile.touchedCallIdentifiers.push(...extractCallIdentifiers(line));
      continue;
    }

    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      const line = rawLine.slice(1).trim();
      const functionName = extractFunctionName(line);
      const interfaceName = extractInterfaceName(line);
      const symbol = functionName ?? interfaceName ?? undefined;
      const lineNumber = oldLineNumber;

      activeFile.removedLines.push(line);
      activeFile.removedLineDetails.push(toLineDetail(line, lineNumber, currentHunk, symbol));

      if (typeof oldLineNumber === "number") {
        oldLineNumber += 1;
      }

      if (functionName) {
        markChangeType(activeFile, FUNCTION_SIGNATURE_CHANGE);
        activeFile.changedFunctionNames.push(functionName);
      }

      if (interfaceName) {
        markChangeType(activeFile, INTERFACE_CHANGE);
        activeFile.changedInterfaceNames.push(interfaceName);
      }

      if (IMPORT_LINE_PATTERN.test(line)) {
        markChangeType(activeFile, IMPORT_CHANGE);
      }

      activeFile.touchedCallIdentifiers.push(...extractCallIdentifiers(line));
      continue;
    }

    if (rawLine.startsWith(" ")) {
      if (typeof oldLineNumber === "number") {
        oldLineNumber += 1;
      }

      if (typeof newLineNumber === "number") {
        newLineNumber += 1;
      }
    }
  }

  if (currentFile) {
    files.push(finalizeFileDiff(currentFile));
  }

  const changeTypes = toUnique(files.flatMap((file) => file.changeTypes));
  return { files, changeTypes };
};

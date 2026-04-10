import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { diffGuardConfigSchema } from "../schema/review.schema";
import type { DiffGuardConfig } from "../types";

const DEFAULT_CONFIG_CANDIDATES = [
  "diffguard.config.json",
  "diffguard.config.jsonc",
  "diffguard.config.js",
  "diffguard.config.mjs",
  "diffguard.config.cjs",
] as const;

const stripJsonComments = (input: string): string => {
  return input.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
};

const tryReadText = async (filePath: string): Promise<string | null> => {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
};

const loadFromScript = async (filePath: string): Promise<unknown> => {
  const module = await import(pathToFileURL(filePath).href);
  if (module.default) {
    return module.default;
  }

  if (module.diffGuardConfig) {
    return module.diffGuardConfig;
  }

  return module;
};

const loadRawConfig = async (filePath: string): Promise<unknown> => {
  if (filePath.endsWith(".json") || filePath.endsWith(".jsonc")) {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(stripJsonComments(text));
  }

  return loadFromScript(filePath);
};

export interface LoadDiffGuardConfigResult {
  config: DiffGuardConfig;
  filePath?: string;
}

export const loadDiffGuardConfig = async (
  workspaceRoot: string,
  explicitConfigPath?: string,
): Promise<LoadDiffGuardConfigResult> => {
  if (explicitConfigPath) {
    const absolutePath = path.isAbsolute(explicitConfigPath)
      ? explicitConfigPath
      : path.resolve(workspaceRoot, explicitConfigPath);
    const parsed = diffGuardConfigSchema.parse(await loadRawConfig(absolutePath));
    return {
      config: parsed,
      filePath: absolutePath,
    };
  }

  for (const candidate of DEFAULT_CONFIG_CANDIDATES) {
    const absolutePath = path.resolve(workspaceRoot, candidate);
    const text = await tryReadText(absolutePath);
    if (text === null) {
      continue;
    }

    const parsed = diffGuardConfigSchema.parse(await loadRawConfig(absolutePath));
    return {
      config: parsed,
      filePath: absolutePath,
    };
  }

  return {
    config: {},
  };
};

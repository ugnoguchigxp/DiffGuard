import { readFile } from "node:fs/promises";
import path from "node:path";

const unquote = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
};

export const parseDotEnv = (text: string): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key.length === 0) {
      continue;
    }

    result[key] = unquote(value);
  }

  return result;
};

export const loadDotEnvFile = async (
  workspaceRoot: string,
  fileName = ".env",
): Promise<Record<string, string>> => {
  const envPath = path.resolve(workspaceRoot, fileName);

  try {
    const text = await readFile(envPath, "utf8");
    const parsed = parseDotEnv(text);

    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    return parsed;
  } catch {
    return {};
  }
};

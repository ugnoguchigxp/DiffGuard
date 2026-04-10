import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Rule } from "../types";

const toRuleArray = (value: unknown): Rule[] => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is Rule => {
      return (
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "run" in item &&
        typeof (item as Rule).id === "string" &&
        (item as Rule).id.trim().length > 0 &&
        typeof (item as Rule).run === "function"
      );
    });
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "run" in value &&
    typeof (value as Rule).id === "string" &&
    (value as Rule).id.trim().length > 0 &&
    typeof (value as Rule).run === "function"
  ) {
    return [value as Rule];
  }

  return [];
};

export const loadPluginRules = async (
  pluginPaths: string[],
  workspaceRoot: string,
): Promise<Rule[]> => {
  const loaded: Rule[] = [];

  for (const pluginPath of pluginPaths) {
    const absolutePath = path.isAbsolute(pluginPath)
      ? pluginPath
      : path.resolve(workspaceRoot, pluginPath);
    const module = await import(pathToFileURL(absolutePath).href);

    loaded.push(...toRuleArray(module.default));
    loaded.push(...toRuleArray(module.rules));
    loaded.push(...toRuleArray(module.rule));
  }

  return loaded;
};

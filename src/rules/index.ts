import type { Issue, ReviewContext, Rule } from "../types";
import { diRule } from "./diRule";
import { functionRule } from "./functionRule";
import { importRule } from "./importRule";
import { interfaceRule } from "./interfaceRule";

export const DEFAULT_RULES: Rule[] = [functionRule, interfaceRule, importRule, diRule];

export const runRules = (ctx: ReviewContext, rules: Rule[] = DEFAULT_RULES): Issue[] => {
  return rules.flatMap((rule) => rule.run(ctx));
};

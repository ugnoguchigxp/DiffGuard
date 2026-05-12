import { readFileSync } from "node:fs";
import path from "node:path";

import { toChatCompletionsUrl } from "./localOpenAiClient";
import type { LocalOpenAiClientOptions } from "./localOpenAiClient";
import type { SuggestedFix } from "../types";

export interface PatchGeneratorFinding {
  id: string;
  ruleId: string;
  message: string;
  file?: string | undefined;
  line?: number | undefined;
  symbol?: string | undefined;
}

export interface PatchGeneratorInput {
  diff: string;
  finding: PatchGeneratorFinding;
  workspaceRoot: string;
}

export interface PatchGeneratorOptions extends LocalOpenAiClientOptions {
  contextLines?: number;
}

const buildPatchPrompt = (input: PatchGeneratorInput, targetFileContent: string): string => {
  return [
    "You are an expert software engineer specialized in code refactoring and migration.",
    "",
    "A change in a 'source file' has caused an issue in a 'target file'.",
    "Your task is to fix the issue in the 'target file' by generating a unified diff.",
    "",
    "[SOURCE_DIFF]",
    input.diff,
    "",
    "[ISSUE_IN_TARGET_FILE]",
    `File: ${input.finding.file}`,
    `Line: ${input.finding.line}`,
    input.finding.symbol ? `Symbol: ${input.finding.symbol}` : "",
    `Message: ${input.finding.message}`,
    "",
    "[TARGET_FILE_CONTENT_AROUND_ISSUE]",
    targetFileContent,
    "",
    "[INSTRUCTION]",
    "- Generate ONLY a valid unified diff (starting with --- and +++).",
    "- Do not include any explanation or markdown formatting (like ```diff).",
    "- Ensure the diff accurately fixes the reported issue based on the source diff.",
    "- If you cannot determine the fix, return an empty string.",
    "",
    "RESPONSE:",
  ].join("\n");
};

export const generateFixWithLocalOpenAi = async (
  input: PatchGeneratorInput,
  options: PatchGeneratorOptions,
): Promise<SuggestedFix | undefined> => {
  if (!input.finding.file) {
    return undefined;
  }

  const absolutePath = path.isAbsolute(input.finding.file)
    ? input.finding.file
    : path.resolve(input.workspaceRoot, input.finding.file);

  let fileContent = "";
  try {
    fileContent = readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }

  // Extract surrounding lines
  const contextLines = options.contextLines ?? 20;
  const lines = fileContent.split("\n");
  const targetLine = (input.finding.line ?? 1) - 1;
  const startLine = Math.max(0, targetLine - contextLines);
  const endLine = Math.min(lines.length, targetLine + contextLines);
  const snippet = lines.slice(startLine, endLine).join("\n");

  const prompt = buildPatchPrompt(input, snippet);

  const fetchImpl = options.fetchImpl ?? fetch;
  const url = toChatCompletionsUrl(options.baseUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        stream: false,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        messages: [
          {
            role: "system",
            content: "You are an expert software engineer. You only output unified diffs.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const patch = payload.choices?.[0]?.message?.content?.trim();

    if (!patch || !patch.startsWith("---")) {
      // Try to extract if it's wrapped in code blocks
      const match = patch?.match(/```(?:diff)?\n([\s\S]*?)```/);
      if (match && match[1]?.startsWith("---")) {
        return {
          description: `AI-generated fix for ${input.finding.ruleId}`,
          patch: match[1].trim(),
        };
      }
      return undefined;
    }

    return {
      description: `AI-generated fix for ${input.finding.ruleId}`,
      patch,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

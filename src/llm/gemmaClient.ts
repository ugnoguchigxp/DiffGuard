import { spawn } from "node:child_process";

import {
  DEFAULT_GEMMA_COMMAND,
  DEFAULT_GEMMA_TIMEOUT_MS,
  LLM_EMPTY_SUMMARY,
  LLM_FALLBACK_SUMMARY,
  MAX_GEMMA_CONCERNS,
} from "../constants/llm";
import type { LlmReview } from "../types";

export interface GemmaReviewInput {
  diff: string;
  relatedCode: string;
}

export type GemmaRunner = (prompt: string, timeoutMs: number, command: string) => Promise<string>;

export interface GemmaClientOptions {
  command?: string;
  timeoutMs?: number;
  sessionDir?: string;
  noSession?: boolean;
  runner?: GemmaRunner;
}

interface CommandSessionOptions {
  sessionDir: string | undefined;
  noSession: boolean;
}

interface LocalLlmJsonResponse {
  session_id?: string;
  response?: string;
}

const commandSessionMap = new Map<string, string>();

const runCommand = (
  command: string,
  args: string[],
  timeoutMs: number,
  input?: string,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finishResolve = (value: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    const finishReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finishReject(new Error(`Gemma command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finishReject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        finishResolve(stdout.trim());
        return;
      }

      finishReject(new Error(`Gemma command failed (code=${code}): ${stderr.trim()}`));
    });

    child.stdin.on("error", (error) => {
      if ("code" in error && error.code === "EPIPE") {
        return;
      }
      finishReject(error);
    });

    if (typeof input === "string") {
      child.stdin.end(input);
      return;
    }

    child.stdin.end();
  });
};

const parseJsonLine = (stdout: string): LocalLlmJsonResponse | undefined => {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as LocalLlmJsonResponse;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // ignore non-JSON lines
    }
  }

  return undefined;
};

const runGemmaCommandWithSession = async (
  prompt: string,
  timeoutMs: number,
  command: string,
  options: CommandSessionOptions,
): Promise<string> => {
  const commandKey = `${command}::${options.sessionDir ?? ""}`;
  const previousSessionId = options.noSession ? undefined : commandSessionMap.get(commandKey);
  const args: string[] = [];
  if (!options.noSession && previousSessionId) {
    args.push("--session-id", previousSessionId);
  } else if (options.noSession) {
    args.push("--no-session");
  }

  if (options.sessionDir) {
    args.push("--session-dir", options.sessionDir);
  }

  args.push("--output", "json", "--prompt", prompt);
  try {
    const stdout = await runCommand(command, args, timeoutMs);
    const parsed = parseJsonLine(stdout);
    if (parsed?.session_id && !options.noSession) {
      commandSessionMap.set(commandKey, parsed.session_id);
    }
    if (typeof parsed?.response === "string" && parsed.response.trim().length > 0) {
      return parsed.response.trim();
    }
  } catch {
    // Fallback to legacy stdin mode below.
  }

  // Backward compatibility for non-localLlm commands.
  return runCommand(command, [], timeoutMs, prompt);
};

export const buildGemmaPrompt = (input: GemmaReviewInput): string => {
  return [
    "You are a strict code reviewer.",
    "",
    "Given:",
    "- diff",
    "- related code",
    "",
    "Check:",
    "- missing updates",
    "- unsafe changes",
    "- logical inconsistencies",
    "",
    "Be concise.",
    "No hallucination.",
    "",
    "[DIFF]",
    input.diff,
    "",
    "[RELATED_CODE]",
    input.relatedCode,
  ].join("\n");
};

export const parseGemmaOutput = (output: string): LlmReview => {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      summary: LLM_EMPTY_SUMMARY,
      concerns: [],
    };
  }

  const [summary, ...rest] = lines;
  if (!summary) {
    return {
      summary: LLM_EMPTY_SUMMARY,
      concerns: [],
    };
  }

  return {
    summary,
    concerns: rest.slice(0, MAX_GEMMA_CONCERNS),
  };
};

export const reviewWithGemma = async (
  input: GemmaReviewInput,
  options: GemmaClientOptions = {},
): Promise<LlmReview> => {
  const command = options.command ?? DEFAULT_GEMMA_COMMAND;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GEMMA_TIMEOUT_MS;
  const runner =
    options.runner ??
    ((prompt: string, timeout: number, cmd: string) =>
      runGemmaCommandWithSession(prompt, timeout, cmd, {
        sessionDir: options.sessionDir,
        noSession: options.noSession ?? false,
      }));
  const prompt = buildGemmaPrompt(input);

  try {
    const output = await runner(prompt, timeoutMs, command);
    return parseGemmaOutput(output);
  } catch {
    return {
      summary: LLM_FALLBACK_SUMMARY,
      concerns: [],
    };
  }
};

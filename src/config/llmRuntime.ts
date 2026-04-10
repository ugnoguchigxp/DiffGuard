import { DEFAULT_GEMMA_COMMAND, DEFAULT_GEMMA_TIMEOUT_MS } from "../constants/llm";

import type { DiffGuardConfig, LlmMode } from "../types";

const toBoolean = (value: string | undefined): boolean | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
};

const toPositiveNumber = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
};

const toNumber = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
};

const toLlmMode = (value: string | undefined): LlmMode | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "gemma-command" || normalized === "local-openai-api") {
    return normalized;
  }

  return undefined;
};

export interface LlmRuntimeSettings {
  enabled: boolean;
  mode: LlmMode;
  command: string;
  timeoutMs: number;
  sessionDir?: string;
  noSession: boolean;
  apiBaseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export const resolveLlmRuntimeSettings = (
  config: DiffGuardConfig,
  cliEnableLlmFlag: boolean,
): LlmRuntimeSettings => {
  const envEnabled = toBoolean(process.env.DIFFGUARD_ENABLE_LLM);
  const configEnabled = config.llm?.enabled;
  const enabled = cliEnableLlmFlag ? true : (configEnabled ?? envEnabled ?? false);

  const envMode = toLlmMode(process.env.DIFFGUARD_LLM_MODE);
  const configMode = config.llm?.mode;
  const mode = configMode ?? envMode ?? "gemma-command";

  const command =
    config.llm?.command ??
    process.env.DIFFGUARD_LLM_COMMAND ??
    process.env.GEMMA4_COMMAND ??
    DEFAULT_GEMMA_COMMAND;

  const timeoutMs =
    config.llm?.timeoutMs ??
    toPositiveNumber(process.env.DIFFGUARD_LLM_TIMEOUT_MS) ??
    DEFAULT_GEMMA_TIMEOUT_MS;

  const sessionDir = config.llm?.sessionDir ?? process.env.DIFFGUARD_LLM_SESSION_DIR;
  const noSession =
    config.llm?.noSession ?? toBoolean(process.env.DIFFGUARD_LLM_NO_SESSION) ?? false;

  const apiBaseUrl =
    config.llm?.apiBaseUrl ??
    process.env.DIFFGUARD_LOCAL_LLM_API_BASE_URL ??
    process.env.LOCAL_LLM_BASE_URL ??
    "http://127.0.0.1:44448/v1";

  const model =
    config.llm?.model ??
    process.env.DIFFGUARD_LOCAL_LLM_MODEL ??
    process.env.GEMMA4_API_MODEL_ID ??
    "gemma-4-e4b-it";

  const maxTokens =
    config.llm?.maxTokens ?? toPositiveNumber(process.env.DIFFGUARD_LOCAL_LLM_MAX_TOKENS) ?? 256;

  const temperature =
    config.llm?.temperature ?? toNumber(process.env.DIFFGUARD_LOCAL_LLM_TEMPERATURE) ?? 0;

  return {
    enabled,
    mode,
    command,
    timeoutMs,
    ...(sessionDir ? { sessionDir } : {}),
    noSession,
    apiBaseUrl,
    model,
    maxTokens,
    temperature,
  };
};

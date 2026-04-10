import { LLM_FALLBACK_SUMMARY } from "../constants/llm";
import type { LlmReview } from "../types";
import { parseGemmaOutput } from "./gemmaClient";

export interface LocalOpenAiReviewInput {
  diff: string;
  relatedCode: string;
}

export interface LocalOpenAiClientOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  fetchImpl?: typeof fetch;
}

const buildPrompt = (input: LocalOpenAiReviewInput): string => {
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

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const trimTrailingSlash = (value: string): string => {
  return value.endsWith("/") ? value.slice(0, -1) : value;
};

const toChatCompletionsUrl = (baseUrl: string): string => {
  const normalized = trimTrailingSlash(baseUrl.trim());
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }

  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }

  return `${normalized}/v1/chat/completions`;
};

export const reviewWithLocalOpenAi = async (
  input: LocalOpenAiReviewInput,
  options: LocalOpenAiClientOptions,
): Promise<LlmReview> => {
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
            content: "You are a strict code reviewer.",
          },
          {
            role: "user",
            content: buildPrompt(input),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Local OpenAI API call failed: status=${response.status}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      return {
        summary: LLM_FALLBACK_SUMMARY,
        concerns: [],
      };
    }

    return parseGemmaOutput(content);
  } catch {
    return {
      summary: LLM_FALLBACK_SUMMARY,
      concerns: [],
    };
  } finally {
    clearTimeout(timeout);
  }
};

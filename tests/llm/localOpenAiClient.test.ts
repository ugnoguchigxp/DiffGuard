import { describe, expect, it } from "vitest";

import { reviewWithLocalOpenAi } from "../../src/llm/localOpenAiClient";

describe("reviewWithLocalOpenAi", () => {
  it("calls openai-compatible endpoint and parses content", async () => {
    const result = await reviewWithLocalOpenAi(
      {
        diff: "diff text",
        relatedCode: "code text",
      },
      {
        baseUrl: "http://localhost:44448/v1",
        model: "gemma-4-e4b-it",
        timeoutMs: 1000,
        maxTokens: 256,
        temperature: 0,
        fetchImpl: async (url, init) => {
          expect(url).toBe("http://localhost:44448/v1/chat/completions");
          const body = JSON.parse(String(init?.body));
          expect(body.model).toBe("gemma-4-e4b-it");
          expect(body.messages).toHaveLength(2);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: "summary\nconcern1" } }],
            }),
          } as Response;
        },
      },
    );

    expect(result.summary).toBe("summary");
    expect(result.concerns).toEqual(["concern1"]);
  });

  it("returns fallback on API failure", async () => {
    const result = await reviewWithLocalOpenAi(
      {
        diff: "diff text",
        relatedCode: "code text",
      },
      {
        baseUrl: "http://localhost:44448/v1",
        model: "gemma-4-e4b-it",
        timeoutMs: 1000,
        maxTokens: 256,
        temperature: 0,
        fetchImpl: async () => {
          throw new Error("network error");
        },
      },
    );

    expect(result.summary).toContain("LLM review skipped");
    expect(result.concerns).toEqual([]);
  });

  it("accepts root base url and appends /v1/chat/completions", async () => {
    await reviewWithLocalOpenAi(
      {
        diff: "diff text",
        relatedCode: "code text",
      },
      {
        baseUrl: "http://localhost:44448",
        model: "gemma-4-e4b-it",
        timeoutMs: 1000,
        maxTokens: 256,
        temperature: 0,
        fetchImpl: async (url) => {
          expect(url).toBe("http://localhost:44448/v1/chat/completions");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: "summary" } }],
            }),
          } as Response;
        },
      },
    );
  });

  it("accepts full chat completions endpoint as base url", async () => {
    await reviewWithLocalOpenAi(
      {
        diff: "diff text",
        relatedCode: "code text",
      },
      {
        baseUrl: "http://localhost:44448/v1/chat/completions",
        model: "gemma-4-e4b-it",
        timeoutMs: 1000,
        maxTokens: 256,
        temperature: 0,
        fetchImpl: async (url) => {
          expect(url).toBe("http://localhost:44448/v1/chat/completions");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: "summary" } }],
            }),
          } as Response;
        },
      },
    );
  });
});

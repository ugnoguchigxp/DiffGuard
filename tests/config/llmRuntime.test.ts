import { describe, expect, it } from "vitest";

import { resolveLlmRuntimeSettings } from "../../src/config/llmRuntime";

describe("resolveLlmRuntimeSettings", () => {
  it("prefers cli enable flag and config values", () => {
    const settings = resolveLlmRuntimeSettings(
      {
        llm: {
          enabled: false,
          mode: "local-openai-api",
          apiBaseUrl: "http://localhost:44448/v1",
          model: "gemma-4-e4b-it",
          maxTokens: 300,
          temperature: 0.1,
          timeoutMs: 9000,
          sessionDir: "/tmp/diffguard-sessions",
          noSession: true,
        },
      },
      true,
    );

    expect(settings.enabled).toBe(true);
    expect(settings.mode).toBe("local-openai-api");
    expect(settings.maxTokens).toBe(300);
    expect(settings.temperature).toBe(0.1);
    expect(settings.timeoutMs).toBe(9000);
    expect(settings.sessionDir).toBe("/tmp/diffguard-sessions");
    expect(settings.noSession).toBe(true);
  });

  it("falls back to env values", () => {
    const prevEnable = process.env.DIFFGUARD_ENABLE_LLM;
    const prevMode = process.env.DIFFGUARD_LLM_MODE;
    const prevMaxTokens = process.env.DIFFGUARD_LOCAL_LLM_MAX_TOKENS;
    const prevSessionDir = process.env.DIFFGUARD_LLM_SESSION_DIR;
    const prevNoSession = process.env.DIFFGUARD_LLM_NO_SESSION;

    process.env.DIFFGUARD_ENABLE_LLM = "true";
    process.env.DIFFGUARD_LLM_MODE = "local-openai-api";
    process.env.DIFFGUARD_LOCAL_LLM_MAX_TOKENS = "512";
    process.env.DIFFGUARD_LLM_SESSION_DIR = "/tmp/diffguard-sessions-env";
    process.env.DIFFGUARD_LLM_NO_SESSION = "true";

    try {
      const settings = resolveLlmRuntimeSettings({}, false);
      expect(settings.enabled).toBe(true);
      expect(settings.mode).toBe("local-openai-api");
      expect(settings.maxTokens).toBe(512);
      expect(settings.sessionDir).toBe("/tmp/diffguard-sessions-env");
      expect(settings.noSession).toBe(true);
    } finally {
      if (prevEnable === undefined) {
        delete process.env.DIFFGUARD_ENABLE_LLM;
      } else {
        process.env.DIFFGUARD_ENABLE_LLM = prevEnable;
      }

      if (prevMode === undefined) {
        delete process.env.DIFFGUARD_LLM_MODE;
      } else {
        process.env.DIFFGUARD_LLM_MODE = prevMode;
      }

      if (prevMaxTokens === undefined) {
        delete process.env.DIFFGUARD_LOCAL_LLM_MAX_TOKENS;
      } else {
        process.env.DIFFGUARD_LOCAL_LLM_MAX_TOKENS = prevMaxTokens;
      }

      if (prevSessionDir === undefined) {
        delete process.env.DIFFGUARD_LLM_SESSION_DIR;
      } else {
        process.env.DIFFGUARD_LLM_SESSION_DIR = prevSessionDir;
      }

      if (prevNoSession === undefined) {
        delete process.env.DIFFGUARD_LLM_NO_SESSION;
      } else {
        process.env.DIFFGUARD_LLM_NO_SESSION = prevNoSession;
      }
    }
  });

  it("normalizes mode from env value", () => {
    const previousMode = process.env.DIFFGUARD_LLM_MODE;
    process.env.DIFFGUARD_LLM_MODE = " LOCAL-OPENAI-API ";

    try {
      const settings = resolveLlmRuntimeSettings({}, false);
      expect(settings.mode).toBe("local-openai-api");
    } finally {
      if (previousMode === undefined) {
        delete process.env.DIFFGUARD_LLM_MODE;
      } else {
        process.env.DIFFGUARD_LLM_MODE = previousMode;
      }
    }
  });
});

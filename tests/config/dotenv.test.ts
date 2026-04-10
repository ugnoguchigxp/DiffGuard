import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadDotEnvFile, parseDotEnv } from "../../src/config/dotenv";

describe("dotenv", () => {
  it("parses dotenv text", () => {
    const parsed = parseDotEnv(
      [
        "# comment",
        "DIFFGUARD_ENABLE_LLM=true",
        "EMPTY=",
        'QUOTED="hello"',
        "SINGLE='world'",
        "INVALID_LINE",
      ].join("\n"),
    );

    expect(parsed.DIFFGUARD_ENABLE_LLM).toBe("true");
    expect(parsed.EMPTY).toBe("");
    expect(parsed.QUOTED).toBe("hello");
    expect(parsed.SINGLE).toBe("world");
    expect(parsed.INVALID_LINE).toBeUndefined();
  });

  it("loads .env file and does not overwrite existing process.env", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "diffguard-dotenv-"));
    const envPath = path.join(root, ".env");

    const prev = process.env.DIFFGUARD_ENABLE_LLM;
    process.env.DIFFGUARD_ENABLE_LLM = "preset";

    try {
      await writeFile(envPath, "DIFFGUARD_ENABLE_LLM=true\nDIFFGUARD_LLM_MODE=local-openai-api\n");
      const parsed = await loadDotEnvFile(root);

      expect(parsed.DIFFGUARD_LLM_MODE).toBe("local-openai-api");
      expect(process.env.DIFFGUARD_ENABLE_LLM).toBe("preset");
      expect(process.env.DIFFGUARD_LLM_MODE).toBe("local-openai-api");
    } finally {
      if (prev === undefined) {
        delete process.env.DIFFGUARD_ENABLE_LLM;
      } else {
        process.env.DIFFGUARD_ENABLE_LLM = prev;
      }
      delete process.env.DIFFGUARD_LLM_MODE;
      await rm(root, { recursive: true, force: true });
    }
  });
});

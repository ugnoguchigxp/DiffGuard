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
        "DIFFGUARD_EXAMPLE_FLAG=true",
        "EMPTY=",
        'QUOTED="hello"',
        "SINGLE='world'",
        "INVALID_LINE",
      ].join("\n"),
    );

    expect(parsed.DIFFGUARD_EXAMPLE_FLAG).toBe("true");
    expect(parsed.EMPTY).toBe("");
    expect(parsed.QUOTED).toBe("hello");
    expect(parsed.SINGLE).toBe("world");
    expect(parsed.INVALID_LINE).toBeUndefined();
  });

  it("loads .env file and does not overwrite existing process.env", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "diffguard-dotenv-"));
    const envPath = path.join(root, ".env");

    const prev = process.env.DIFFGUARD_EXAMPLE_FLAG;
    process.env.DIFFGUARD_EXAMPLE_FLAG = "preset";

    try {
      await writeFile(envPath, "DIFFGUARD_EXAMPLE_FLAG=true\nDIFFGUARD_EXAMPLE_MODE=test\n");
      const parsed = await loadDotEnvFile(root);

      expect(parsed.DIFFGUARD_EXAMPLE_MODE).toBe("test");
      expect(process.env.DIFFGUARD_EXAMPLE_FLAG).toBe("preset");
      expect(process.env.DIFFGUARD_EXAMPLE_MODE).toBe("test");
    } finally {
      if (prev === undefined) {
        delete process.env.DIFFGUARD_EXAMPLE_FLAG;
      } else {
        process.env.DIFFGUARD_EXAMPLE_FLAG = prev;
      }
      delete process.env.DIFFGUARD_EXAMPLE_MODE;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("can load .env without mutating process.env", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "diffguard-dotenv-"));
    const envPath = path.join(root, ".env");

    const prevMode = process.env.DIFFGUARD_EXAMPLE_MODE;
    delete process.env.DIFFGUARD_EXAMPLE_MODE;

    try {
      await writeFile(envPath, "DIFFGUARD_EXAMPLE_MODE=test\n");
      const parsed = await loadDotEnvFile(root, ".env", { mutateProcessEnv: false });

      expect(parsed.DIFFGUARD_EXAMPLE_MODE).toBe("test");
      expect(process.env.DIFFGUARD_EXAMPLE_MODE).toBeUndefined();
    } finally {
      if (prevMode !== undefined) {
        process.env.DIFFGUARD_EXAMPLE_MODE = prevMode;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});

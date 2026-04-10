import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadDiffGuardConfig } from "../../src/config/loader";

describe("loadDiffGuardConfig", () => {
  it("returns empty config when file is not found", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "diffguard-config-"));

    try {
      const loaded = await loadDiffGuardConfig(workspaceRoot);
      expect(loaded.config).toEqual({});
      expect(loaded.filePath).toBeUndefined();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("loads explicit jsonc config", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "diffguard-config-"));
    const configPath = path.join(workspaceRoot, "custom.jsonc");

    try {
      await writeFile(
        configPath,
        ["// comment", "{", '  "failOn": "warn",', '  "outputFormat": "sarif"', "}"].join("\n"),
      );

      const loaded = await loadDiffGuardConfig(workspaceRoot, configPath);
      expect(loaded.config.failOn).toBe("warn");
      expect(loaded.config.outputFormat).toBe("sarif");
      expect(loaded.filePath).toBe(configPath);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("loads discovered js config", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "diffguard-config-"));
    const configPath = path.join(workspaceRoot, "diffguard.config.mjs");

    try {
      await writeFile(
        configPath,
        ["export default {", "  failOn: 'error',", "  plugins: ['./plugin.mjs']", "};"].join("\n"),
      );

      const loaded = await loadDiffGuardConfig(workspaceRoot);
      expect(loaded.config.failOn).toBe("error");
      expect(loaded.config.plugins).toEqual(["./plugin.mjs"]);
      expect(loaded.filePath).toBe(configPath);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("loads named diffGuardConfig export from script", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "diffguard-config-"));
    const configPath = path.join(workspaceRoot, "diffguard.config.mjs");

    try {
      await writeFile(
        configPath,
        [
          "export const diffGuardConfig = {",
          "  failOn: 'none',",
          "  cache: { enabled: false, maxEntries: 1 }",
          "};",
        ].join("\n"),
      );

      const loaded = await loadDiffGuardConfig(workspaceRoot);
      expect(loaded.config.failOn).toBe("none");
      expect(loaded.config.cache?.enabled).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

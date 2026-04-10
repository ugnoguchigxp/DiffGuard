import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPluginRules } from "../../src/plugins/loader";

describe("loadPluginRules", () => {
  it("loads default rule and named rules from plugins", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "diffguard-plugin-"));
    const pluginA = path.join(workspaceRoot, "plugin-a.mjs");
    const pluginB = path.join(workspaceRoot, "plugin-b.mjs");

    try {
      await writeFile(
        pluginA,
        ["export default {", "  id: 'PLG001',", "  run: () => [],", "};"].join("\n"),
      );
      await writeFile(
        pluginB,
        [
          "export const rules = [",
          "  { id: 'PLG002', run: () => [] },",
          "  { id: '', run: () => [] },",
          "  { id: 'PLG003', run: 'not-a-function' },",
          "];",
        ].join("\n"),
      );

      const loaded = await loadPluginRules([pluginA, "./plugin-b.mjs"], workspaceRoot);
      expect(loaded.map((rule) => rule.id)).toEqual(["PLG001", "PLG002"]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

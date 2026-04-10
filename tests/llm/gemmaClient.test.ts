import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LLM_EMPTY_SUMMARY, LLM_FALLBACK_SUMMARY } from "../../src/constants/llm";
import { buildGemmaPrompt, parseGemmaOutput, reviewWithGemma } from "../../src/llm/gemmaClient";

describe("gemmaClient", () => {
  it("builds prompt with required sections", () => {
    const prompt = buildGemmaPrompt({
      diff: "diff text",
      relatedCode: "code text",
    });

    expect(prompt).toContain("[DIFF]");
    expect(prompt).toContain("[RELATED_CODE]");
    expect(prompt).toContain("No hallucination.");
  });

  it("parses output into summary and concerns", () => {
    const result = parseGemmaOutput(["summary", "c1", "c2"].join("\n"));
    expect(result.summary).toBe("summary");
    expect(result.concerns).toEqual(["c1", "c2"]);
  });

  it("runs custom runner and parses response", async () => {
    const result = await reviewWithGemma(
      {
        diff: "diff",
        relatedCode: "code",
      },
      {
        runner: async () => "summary\nconcern",
      },
    );

    expect(result.summary).toBe("summary");
    expect(result.concerns).toEqual(["concern"]);
  });

  it("returns fallback result when runner fails", async () => {
    const result = await reviewWithGemma(
      {
        diff: "diff",
        relatedCode: "code",
      },
      {
        runner: async () => {
          throw new Error("boom");
        },
      },
    );

    expect(result.summary).toBe(LLM_FALLBACK_SUMMARY);
    expect(result.concerns).toEqual([]);
  });

  it("uses default command runner successfully", async () => {
    const result = await reviewWithGemma(
      {
        diff: "diff",
        relatedCode: "code",
      },
      {
        command: "/bin/echo",
      },
    );

    expect(result.summary).toBe(LLM_EMPTY_SUMMARY);
    expect(result.concerns).toEqual([]);
  });

  it("returns fallback for non-zero default command", async () => {
    const result = await reviewWithGemma(
      {
        diff: "diff",
        relatedCode: "code",
      },
      {
        command: "/bin/false",
      },
    );

    expect(result.summary).toBe(LLM_FALLBACK_SUMMARY);
  });

  it("returns fallback when default command times out", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "diffguard-gemma-"));
    const scriptPath = path.join(workspace, "slow-command.sh");

    try {
      await writeFile(scriptPath, ["#!/bin/sh", "sleep 1", "echo done"].join("\n"));
      await chmod(scriptPath, 0o755);

      const result = await reviewWithGemma(
        {
          diff: "diff",
          relatedCode: "code",
        },
        {
          command: scriptPath,
          timeoutMs: 10,
        },
      );

      expect(result.summary).toBe(LLM_FALLBACK_SUMMARY);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("reuses session id in localLlm prompt mode", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "diffguard-gemma-session-"));
    const scriptPath = path.join(workspace, "fake-gemma.sh");

    try {
      await writeFile(
        scriptPath,
        [
          "#!/bin/sh",
          'session=""',
          'while [ "$#" -gt 0 ]; do',
          '  if [ "$1" = "--session-id" ]; then',
          '    session="$2"',
          "    shift 2",
          "    continue",
          "  fi",
          "  shift",
          "done",
          'if [ -n "$session" ]; then',
          '  printf \'%s\\n\' \'{"session_id":"sess_test","response":"summary\\nwith-session"}\'',
          "else",
          '  printf \'%s\\n\' \'{"session_id":"sess_test","response":"summary\\nfirst-session"}\'',
          "fi",
        ].join("\n"),
      );
      await chmod(scriptPath, 0o755);

      const first = await reviewWithGemma(
        {
          diff: "diff-1",
          relatedCode: "code-1",
        },
        {
          command: scriptPath,
        },
      );

      const second = await reviewWithGemma(
        {
          diff: "diff-2",
          relatedCode: "code-2",
        },
        {
          command: scriptPath,
        },
      );

      expect(first.concerns).toEqual(["first-session"]);
      expect(second.concerns).toEqual(["with-session"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("disables session reuse when noSession is true", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "diffguard-gemma-nosession-"));
    const scriptPath = path.join(workspace, "fake-gemma.sh");

    try {
      await writeFile(
        scriptPath,
        [
          "#!/bin/sh",
          'session=""',
          'while [ "$#" -gt 0 ]; do',
          '  if [ "$1" = "--session-id" ]; then',
          '    session="$2"',
          "    shift 2",
          "    continue",
          "  fi",
          "  shift",
          "done",
          'if [ -n "$session" ]; then',
          '  printf \'%s\\n\' \'{"session_id":"sess_test","response":"summary\\nwith-session"}\'',
          "else",
          '  printf \'%s\\n\' \'{"session_id":"sess_test","response":"summary\\nfirst-session"}\'',
          "fi",
        ].join("\n"),
      );
      await chmod(scriptPath, 0o755);

      const first = await reviewWithGemma(
        {
          diff: "diff-1",
          relatedCode: "code-1",
        },
        {
          command: scriptPath,
          noSession: true,
        },
      );

      const second = await reviewWithGemma(
        {
          diff: "diff-2",
          relatedCode: "code-2",
        },
        {
          command: scriptPath,
          noSession: true,
        },
      );

      expect(first.concerns).toEqual(["first-session"]);
      expect(second.concerns).toEqual(["first-session"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

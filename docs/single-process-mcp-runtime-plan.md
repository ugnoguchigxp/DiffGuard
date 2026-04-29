# Single-Process MCP Runtime Plan

## Goal

diffGuard should be hosted inside the shared local MCP host instead of running
as an independent long-lived Codex-spawned Bun stdio server.

Target steady state:

- The shared host process loads diffGuard tools in-process.
- Codex no longer starts `bun run src/mcp/server.ts` for diffGuard directly.
- Direct stdio mode remains available only as a development fallback.

## Current State

Current MCP entrypoint:

- `src/mcp/server.ts`
- `package.json` scripts:
  - `mcp`: `PATH="$HOME/.bun/bin:$PATH" bun run src/mcp/server.ts`

The file already has `createMcpServer()`, but runtime context construction,
configuration loading, optional LLM setup, and tool handlers are coupled to the
SDK server registration. The shared host needs a transport-free service surface.

## Architecture

```text
shared MCP host process
  -> import diffGuard service factory
      -> diff analysis and review tools
      -> deterministic rules
      -> optional LLM client per call

dev-only direct mode
  -> src/mcp/server.ts
      -> StdioServerTransport
```

The service must be safe to load into a host that also runs other MCP services.
It should not mutate global state, start timers, or assume that `process.cwd()`
is always the target workspace.

## Implementation Plan

### Phase 1: Extract Transport-Free Service

Files:

- `src/mcp/server.ts`
- `src/mcp/service.ts`
- `src/index.ts`
- MCP-related tests

Tasks:

1. Create a `createDiffGuardMcpService()` module that returns:
   - service metadata;
   - tool definitions;
   - `callTool(name, args)`.
2. Keep `createMcpServer()` as a compatibility wrapper that registers the
   service tools into the SDK `McpServer`.
3. Ensure importing the service has no stdio side effects.

Acceptance:

- Direct `bun run src/mcp/server.ts` still works.
- The service can be imported in a unit test and called without stdio.
- Existing tool names and schemas stay stable.

### Phase 2: Make Runtime Context Explicit Per Call

Files:

- `src/mcp/service.ts`
- `src/config/loader.ts`
- `src/config/llmRuntime.ts`
- `src/engine/reviewEngine.ts`

Tasks:

1. Require `workspaceRoot` in host-facing calls when file or config resolution
   matters.
2. Keep `process.cwd()` only as a direct-stdio fallback default.
3. Cache config carefully, keyed by `workspaceRoot + configPath + pluginPaths`,
   or avoid caching until correctness is proven.
4. Ensure optional LLM clients are created per effective runtime settings and do
   not leak subprocesses.

Acceptance:

- Host calls against different workspaces do not cross-contaminate config.
- `review_diff` and `review_batch` resolve plugin/config paths from the provided
  workspace root.
- LLM-disabled default remains deterministic and fast.

### Phase 3: Keep Direct Stdio as Fallback

Files:

- `src/mcp/server.ts`
- `README.md`
- `package.json`

Tasks:

1. Keep `bun run mcp` as a direct debug command.
2. Document that Codex should use the shared host adapter after migration.
3. Add direct-mode shutdown handling for stdin close, transport close, and idle
   timeout if the SDK transport does not exit reliably by itself.

Acceptance:

- Repeated direct-mode starts do not leave old `bun run src/mcp/server.ts`
  processes.
- Direct debug mode exits cleanly after client disconnect.

### Phase 4: Integration With Shared Host

Files:

- diffGuard exports in this repo.
- Gnosis host integration files in `/Users/y.noguchi/Code/gnosis`.

Tasks:

1. Provide a stable import path for the host, such as package root export or
   `dist/mcp/service.js`.
2. Confirm the host can call:
   - `analyze_diff`
   - `review_diff`
   - `review_batch`
3. Preserve machine-readable `structuredContent` and JSON text output.
4. Keep SARIF output support unchanged.

Acceptance:

- diffGuard tools work through the shared host.
- Direct diffGuard MCP process is not required in `~/.codex/config.toml`.
- No diffGuard Bun process remains after adapter disconnect.

## Watchdog Position

diffGuard should not own a watchdog. Its direct runtime should clean itself up,
and the shared host should own process-level diagnostics.

The shared watchdog can remain useful for:

- detecting accidentally configured direct diffGuard stdio processes;
- cleaning stale adapter processes after client crashes;
- reporting multiple host processes.

If watchdog cleanup becomes part of the normal happy path, the host/adapter
lifecycle is still incomplete.

## Validation Commands

Run from `/Users/y.noguchi/Code/diffGuard`:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

Host integration smoke, run after shared host support exists:

```bash
node -e "import('./dist/mcp/service.js').then(m => console.log(Object.keys(m)))"
```

Expected runtime state after migration:

- No long-lived `bun run src/mcp/server.ts` diffGuard process.
- diffGuard tools are served by the shared host process.

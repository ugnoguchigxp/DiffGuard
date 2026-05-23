# 共有MCPホスト統合計画（単一プロセス運用）

## 目的

diffGuard を独立した長寿命 `bun` stdio プロセスとして常駐させず、共有ローカル MCP ホストの in-process サービスとして動かす。

目標状態:

- 共有ホストが diffGuard の tool 群を直接ロードする。
- Codex から `bun run src/mcp/server.ts` を常時起動しない。
- 直接 stdio 起動は開発・デバッグ時の fallback のみ残す。

## 現状

現在の MCP エントリポイント:

- `src/mcp/server.ts`
- `package.json` scripts:
  - `mcp`: `PATH="$HOME/.bun/bin:$PATH" bun run src/mcp/server.ts`

`createMcpServer()` は存在するが、runtime context 構築、設定読み込み、tool handler 登録が密結合している。共有ホスト連携には transport 非依存の service 層を明確化する必要がある。

## アーキテクチャ方針

```text
shared MCP host process
  -> import diffGuard service factory
      -> diff analysis / review tools
      -> deterministic rules only

dev-only direct mode
  -> src/mcp/server.ts
      -> StdioServerTransport
```

サービス import 時に以下をしないこと:

- グローバル状態の破壊的変更
- バックグラウンド timer 起動
- `process.cwd()` を常に workspace root とみなす前提

## 実装ステップ

### Phase 1: Transport 非依存 Service の確立

対象:

- `src/mcp/server.ts`
- `src/mcp/service.ts`
- `src/index.ts`
- MCP 関連テスト

作業:

1. `createDiffGuardMcpService()` を公開し、以下を返す。
   - service metadata
   - tool definitions
   - `callTool(name, args)`
2. `createMcpServer()` は互換ラッパーとして残し、SDK `McpServer` 登録のみを担当させる。
3. service import 時に stdio 副作用が発生しないことを保証する。

受け入れ:

- `bun run src/mcp/server.ts` は従来どおり動く。
- unit test から stdio なしで service を import / call できる。
- tool 名と schema 契約は維持される。

### Phase 2: Runtime Context を call 単位で明示

対象:

- `src/mcp/service.ts`
- `src/config/loader.ts`
- `src/engine/reviewEngine.ts`

作業:

1. path 解決が必要な call では `workspaceRoot` を受け取る。
2. `process.cwd()` は direct stdio 実行時 fallback のみで使う。
3. config cache は `workspaceRoot + configPath + pluginPaths` 単位で分離するか、正しさを確認できるまで無効化する。

受け入れ:

- 異なる workspace の呼び出しで config が混線しない。
- `review_diff` / `review_batch` が入力 `workspaceRoot` 基準で plugin/config を解決する。
- 実行は決定論的で、不要な runtime 依存を増やさない。

### Phase 3: Direct Stdio を fallback として維持

対象:

- `src/mcp/server.ts`
- `README.md`
- `package.json`

作業:

1. `bun run mcp` をローカルデバッグ用途として残す。
2. 共有ホスト経由が推奨経路であることを README に明記する。
3. transport 切断時に direct mode が確実に終了するよう、終了処理を確認・補強する。

受け入れ:

- direct mode を繰り返し起動しても stale process が残らない。
- client disconnect 後に clean exit する。

### Phase 4: 共有ホスト統合

対象:

- このリポジトリの export 面
- `/Users/y.noguchi/Code/gnosis` 側の host integration

作業:

1. 共有ホスト向けの安定 import path を提供する。
   - 例: package root export、`dist/mcp/service.js`
2. 共有ホスト経由で以下を呼べることを確認する。
   - `analyze_diff`
   - `review_diff`
   - `review_batch`
3. `structuredContent` と JSON text output の契約を維持する。
4. SARIF 出力サポートを維持する。

受け入れ:

- shared host 経由で diffGuard tools が実行できる。
- `~/.codex/config.toml` で diffGuard 専用 stdio 常駐が不要になる。
- adapter disconnect 後に diffGuard 専用 `bun` プロセスが残らない。

## Watchdog 方針

diffGuard 自身は watchdog を持たない。プロセス監視は共有ホスト側で管理する。

共有 watchdog が担う責務:

- 誤設定で起動した direct stdio プロセス検知
- client crash 後の stale adapter process cleanup
- 複数 host process の可視化

watchdog cleanup が通常経路で必須になる場合、host/adapter lifecycle が未完成と判断する。

## 検証コマンド

`/Users/y.noguchi/Code/diffGuard` で実行:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

共有ホスト統合後のスモーク:

```bash
node -e "import('./dist/mcp/service.js').then((m) => console.log(Object.keys(m)))"
```

移行完了後の期待状態:

- 長寿命 `bun run src/mcp/server.ts` が常駐しない。
- diffGuard tools は共有ホストプロセスから提供される。

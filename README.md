# DiffGuard

DiffGuard は、`Astmend` が生成した差分を解析し、影響範囲とリスクを JSON/SARIF で返す差分レビューエンジンです。  
判定は deterministic ルールを優先し、必要に応じてローカル LLM（`gemma4` / `bonsai` の CLI セッション維持実行、または OpenAI 互換 API）を補助的に利用します。

## 現在の機能

### High（実装済み）

- Astmend diff 形式対応
  - `diff --git a/... b/...`
  - `Index: ...` / `---` / `+++`
- 出力に `schemaVersion` を追加
- Issue メタデータ強化
  - `ruleId`, `confidence`, `remediation`
  - `file`, `line`, `hunk`, `symbol`
- CLI 終了コード制御
  - `--fail-on none|warn|error`

### Medium（実装済み）

- 設定ファイル対応（`diffguard.config.*`）
  - `json/jsonc/js/mjs/cjs`
- suppress/waiver 対応（`suppressions`）
- SARIF 出力（`--format sarif`）
- バッチ実行（`--batch-file` / `reviewBatch`）

### Low（実装済み）

- ルールプラグイン（`plugins` / `--plugin`）
- 解析キャッシュ（LRU）

## ルール

- `DG001` `missing-update`: 関数シグネチャ変更に対する呼び出し側追従漏れ
- `DG002` `interface-impact`: interface 変更の未追従利用
- `DG003` `unused-import`: 追加 import の未使用
- `DG004` `di-violation`: Controller での `new *Repository` 直接生成
- `DG_CONV_001` `do-not-extract-violation`: `doNotExtract` 指定ロジックの shared/common 抽出違反
- `DG_SEM_001` `semantic-api-impact`: opt-in semantic checker による公開 API 影響
- `DG_REACT_001` `react-hook-conditional`: opt-in React rule pack による条件分岐内 Hook 呼び出し
- `DG_QUERY_001` `tanstack-query-key-mismatch`: opt-in TanStack Query rule pack による `queryKey` / `queryFn` 不整合

## セットアップ

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## CLI

```bash
diffguard --diff-file <path> [--files <a,b,c>] [--workspace-root <path>] [--enable-llm]
diffguard --diff <text> [--file <path> ...] [--workspace-root <path>] [--enable-llm]
cat change.diff | diffguard [--workspace-root <path>] [--enable-llm]
diffguard --batch-file <path> [--workspace-root <path>] [--format json|sarif]
```

主なオプション:

- `--config <path>`: 設定ファイルを明示指定
- `--plugin <path>`: 追加プラグインルール（複数指定可）
- `--fail-on <none|warn|error>`: 該当 severity で終了コード `2`
- `--format <json|sarif>`: 出力形式
- `--enable-llm`: LLM レビューを強制有効化（`.env` / config での有効化より優先）
- `--context-file <path>`: proposal ID / intent / `doNotExtract` などのレビュー context JSON
- `--astmend-ops-file <path>`: Astmend operation metadata の JSON 配列
- `--emit-memory-hints`: blocking finding から Gnosis 登録向け `memoryHints` を出力
- `--compare-candidates`: batch 実行時に `batchSummary.recommendedCandidateId` を出力
- `--llm-related-code-file <path>`: LLM に渡す関連コード
- `--pretty`: 整形出力

context JSON 例:

```json
{
  "source": "astmend",
  "proposalId": "proposal-1",
  "patchPlanId": "plan-1",
  "intent": "extract",
  "constraints": {
    "doNotExtract": ["validatePrice"]
  }
}
```

Astmend operation metadata 例:

```json
[
  {
    "operationId": "op-1",
    "type": "extract_function",
    "file": "src/features/pricing.ts",
    "symbol": "validatePrice",
    "destinationFile": "src/shared/pricing.ts"
  }
]
```

## MCP（IDE 連携）

DiffGuard の MCP ツールは、共有ローカル MCP ホストから in-process に読み込める
transport-free サービスとして公開しています。Codex などの常用環境では共有ホスト側
から `diffguard/mcp/service` またはビルド後の `dist/mcp/service.js` を import して
利用してください。

ホスト向け import:

```ts
import { createDiffGuardMcpService } from "diffguard/mcp/service";

const service = createDiffGuardMcpService();
await service.callTool("review_diff", {
  diff,
  files: ["src/example.ts"],
  workspaceRoot: "/absolute/path/to/workspace",
  context: {
    source: "astmend",
    proposalId: "proposal-1",
    constraints: {
      doNotExtract: ["validatePrice"]
    }
  },
  astmendOperations: [
    {
      operationId: "op-1",
      type: "extract_function",
      file: "src/features/pricing.ts",
      destinationFile: "src/shared/pricing.ts"
    }
  ],
  emitMemoryHints: true
});
```

`review_diff` / `review_batch` は設定ファイル、プラグイン、ソースファイル解決の基準と
して `workspaceRoot` を使います。共有ホストから呼ぶ場合は明示的に渡してください。

直接 stdio 起動は開発時のデバッグ用 fallback として残しています。

```bash
pnpm mcp
```

公開ツール:

- `analyze_diff`: diff の変更タイプとファイル分析を返す
- `review_diff`: 単一 diff をレビューして JSON または SARIF を返す
- `review_batch`: 複数 diff をまとめてレビューする
- `generate_fix`: 指定した指摘（Finding）に対する修正パッチを AI で生成する

直接 stdio fallback の IDE 側設定例（MCP クライアント共通の command/args 形式）:

```json
{
  "mcpServers": {
    "diffguard": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/diffGuard", "mcp"]
    }
  }
}
```

### Cursor での登録

1. Cursor の `Settings` から MCP 設定を開き、サーバーを追加する  
2. もしくはプロジェクト直下の `.cursor/mcp.json`（プロジェクト単位）または `~/.cursor/mcp.json`（グローバル）に以下を記載

```json
{
  "mcpServers": {
    "diffguard": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/diffGuard", "mcp"]
    }
  }
}
```

補足:

- `node` で直接起動する場合は `command: "node"` と `args: ["/absolute/path/to/diffGuard/dist/mcp/server.js"]`
- この直接起動は長期運用経路ではなく、共有ホスト移行後の通常利用では不要
- 設定変更後、反映されない場合は Cursor を再起動

### GitHub Copilot CLI での登録

Copilot CLI では次の 2 つの方法があります。

1. 対話モードで `/mcp add` を実行して追加  
2. `~/.copilot/mcp-config.json` を直接編集して追加

`~/.copilot/mcp-config.json` 例:

```json
{
  "mcpServers": {
    "diffguard": {
      "type": "local",
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/diffGuard", "mcp"],
      "env": {},
      "tools": ["*"]
    }
  }
}
```

補足:

- `tools` で公開ツールを絞る場合は `["review_diff"]` などを指定可能
- 状態確認は Copilot CLI の `/mcp show` を利用

ビルド済み `dist` を使う場合:

```json
{
  "mcpServers": {
    "diffguard": {
      "command": "node",
      "args": ["/absolute/path/to/diffGuard/dist/mcp/server.js"]
    }
  }
}
```

## LLM 連携（gemma4 / bonsai / localLlm）

### 有効化の優先順位

- `--enable-llm` が指定されていれば常に有効
- それ以外は `diffguard.config.*` の `llm.enabled`
- それもなければ `.env` の `DIFFGUARD_ENABLE_LLM`

### `.env` で有効化する例

```bash
cp .env.example .env
```

`gemma4` コマンドを使う場合（推奨）:

```env
DIFFGUARD_ENABLE_LLM=true
DIFFGUARD_LLM_MODE=gemma-command
DIFFGUARD_LLM_COMMAND=gemma4
DIFFGUARD_LLM_TIMEOUT_MS=5000
```

`bonsai` コマンドを使う場合:

```env
DIFFGUARD_ENABLE_LLM=true
DIFFGUARD_LLM_MODE=gemma-command
DIFFGUARD_LLM_COMMAND=bonsai
DIFFGUARD_LLM_TIMEOUT_MS=5000
```

セッション維持の制御（`gemma4` / `bonsai` 共通）:

```env
# 任意: セッション保存先を固定したい場合
DIFFGUARD_LLM_SESSION_DIR=/absolute/path/to/sessions
# 任意: true でセッション保存を無効化（既定は false）
DIFFGUARD_LLM_NO_SESSION=false
```

DiffGuard は `../localLlm/README` の推奨に合わせ、`--prompt` + JSON 返却を使って `session_id` を保持し、2回目以降は `--session-id` を自動付与して継続します。

`../localLlm` の OpenAI 互換 API を使う場合（任意）:

```env
DIFFGUARD_ENABLE_LLM=true
DIFFGUARD_LLM_MODE=local-openai-api
DIFFGUARD_LOCAL_LLM_API_BASE_URL=http://127.0.0.1:44448
DIFFGUARD_LOCAL_LLM_MODEL=gemma-4-e4b-it
DIFFGUARD_LOCAL_LLM_MAX_TOKENS=256
DIFFGUARD_LOCAL_LLM_TEMPERATURE=0
```

`DIFFGUARD_LOCAL_LLM_API_BASE_URL` は次の形式を受け付けます。

- `http://127.0.0.1:44448`
- `http://127.0.0.1:44448/v1`
- `http://127.0.0.1:44448/v1/chat/completions`

### `../localLlm` 起動手順（APIモード時）

```bash
cd ../localLlm
./scripts/run_openai_api.sh
```

`../localLlm` 側は `POST /v1/chat/completions` を提供します。DiffGuard は `local-openai-api` モード時にこのエンドポイントを呼び出します。

### `diffguard.config.*` で設定する例

```json
{
  "llm": {
    "enabled": true,
    "mode": "gemma-command",
    "command": "gemma4",
    "timeoutMs": 5000,
    "sessionDir": "/absolute/path/to/sessions",
    "noSession": false
  }
}
```

## Opt-in 解析

semantic checker と framework rule pack は default off です。必要な repo だけ `diffguard.config.*` で有効化します。

```json
{
  "semantic": {
    "enabled": true,
    "maxFiles": 200,
    "timeoutMs": 3000
  },
  "frameworkRules": {
    "react": true,
    "tanstackQuery": true
  }
}
```

semantic checker は `workspaceRoot` と `sourceFilePaths` を使い、exported function/class/interface/type の削除・シグネチャ変更に外部参照が残っていないかを確認します。framework rule pack は React / TanStack Query の明らかな差分パターンだけを対象にします。

## Astmend 連携

Astmend の `createPatchDiff`（`Index:` 形式）をそのまま入力できます。

```bash
cat /path/to/astmend.diff | pnpm cli -- --workspace-root /path/to/repo --fail-on warn --pretty
```

## 設定ファイル例

`diffguard.config.json`:

```json
{
  "failOn": "warn",
  "outputFormat": "json",
  "excludePaths": ["src/generated/**"],
  "rules": {
    "DG003": {
      "enabled": true,
      "severity": "info",
      "confidence": 0.6,
      "remediation": "必要なら import を使うか削除してください"
    }
  },
  "suppressions": [
    {
      "ruleId": "DG003",
      "file": "src/legacy/**",
      "reason": "legacy migration",
      "expiresOn": "2027-12-31"
    }
  ],
  "plugins": ["./plugins/custom-rule.mjs"],
  "cache": {
    "enabled": true,
    "maxEntries": 128
  }
}
```

`suppressions[].expiresOn` の扱い:

- `YYYY-MM-DD`: ローカルタイムゾーンの当日 `23:59:59.999` まで有効
- ISO日時（例: `2027-12-31T15:00:00+09:00`）: 指定した時刻を過ぎると失効

## 出力

```json
{
  "schemaVersion": "1.0.0",
  "risk": "medium",
  "blocking": false,
  "levelCounts": {
    "error": 0,
    "warn": 1,
    "info": 0
  },
  "findings": [
    {
      "id": "DG003",
      "level": "warn",
      "message": "追加された import が未使用の可能性があります。",
      "file": "src/task.ts",
      "line": 1,
      "ruleId": "UNUSED_IMPORT",
      "metadata": {
        "remediation": "不要な import は削除し、必要であれば参照箇所を追加してください。"
      }
    }
  ],
  "issues": [
    {
      "type": "unused-import",
      "ruleId": "DG003",
      "message": "追加された import が未使用の可能性があります。",
      "severity": "warn",
      "confidence": 0.8,
      "remediation": "不要な import は削除し、必要であれば参照箇所を追加してください。",
      "file": "src/task.ts",
      "line": 1,
      "hunk": "@@ -1,1 +1,2 @@",
      "symbol": "unusedHelper"
    }
  ]
}
```

`findings[*].ruleId` は機械向けの正規化 ID（例: `API_BREAK`, `UNUSED_IMPORT`）です。`issues[*].ruleId` は既存互換の `DGxxx` を維持します。

`risk` / `blocking`:

- `error` が 1 件以上: `risk=high`, `blocking=true`
- `error` が 0 件かつ `warn` が 1 件以上: `risk=medium`
- それ以外: `risk=low`

## プラグイン

プラグインは `Rule` または `Rule[]` を `default` / `rules` / `rule` で export できます。

```ts
export default {
  id: "PLG001",
  run: () => [
    {
      type: "plugin-finding",
      ruleId: "PLG001",
      message: "Custom finding",
      severity: "warn",
      confidence: 0.7,
      remediation: "Take action"
    }
  ]
};
```

## 構成

```text
src/
 ├─ analyzer/
 ├─ config/
 ├─ constants/
 ├─ context/
 ├─ embedding/
 ├─ engine/
 ├─ llm/
 ├─ output/
 ├─ plugins/
 ├─ rules/
 ├─ schema/
 ├─ cli.ts
 └─ types.ts
```

# LLM非依存 DiffGuard セキュリティオーケストレーター実装計画

## 1. 判断

DiffGuard は、内部で LLM を呼び出す機能を外し、決定論的に動く差分起点のセキュリティ検証オーケストレーターへ寄せる。

DiffGuard は CLI や MCP を通じて LLM エージェントから利用されてもよい。ただし DiffGuard 自体は、OpenAI 互換 API、ローカル LLM デーモン、`gemma4`、`bonsai`、モデルによる修正生成を呼び出さない。

今後の位置づけは以下とする。

```text
DiffGuard は、CLI と MCP ワークフロー向けの、決定論的な差分起点・Skill駆動セキュリティ検証オーケストレーターである。
```

DiffGuard の価値は「DiffGuard 内で AI レビューを行うこと」ではない。価値の中心は以下に置く。

1. 現在の git diff を起点にする。
2. Astmend が利用可能なら構造コンテキストを取得する。
3. 決定論的にセキュリティ Skill を選択する。
4. 許可された静的検査と検証 runner を実行する。
5. finding と実行結果を evidence として正規化する。
6. 同じ流れを CLI と MCP から利用できるようにする。
7. 必要な場合だけ、adapter 経由で evidence を memoryRouter に渡す。

## 2. 現状

すでに使える土台は以下。

- `reviewDiff` / `reviewBatch` が決定論レビューの中心経路になっている。
- `ReviewResult` は `findings`, `issues`, `levelCounts`, `risk`, `blocking` を持つ。
- CLI と MCP の入口がすでにある。
- `createDiffGuardMcpService()` は transport-free な MCP service API として使える。
- Review request context と Astmend operation metadata を受け取れる。
- `memoryHints` は外部保存しない payload 形式として存在する。

撤去対象の LLM 関連 surface は以下。

- `src/llm/gemmaClient.ts`
- `src/llm/localOpenAiClient.ts`
- `src/llm/patchGenerator.ts`
- `src/config/llmRuntime.ts`
- `src/constants/llm.ts`
- CLI flag:
  - `--enable-llm`
  - `--llm-related-code-file`
- MCP input:
  - `enableLlm`
  - `llmRelatedCode`
- MCP tool:
  - `generate_fix`
- config section:
  - `llm`
- result field:
  - `ReviewResult.llm`
- `tests/llm/`
- CLI / config / engine / MCP の LLM 専用テスト
- README 内の gemma、bonsai、OpenAI 互換 API、生成修正の説明

この package はまだ npm 公開前の契約整理段階なので、撤去は deprecated API 対応ではなく、公開前の契約単純化として扱う。

## 3. ドキュメントレビューで解消した点

この計画は、実装着手前のレビューを通して以下を解消した状態にしている。

| 指摘 | この計画での解消 |
| :--- | :--- |
| LLM 撤去確認用 grep がこの計画文書自体に反応する | 撤去確認対象からこの計画文書を外し、実行コードと現役 product docs を対象にする |
| Phase 0 が抽象的で着手しづらい | ファイル別の Phase 0 実装マップを追加する |
| `npm` / `npx` と `allowNetwork: false` が矛盾する | package-manager 系 command を制限し、`npx` は明示 opt-in にする |
| CLI / MCP の責務が暗黙的だった | CLI、MCP、orchestrator、runner、evidence の所有範囲を分ける |
| evidence store が後続 integration の後に置かれていた | evidence schema/store を Astmend、Skill、static tool より前に置く |

ここから先は追加のコンセプト設計ではなく、実装作業に移れる状態を目指す。

## 4. 目標アーキテクチャ

初期実装は単一 package のまま進める。最初から monorepo 化しない。公開 package 境界が明確になってから必要に応じて分割する。

推奨構成は以下。

```text
src/
  analyzer/
  context/
  rules/
  semantic/
  skills/
  astmend/
  checks/
  verification/
  evidence/
  memory/
  orchestrator/
  mcp/
  cli.ts
  index.ts

skills/
  security/
    idor.md
    tenant-boundary.md
    input-validation.md
    secrets-leak.md
    ssrf.md
    xss.md
    file-upload.md
    unsafe-redirect.md
```

責務分担は以下。

| 領域 | 責務 |
| :--- | :--- |
| `analyzer` / `context` / `rules` | 既存の決定論的 diff 解析とコード影響レビュー |
| `astmend` | 任意の context packet adapter |
| `skills` | Skill.md の読み込みと適用 Skill 選択 |
| `checks` | Semgrep、Gitleaks、ast-grep adapter |
| `verification` | dry-run と許可済み command/test runner |
| `evidence` | evidence schema、正規化、保存、redaction |
| `memory` | memoryRouter adapter。既定は無効 |
| `orchestrator` | review、plan、check、verify、evidence、remember の合成 |
| `cli` / `mcp` | orchestrator API への薄い入口 |

どの層も LLM を呼び出さない。

## 5. 非対象

DiffGuard は以下を実装しない。

- OpenAI API 呼び出し
- OpenAI 互換ローカル API 呼び出し
- `gemma4` / `bonsai` command 呼び出し
- LLM による修正生成
- LLM によるテスト生成
- prompt orchestration
- DiffGuard 内部の chat / agent memory
- DiffGuard が所有する常駐 daemon
- Web UI

LLM エージェントが外側から DiffGuard を CLI / MCP で呼ぶのは問題ない。それは呼び出し側の責務であり、DiffGuard の runtime dependency ではない。

## 6. 実装フェーズ

### Phase 0: 契約整理と LLM 撤去

目的: 新しい orchestrator surface を追加する前に、LLM runtime 経路を完全に外す。

作業:

1. LLM source file を削除する。
   - `src/llm/gemmaClient.ts`
   - `src/llm/localOpenAiClient.ts`
   - `src/llm/patchGenerator.ts`
   - `src/config/llmRuntime.ts`
   - `src/constants/llm.ts`
2. `LlmReview`, `LlmMode`, `ReviewResult.llm`, `DiffGuardConfig.llm` を型と Zod schema から削除する。
3. `enableLlm`, `llmRelatedCode`, `llmClient` を engine、CLI、MCP option から削除する。
4. CLI flag `--enable-llm` と `--llm-related-code-file` を削除する。
5. MCP tool `generate_fix` を削除する。
6. `tests/llm/` を削除し、CLI / MCP / engine / config の関連テストを更新する。
7. README と既存 docs を更新し、DiffGuard を決定論的・LLM 非依存のツールとして説明する。

受け入れ条件:

- section 10 の LLM 撤去確認コマンドで、実行コードと現役 product docs に active な LLM 参照が残らない。
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` が通る。
- 既存の決定論レビュー、SARIF、plugin、semantic、framework rule のテストが通る。

Phase 0 のファイル別実装マップ:

| ファイル / パス | 作業 |
| :--- | :--- |
| `src/engine/reviewEngine.ts` | `reviewWithGemma` import、`GemmaReviewInput`、`enableLlm`、`llmRelatedCode`、`llmClient`、LLM 入力用 related-code selection、`result.llm` 代入を削除する |
| `src/cli.ts` | LLM import、`--enable-llm`、`--llm-related-code-file`、LLM settings 解決、LLM client 作成、LLM option plumbing を削除する |
| `src/mcp/service.ts` | LLM import、`enableLlm`、`llmRelatedCode`、`generate_fix`、LLM runtime context field、fix-generation handling を削除する |
| `src/types.ts` | `LlmReview`、`LlmMode`、`ReviewResult.llm`、`DiffGuardConfig.llm` を削除する |
| `src/schema/review.schema.ts` | `llmReviewSchema`、`reviewResultSchema.llm`、`diffGuardConfigSchema.llm` を削除する |
| `src/config/loader.ts` | config loading は残し、schema cleanup 後に `llm` を受け付けないことを確認する |
| `src/index.ts` | 削除済み LLM / fix module を参照する export を削除する |
| `src/llm/` | directory ごと削除する |
| `src/config/llmRuntime.ts` | 削除する |
| `src/constants/llm.ts` | 削除する |
| `tests/llm/` | directory ごと削除する |
| `tests/engine/reviewEngine.test.ts` | LLM 付与テストと LLM 入力用 related-code テストを削除する。related-code selector が別用途で残る場合のみ決定論テストとして残す |
| `tests/cli/cli.test.ts` | LLM flag/env テストを削除し、必要なら unknown option または決定論 option のテストに置き換える |
| `tests/mcp/service.test.ts` | `generate_fix` と LLM env isolation の期待値を削除し、LLM tool が公開されないことを確認する |
| `tests/config/llmRuntime.test.ts` | 削除する |
| `tests/config/dotenv.test.ts` | LLM 専用 env assertion を削除し、一般的な dotenv 挙動のテストに置き換える |
| `README.md` | product description、CLI option、MCP tool list を書き換え、LLM 連携 section を削除する |
| `docs/diffguard-enhancement-plan.md` | superseded と明記するか、LLM output を active target として扱わない記述に更新する |
| `docs/single-process-mcp-runtime-plan.md` | shared-host runtime の target から optional LLM setup を削除する |

Phase 0 の非交渉事項:

- no-op の deprecated LLM flag を残さない。削除後の LLM flag は unknown option として失敗させる。
- `generate_fix` を stub として残さない。MCP tool list から削除する。
- 互換性のために `llm?: ...` を public schema に残さない。npm 公開前の契約整理として削除する。
- 代替の model hook、provider abstraction、prompt extension point を追加しない。
- `issues`, `findings`, `risk`, `blocking`, `levelCounts`, `context`, `memoryHints` の既存決定論 output は維持する。

### Phase 1: npm-ready な単一 package と CLI command

目的: repo-local な知識なしで package を利用できる状態にする。

作業:

1. package 名を決める。
   - 推奨: `@ugnoguchi/diffguard`
2. package metadata を整える。
   - `private: false`
   - `license`
   - `files`
   - `bin.diffguard`
   - `exports`
   - `prepublishOnly`
3. 開発は Bun / pnpm のまま維持しつつ、npm 公開するなら build 済み CLI が Node で動くことを確認する。
4. command router を追加する。
   - `diffguard version`
   - `diffguard init`
   - `diffguard review --base main --head HEAD`
   - `diffguard plan --base main --head HEAD`
   - `diffguard check --base main --head HEAD --static`
   - `diffguard verify --base main --head HEAD --dry-run`
   - `diffguard remember --evidence <path>`
   - `diffguard mcp`
5. 旧 diff-input mode は互換入口として一時的に残す。
   - `diffguard --diff-file ...`
   - stdin diff
   - `--batch-file`

受け入れ条件:

- `node dist/cli.js version` が package version を出力する。
- `node dist/cli.js review --base main --head HEAD --format json` が review report を出力する。
- `npm pack --dry-run` に `dist`, `skills`, `README.md`, `LICENSE` が含まれる。
- 意図的に削除するまでは、既存の direct diff mode が動作する。

### Phase 2: config と安全モデル

目的: LLM の複雑さを再導入せず、新しい orchestrator config を追加する。

config 形状:

```ts
export default defineConfig({
  repo: {
    root: ".",
    base: "main"
  },
  astmend: {
    enabled: true,
    command: "astmend",
    args: ["context"]
  },
  skills: {
    directories: ["./security-skills", "./skills/security"]
  },
  checks: {
    semgrep: true,
    gitleaks: true,
    astGrep: false,
    vitest: true,
    playwright: false
  },
  memoryRouter: {
    enabled: false,
    endpoint: undefined,
    projectId: undefined
  },
  safety: {
    allowNetwork: false,
    allowWrite: false,
    timeoutMs: 120000,
    maxEvidenceSizeMb: 20,
    redactSecrets: true,
    allowedCommands: ["git", "astmend", "semgrep", "gitleaks", "ast-grep", "pnpm", "vitest", "playwright"]
  }
});
```

安全ルール:

- 既定の書き込み先は `.diffguard/` のみに制限する。
- 外部 network は既定で無効にする。
- production env file は読み込まない。
- command execution は shell string ではなく argv array で行う。
- command は allowlist を通す。
- すべての command に timeout と cwd を必ず設定する。
- memoryRouter に送る前に evidence を redact する。
- `npm` と `npx` は既定 allowlist に入れない。明示 config でのみ許可し、package download が必要なら `allowNetwork: true` と pinned package/version を要求する。
- `pnpm` は project-local script または installed dependency に解決される `pnpm exec` に限定する。`pnpm install`, `pnpm add`, `pnpm dlx` や package download flow は明示許可がない限り拒否する。
- どの実装層も直接 subprocess を起動しない。外部 tool integration は共通 safe command runner を通す。

受け入れ条件:

- `diffguard init` が `diffguard.config.ts` と starter skills を生成する。
- config schema が危険な unknown execution mode を拒否する。
- command runner の allowlist、timeout、cwd、write-scope がテストされている。

safe command runner の配置:

```text
src/runner/safeCommand.ts
```

最小 API:

```ts
export interface SafeCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  allowNetwork: boolean;
  allowWrite: boolean;
  allowedCommands: string[];
  writeRoot?: string;
}
```

runner は stdout、stderr、exit code、duration、timeout status、evidence capture が有効な場合の redacted raw-output path を返す。tool 固有の output 解釈は runner ではなく adapter が担当する。

### Phase 3: Astmend context adapter

目的: Astmend が利用できる場合は使い、利用できない場合も DiffGuard の基本動作を止めない。

作業:

1. `src/astmend/contextAdapter.ts` を追加する。
2. 以下を support する。
   - CLI command: `astmend context --base <base> --head <head> --format json`
   - 利用可能な場合の library import fallback
3. 返ってきた context packet を Zod で validate する。
4. Astmend warning を DiffGuard report warning に変換する。
5. Astmend が利用できない場合は degraded mode で続行する。

```text
Astmend is not available. DiffGuard will run diff-based checks only.
```

受け入れ条件:

- Astmend が利用できる場合、changed files、changed symbols、routes、db queries、risk hints、recommended skills が context に反映される。
- Astmend が利用できない場合も、warning と evidence を残して review が完了する。
- success、invalid JSON、non-zero exit、timeout、missing command の adapter test がある。

### Phase 4: Skill.md loader と selector

目的: Skill.md を prompt ではなく、決定論的な review policy source として扱う。

作業:

1. `src/skills/skillSchema.ts` を追加する。
2. `src/skills/loader.ts` を追加する。
3. `src/skills/selector.ts` を追加する。
4. starter security skills を同梱する。
   - `idor`
   - `tenant-boundary`
   - `input-validation`
   - `secrets-leak`
   - `ssrf`
   - `xss`
   - `file-upload`
   - `unsafe-redirect`
5. 以下から Skill を選択する。
   - Astmend `riskHints`
   - changed routes
   - path params
   - db query hints
   - changed file paths
   - static diff patterns

受け入れ条件:

- `diffguard plan --base main --head HEAD --format json` が selected skills と理由を返す。
- Skill selection に LLM を使わない。
- 不正な Skill.md は review 全体を止めず warning として報告する。ただし strict mode では失敗させてよい。

### Phase 5: review plan と evidence store

目的: evidence を DiffGuard の中心成果物にする。

作業:

1. `ReviewPlan` schema を追加する。
2. `Evidence` schema を追加する。
3. `.diffguard/evidence/YYYY-MM-DD/` に evidence writer を追加する。
4. stable latest pointer または manifest を追加する。
5. evidence に以下を含める。
   - context packet summary
   - selected skills
   - review plans
   - static check summaries
   - verification dry-run plans
   - warnings
   - raw tool output paths

受け入れ条件:

- `diffguard review --base main --head HEAD` が `.diffguard/evidence/.../review.json` を書き込む。
- JSON report と保存 evidence が同じ schema を使う。
- token-like、key-like、`.env`-like value の redaction test がある。

### Phase 6: static check adapter

目的: 既存 tool を統合するが、DiffGuard 自体は SAST を再実装しない。

作業:

1. adapter を追加する。
   - Semgrep
   - Gitleaks
   - ast-grep optional
2. finding を共通 schema に正規化する。
3. raw output は evidence `raw/` に分けて保存する。
4. 設定された tool のみ、safe command runner 経由で実行する。

受け入れ条件:

- optional tool が存在しない場合、crash ではなく warning になる。
- raw output と normalized output の両方が保存される。
- `diffguard check --base main --head HEAD --static --format json` が動作する。

### Phase 7: verification runner は dry-run first

目的: LLM で test を生成せず、実行可能な verification plan を決定論的 template から作る。

作業:

1. 以下の決定論的 verification plan template を追加する。
   - IDOR
   - tenant boundary
   - input validation
2. runner interface を追加する。
   - `http-status-verifier`
   - `response-body-verifier`
   - `db-state-verifier`
   - `validation-verifier`
   - `command-output-verifier`
3. `verify` は `--dry-run` を既定にする。
4. 実行は明示指定され、かつ config で許可された場合だけ行う。

受け入れ条件:

- `diffguard verify --base main --head HEAD --dry-run` が plan を出力し evidence を保存する。
- 決定論 template と明示的な出力先が設定されない限り、生成 test を作成しない。
- 既定では外部 network も `.diffguard/` 外への書き込みも発生しない。

### Phase 8: MCP surface

目的: model logic を埋め込まず、orchestrator の各段階を agent から利用できるようにする。

移行中も残す既存 tool:

- `analyze_diff`
- `review_diff`
- `review_batch`

削除する tool:

- `generate_fix`

追加する orchestrator tool:

- `diffguard_analyze_diff`
- `diffguard_select_skills`
- `diffguard_plan_verification`
- `diffguard_run_static_checks`
- `diffguard_record_evidence`
- `diffguard_summarize_findings`

後続で追加してよい tool:

- `diffguard_run_verification`

実装ルール:

- tool handler は orchestrator service への薄い wrapper にする。
- `createDiffGuardMcpService()` は transport-free のまま維持する。
- `src/mcp/server.ts` は stdio fallback として残す。
- shared-host compatibility を release gate に含める。

受け入れ条件:

- `createDiffGuardMcpService().tools` に新 tool が公開され、LLM tool が含まれない。
- MCP tool schema がテストされている。
- `dist/mcp/service.js` の built import smoke が通る。

### Phase 9: memoryRouter adapter

目的: useful な evidence を、明示的に有効化された場合だけ外部保存する。

作業:

1. `src/memory/memoryRouterAdapter.ts` を追加する。
2. `diffguard remember --evidence <path>` を追加する。
3. `review --remember` を追加する。既定は off。
4. 送信前に evidence を redact する。
5. 以下を保存対象にする。
   - finding summary
   - rejected hypotheses
   - confirmed findings
   - learned rules
   - project-specific conventions

受け入れ条件:

- 既定では無効。
- endpoint 未設定時は明確な error を返す。
- redacted payload がテストされている。
- evidence path が source of truth として残る。

## 7. command と surface の責務

重複した orchestration logic を避けるため、責務を以下に固定する。

| surface | 所有するもの | 所有しないもの |
| :--- | :--- | :--- |
| `src/cli.ts` | argument parsing、output format、exit code mapping | review logic、command execution details、evidence normalization |
| `src/mcp/service.ts` | tool schema、workspace root validation、structured response wrapper | business logic、direct process execution、LLM/fix generation |
| `src/orchestrator/*` | review / plan / check / verify composition | CLI parsing、MCP SDK details |
| `src/runner/safeCommand.ts` | safe subprocess execution | Semgrep / Gitleaks / Astmend output parsing |
| `src/evidence/*` | evidence schema、path、redaction、persistence | external tool execution |

`review_diff` と `review_batch` は移行中の互換 tool として残す。新しい `diffguard_*` MCP tool は CLI と同じ orchestrator service を呼ぶ。

## 8. 実装順序

推奨順序:

1. Phase 0: LLM を完全に撤去する。
2. Phase 1: package と CLI command の基盤を作る。
3. Phase 2: config と safe command runner を作る。
4. Phase 5: evidence schema と store を作る。
5. Phase 3: Astmend adapter を作る。
6. Phase 4: Skill loader と selector を作る。
7. Phase 6: static tool adapter を作る。
8. Phase 8: MCP orchestrator tool を作る。
9. Phase 7: verification dry-run と runner を作る。
10. Phase 9: memoryRouter adapter を作る。

理由:

- LLM 撤去を先に行うと public contract が単純になる。
- evidence を先に置くと、後続 integration の出力先が安定する。
- Astmend と static tool は degraded-safe integration として扱い、blocker にしない。
- verification execution は evidence と安全モデルが安定してから入れる。
- memoryRouter は stable evidence shape に依存するため最後に回す。

## 9. 最初の LLM 非依存 release の受け入れ条件

最初の release は最終像より小さくする。

必須:

- 内部 LLM / OpenAI / Gemma / Bonsai runtime がない。
- npm-ready な単一 package になっている。
- `diffguard version`
- `diffguard init`
- `diffguard review --base main --head HEAD`
- `diffguard plan --base main --head HEAD`
- `.diffguard/evidence/` への review summary 出力
- built-in Skill.md
- Astmend degraded mode
- `generate_fix` を含まない transport-free MCP service
- deterministic / LLM 非依存の README

後回し:

- full verification execution
- Playwright verifier
- DB state verifier execution
- memoryRouter auto-submit
- `core`, `mcp`, `skills`, `memory-router` への package 分割
- 自動 test generation

## 10. 検証ゲート

各 phase で実行する。

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
```

release 追加ゲート:

```bash
node dist/cli.js version
node dist/cli.js review --base main --head HEAD --format json
node -e "import('./dist/index.js').then((m) => console.log(Object.keys(m).sort().join(',')))"
node -e "import('./dist/mcp/service.js').then((m) => console.log(typeof m.createDiffGuardMcpService))"
node dist/mcp/server.js < /dev/null
npm pack --dry-run
```

LLM 撤去確認:

```bash
rg -n "OpenAI|openai|LLM|llm|Gemma|gemma|bonsai|generate_fix|localOpenAi|reviewWithGemma|patchGenerator" \
  src tests README.md docs/diffguard-enhancement-plan.md docs/single-process-mcp-runtime-plan.md package.json
```

期待結果は、実行コードと現役 product docs に active な LLM runtime / product reference が残らないこと。この計画文書は撤去作業そのものを記録しているため、確認対象から外す。historical migration note を残す場合は、active product docs の外に置き、削除済み履歴であることを明示する。

Phase 0 の focused smoke:

```bash
pnpm test tests/engine/reviewEngine.test.ts
pnpm test tests/cli/cli.test.ts
pnpm test tests/mcp/service.test.ts
pnpm test tests/schema/review.schema.test.ts
```

Phase 0 後に期待する挙動:

- `diffguard --enable-llm` は unknown option として失敗する。
- `diffguard --llm-related-code-file x` は unknown option として失敗する。
- `createDiffGuardMcpService().tools` に `generate_fix` が含まれない。
- `ReviewResult` schema と通常 output に `llm` field がない。
- 旧 LLM 名の `.env` 値は、LLM runtime resolver が存在しないため DiffGuard runtime に影響しない。

## 11. リスクと対策

| リスク | 対策 |
| :--- | :--- |
| LLM 撤去で旧 consumer が壊れる | npm release 前に契約単純化として実施し、README で明記する |
| evidence schema が広がりすぎる | review summary、selected skills、plans、checks、warnings から始める |
| Skill.md が prompt 化する | fixed section を parse する決定論 policy document として扱う |
| static tool により install が重くなる | Semgrep / Gitleaks は optional external command として扱う |
| Astmend CLI が未完成 | degraded mode を first-class にする |
| command runner が危険になる | 中央集約 allowlist、argv-only、timeout、cwd、write-scope test を必須にする |
| MCP surface が急に肥大化する | service wrapper を薄くし、transport-free factory を維持する |

## 12. 最初の実装 PR scope

最初の実装 PR は Phase 0 のみに限定する。

変更内容:

1. LLM runtime file、type、schema、CLI flag、MCP tool entry、test を削除する。
2. README と、LLM を active behavior として説明している既存 planning docs を更新する。
3. 決定論レビューの挙動は変えない。
4. full verification gate を実行する。

同じ PR に package publishing、Skill.md、evidence store、Astmend adapter、command runner 実装を含めない。LLM 非依存契約が green になってから次に進む。

PR self-review checklist:

- [ ] 内部 model / API / daemon 参照が runtime code に残っていない。
- [ ] model setting 用の dead config field が残っていない。
- [ ] 削除済み LLM flag を受け付ける hidden compatibility shim がない。
- [ ] MCP tool が model-backed fix generator に依存していない。
- [ ] README が DiffGuard を deterministic / LLM 非依存として説明している。
- [ ] 既存の決定論 review output が維持されている。
- [ ] coverage threshold を緩めずに回復している。

## 13. 最終形

DiffGuard は、model、daemon、API key なしでも簡単に install して使える状態にする。

理想的な利用体験:

```bash
npx @ugnoguchi/diffguard review --base main --head HEAD
```

出力されるもの:

- selected security skills
- 具体的な review / verification hypothesis
- static check summary
- optional tool が使えない場合の degraded warning
- `.diffguard/evidence/` 配下の normalized evidence
- MCP client や automation が扱える JSON output

これが DiffGuard の境界である。DiffGuard は根拠のある verification evidence を生成する。agent や人間は、その evidence を外側で解釈する。

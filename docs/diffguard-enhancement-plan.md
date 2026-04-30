# DiffGuard 拡張実装計画

## 1. 結論と導入判断

この拡張は **段階導入するべき** です。DiffGuard はすでに `reviewDiff` を中心に deterministic ルール、JSON/SARIF 出力、CLI、MCP service、プラグイン、ローカル LLM 補助を持っているため、AI リファクタリングの安全ゲートへ寄せる土台は十分あります。

ただし、現時点の計画をそのまま一括実装するのは避けます。特に `export_memory_hint` のような新 MCP tool 追加、React 特化ルール、batch 最適化を同時に入れると、公開面とレビュー契約が膨らみます。まずは既存の `review_diff` / `review_batch` / CLI / `ReviewResult` を互換的に拡張し、失敗学習と意図検証が本当に機能することを確認してから、TypeScript semantic checker と framework rule pack へ進めます。

導入判断:

| 領域 | 判断 | 理由 |
| :--- | :--- | :--- |
| リファクタリング意図の受け取り | 採用 | Astmend / Converge 由来の proposal/operation ID を結果へ紐付ける価値が高い |
| Gnosis 向け memory hint | 採用 | 失敗を再利用可能な教訓へ変換できる。ただし直接登録ではなく payload 生成から開始する |
| 設計境界ルール | 採用 | `doNotExtract` や shared leakage は deterministic に検出しやすく、Safety Gate の中核になる |
| TypeScript semantic checker | 条件付き採用 | 価値は高いが性能と誤検知リスクがあるため、公開 API 差分から小さく始める |
| React/Hook 特化ルール | 後回し | DiffGuard core に入れるより plugin/rule pack として切り出す方が保守しやすい |
| Batch 最適化 | 後回し | `review_batch` の候補比較は有用だが、先に単体レビューの契約を固めるべき |

## 2. 現状整理

現行の主要な実装面:

- `src/engine/reviewEngine.ts`
  - `reviewDiff` / `reviewBatch` の中心。
  - `ReviewResult` に `schemaVersion`, `risk`, `blocking`, `levelCounts`, `findings`, `issues`, `llm` を返す。
  - deterministic ルールを主、LLM を補助として扱う。
- `src/schema/review.schema.ts` / `src/types.ts`
  - 入出力契約の Zod schema と TypeScript 型。
  - 既存 orchestration はこの契約に依存するため、互換性維持が最重要。
- `src/cli.ts`
  - `--diff-file`, `--diff`, stdin, `--batch-file`, `--workspace-root`, `--enable-llm`, `--format`, `--fail-on` を持つ。
- `src/mcp/service.ts`
  - transport-free な `createDiffGuardMcpService()` が durable API。
  - 公開 tool は `analyze_diff`, `review_diff`, `review_batch`。
  - host-facing review call は `workspaceRoot` 明示が原則。
- `src/context/contextBuilder.ts`
  - `ts-morph` による簡易的な参照確認をすでに実施。
- `src/rules/*`
  - `DG001` 関数シグネチャ追従漏れ。
  - `DG002` interface 影響。
  - `DG003` 未使用 import。
  - `DG004` Controller から Repository 直生成。

既存方針として、MCP は stdio サーバーを主役にせず、共有ホストから import できる service API を中心にする。この計画でも新機能は `createDiffGuardMcpService()` の `review_diff` / `review_batch` 経由で使える形にする。

## 3. 実装方針

### 3.1 互換性ルール

- `issues[]` と既存 `findings[]` は破壊しない。
- 新しい情報は optional field として追加する。
- `schemaVersion` は minor bump する。既存 consumer が未知 field を無視できる形にする。
- `DG001` などの legacy `issue.ruleId` は維持し、machine-facing な `finding.ruleId` は追加マッピングで拡張する。
- MCP の公開 tool 数は原則増やさない。必要な入力と出力は既存 `review_diff` / `review_batch` の schema 拡張で扱う。
- shared-host mode では `process.env` を汚さない。workspace 固有設定は明示 env map と `workspaceRoot` で解決する。

### 3.2 新しい入力契約

既存の内部 `ReviewContext` と名前が衝突しないよう、外部入力は `ReviewRequestContext` として追加する。

```ts
export interface ReviewRequestContext {
  schemaVersion?: "1.0.0";
  source?: "converge" | "astmend" | "manual" | "unknown";
  proposalId?: string;
  patchPlanId?: string;
  intent?: "refactor" | "extract" | "move" | "rename" | "api-change" | "cleanup";
  constraints?: {
    doNotExtract?: string[];
    allowedSharedTargets?: string[];
    forbiddenSharedTargets?: string[];
    architecturalBoundaries?: Array<{
      from: string;
      to: string;
      allowed: boolean;
      reason?: string;
    }>;
  };
  astmendOperations?: AstmendOperationMetadata[];
}

export interface AstmendOperationMetadata {
  operationId: string;
  type: "rename_symbol" | "move_symbol" | "extract_function" | "replace_node" | "delete_node" | "insert_node";
  file: string;
  symbol?: string;
  destinationFile?: string;
  beforeHash?: string;
  afterHash?: string;
}
```

入力経路:

- `ReviewInput.context?: ReviewRequestContext`
- CLI:
  - `--context-file <path>`: JSON から `ReviewRequestContext` を読み込む。
  - `--astmend-ops-file <path>`: Astmend operation array を読み込み、`context.astmendOperations` に merge する。
- MCP `review_diff`:
  - `context?: ReviewRequestContext`
  - `astmendOperations?: AstmendOperationMetadata[]`
- MCP `review_batch.items[]`:
  - item ごとに `context?: ReviewRequestContext`

`context.schemaVersion` は optional にする。未指定の場合は現在の `REVIEW_SCHEMA_VERSION` を内部的に補う。`--context-file` と `--astmend-ops-file` の両方が指定された場合は、`--astmend-ops-file` の operation 配列を `context.astmendOperations` に追記し、同じ `operationId` は後勝ちで統合する。

### 3.3 新しい出力契約

```ts
export interface ReviewResult {
  schemaVersion: string;
  risk: RiskLevel;
  blocking: boolean;
  levelCounts: Record<Severity, number>;
  findings: Finding[];
  issues: Issue[];
  llm?: LlmReview;
  context?: {
    proposalId?: string;
    patchPlanId?: string;
    operationIds?: string[];
  };
  memoryHints?: GnosisMemoryHint[];
}

export interface GnosisMemoryHint {
  id: string;
  severity: Severity;
  title: string;
  content: string;
  category: "architecture" | "debugging" | "testing" | "coding_convention" | "workflow";
  kind: "lesson" | "risk" | "rule" | "procedure";
  tags: string[];
  evidence: Array<{
    type: "finding" | "issue" | "diff" | "operation";
    value: string;
  }>;
  source?: {
    proposalId?: string;
    patchPlanId?: string;
    operationId?: string;
  };
}
```

Memory hint は Gnosis へ直接書き込まない。DiffGuard は「登録可能な payload」を生成する責務に留め、登録は Gnosis MCP / CLI 側で実行する。この分離により、DiffGuard はローカルレビューエンジンとして独立性を保てる。

## 4. 実装フェーズ

### Phase 0: 契約確定と fixture 作成

目的: 実装前に Converge/Astmend/Gnosis の接続点を fixture として固定する。

対象ファイル:

- `docs/diffguard-enhancement-plan.md`
- `tests/fixtures/` または `tests/*/*.test.ts` 内 inline fixture
- `src/schema/review.schema.ts`

作業:

1. `ReviewRequestContext` / `AstmendOperationMetadata` / `GnosisMemoryHint` の最小 JSON fixture を作る。
2. `schemaVersion` の bump 方針を決める。
3. 既存 `reviewResultSchema` が旧 shape を受け付け続けるテストを残す。
4. 新 shape の Zod parse test を追加する。

完了条件:

- 新旧 `ReviewInput` / `ReviewResult` の schema test が通る。
- 旧 CLI/MCP 呼び出しの fixture が変更不要で通る。

### Phase 1: Review context ingestion

目的: 外部ツールの意図と operation ID を DiffGuard が受け取り、結果へ反映できるようにする。

対象ファイル:

- `src/types.ts`
- `src/schema/review.schema.ts`
- `src/engine/reviewEngine.ts`
- `src/cli.ts`
- `src/mcp/service.ts`
- `tests/schema/review.schema.test.ts`
- `tests/cli/cli.test.ts`
- `tests/mcp/service.test.ts`
- `tests/engine/reviewEngine.test.ts`

作業:

1. `ReviewInput.context` を optional 追加する。
2. CLI に `--context-file` と `--astmend-ops-file` を追加する。
3. `parseBatchInput` で batch item の `context` を維持する。
4. MCP `review_diff` / `review_batch` input schema に `context` と `astmendOperations` を追加する。
5. `reviewDiff` の結果に `context.proposalId`, `context.patchPlanId`, `operationIds` を反映する。
6. 既存 consumer が使う `issues[]` / `findings[]` には optional metadata として `proposalId` / `operationId` を付与する。
7. `buildContext` が返す内部 `ReviewContext` に `requestContext?: ReviewRequestContext` を追加し、rule 実装は外部入力へ直接依存せず `ReviewContext` 経由で参照する。

完了条件:

- `diffguard --diff-file change.diff --context-file context.json --pretty` で context が結果 JSON に出る。
- MCP `review_diff` に context を渡すと `structuredContent.result.context` に ID が出る。
- 既存 `pnpm test` の fixture は破壊されない。

### Phase 2: Memory hint generation

目的: blocking finding を Gnosis が登録しやすい lesson/risk/rule/procedure payload に変換する。

対象ファイル:

- `src/engine/reviewEngine.ts`
- `src/schema/review.schema.ts`
- `src/types.ts`
- `src/cli.ts`
- `src/mcp/service.ts`
- `tests/engine/reviewEngine.test.ts`
- `tests/schema/review.schema.test.ts`
- `tests/cli/cli.test.ts`
- `tests/mcp/service.test.ts`

作業:

1. `GnosisMemoryHint` schema/type を追加する。
2. `finding.level === "error"` または `blocking === true` の場合に hint を生成する。
3. hint は finding の `ruleId`, `blockingReason`, `remediation`, `file`, `symbol`, context ID を含める。
4. CLI は `--emit-memory-hints` 指定時に `memoryHints` を出力する。未指定時は互換性優先で省略可能にする。
5. MCP は `emitMemoryHints?: boolean` を受け、`structuredContent.result.memoryHints` を返す。
6. 直接 Gnosis へ登録する処理は実装しない。

完了条件:

- DG001 の blocking result から `GnosisMemoryHint` が生成される。
- non-blocking result では default で hint が空または省略される。
- hint の payload が `record_task_note` / `finish_task` に転用できる粒度になっている。

### Phase 3: Intent and architecture boundary rules

目的: リファクタリング意図に反する変更を deterministic rule としてブロックする。

対象ファイル:

- `src/types.ts`
- `src/context/contextBuilder.ts`
- `src/rules/index.ts`
- `src/rules/intentRule.ts`
- `tests/rules/rules.test.ts`
- `tests/context/contextBuilder.test.ts`

追加ルール:

| Rule | Severity | 検出内容 |
| :--- | :--- | :--- |
| `DG_CONV_001` | error | `doNotExtract` に含まれる symbol/文字列が shared/common 配下へ移動した |
| `DG_ARCH_001` | error | feature 固有の型・関数が禁止された shared 層へ漏れた |
| `DG_CONV_005` | warn/error | intent 外の責務が同一 patch に混入した |

実装方針:

- diff header と added/removed line から移動先ファイルをまず判定する。
- AST 完全一致へ進む前に path/symbol ベースの cheap check を実装する。
- `context.constraints.architecturalBoundaries` を rule 入力に含める。
- false positive を抑えるため、`confidence` と `remediation` を明示する。

完了条件:

- `doNotExtract: ["validatePrice"]` を渡した状態で `src/features/...` から `src/shared/...` へ抽出した diff が error になる。
- 許可された `allowedSharedTargets` への移動は通る。
- rule ID、blockingReason、remediation が `findings[]` と `memoryHints[]` に反映される。

### Phase 4: TypeScript semantic checker

目的: 文字列ベースの diff 解析だけでは拾えない公開 API 破壊と未追従を検出する。

対象ファイル:

- `src/semantic/semanticChecker.ts`
- `src/context/contextBuilder.ts`
- `src/engine/reviewEngine.ts`
- `src/rules/semanticRule.ts`
- `src/schema/review.schema.ts`
- `src/types.ts`
- `tests/semantic/semanticChecker.test.ts`
- `tests/rules/rules.test.ts`

初期スコープ:

1. exported function / class / interface / type alias の signature 変更。
2. exported symbol の削除。
3. touched file 以外に残る呼び出し側の未追従候補。

後続スコープ:

1. Zod schema と TypeScript type の drift。
2. overload / generic / conditional type の詳細差分。
3. project reference / monorepo workspace の tsconfig 解決。

実装方針:

- 既存 `ts-morph` 依存を活用する。
- `workspaceRoot` と `sourceFilePaths` が明示されている場合はその範囲を優先する。
- full project scan は opt-in または上限付きにする。
- performance budget を設定する。初期目標は中規模 diff で deterministic review 1 秒以内、semantic enabled で 3 秒以内。
- config は `semantic.enabled`, `semantic.maxFiles`, `semantic.timeoutMs` を最小単位として追加する。

完了条件:

- exported function の引数追加に対して、未更新 call site があると error になる。
- touched file のみで完結する変更は false positive にならない。
- semantic checker を無効化できる config を持つ。

### Phase 5: Framework rule packs

目的: React / Hook / TanStack Query など、プロジェクト固有になりやすいルールを core から分離して提供する。

対象ファイル:

- `src/plugins/loader.ts`
- `src/rules/framework/` または separate plugin package
- `tests/plugins/loader.test.ts`
- `tests/rules/rules.test.ts`

候補ルール:

- `DG_REACT_001`: 条件分岐内 Hook 呼び出し。
- `DG_REACT_002`: `useEffect` / `useCallback` dependency の obvious mismatch。
- `DG_QUERY_001`: `queryKey` に含まれない引数を `queryFn` が参照している。

導入条件:

- core rule として常時有効にはしない。
- `diffguard.config.*` の `plugins` または rule pack config で opt-in にする。
- React repo 以外でノイズにならないことを確認する。

完了条件:

- plugin として読み込んだときだけ React/TanStack Query rule が発火する。
- core test coverage と plugin loader test が通る。

### Phase 6: Batch candidate comparison

目的: 複数パッチ案から、最も安全な候補を選ぶための machine-readable summary を返す。

対象ファイル:

- `src/engine/reviewEngine.ts`
- `src/engine/risk.ts`
- `src/schema/review.schema.ts`
- `src/types.ts`
- `src/cli.ts`
- `src/mcp/service.ts`
- `tests/engine/risk.test.ts`
- `tests/cli/cli.test.ts`
- `tests/mcp/service.test.ts`

作業:

1. `ReviewBatchInput.items[].candidateId` を optional 追加する。
2. `ReviewBatchResult` wrapper を追加し、`{ schemaVersion, results, batchSummary? }` を返せるようにする。
3. `recommendedCandidateId` と理由を返す。
4. risk は `blocking`, `levelCounts.error`, `levelCounts.warn`, semantic impact, memory hint severity の順に評価する。
5. 内部 `reviewBatch(inputs)` の既存戻り値 `Promise<ReviewResult[]>` は互換維持し、candidate comparison が必要な経路だけ `reviewBatchCandidates` または option 指定で wrapper を返す。

完了条件:

- 3 つの candidate diff を渡したとき、blocking がなく warn が最小の候補が推薦される。
- 推薦理由が JSON で機械処理可能。
- 既存 batch 出力 shape は互換性を維持する。

## 5. 検証計画

必須コマンド:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

shared-host packaging 変更を含む場合の追加検証:

```bash
node -e "import('./dist/index.js').then((m) => console.log(Object.keys(m).sort().join(',')))"
node -e "import('./dist/mcp/service.js').then((m) => console.log(typeof m.createDiffGuardMcpService))"
node dist/mcp/server.js < /dev/null
```

フェーズ別テスト観点:

| フェーズ | Unit | Integration | Contract |
| :--- | :--- | :--- | :--- |
| Phase 1 | schema/type parse | CLI context file / MCP context input | old input/output compatibility |
| Phase 2 | hint generation | blocking review -> memory hint | hint payload shape |
| Phase 3 | intent rules | doNotExtract violation diff | finding metadata / blockingReason |
| Phase 4 | semantic checker | workspaceRoot + source files | performance budget / opt-out |
| Phase 5 | plugin rules | plugin opt-in | core output unchanged |
| Phase 6 | risk ranking | multi candidate batch | old batch result still valid |

Coverage:

- 既存の Vitest coverage threshold を下げない。
- 新しい source subtree を追加した場合は、専用テストを同時に追加する。
- entrypoint だけを coverage 対象外にする場合も、service/API のテストは必須。

## 6. 実装順序

1. Phase 0 と Phase 1 を 1 PR で実施する。
2. Phase 2 を別 PR に分け、Gnosis payload の使い勝手を確認する。
3. Phase 3 を Safety Gate の最初の実価値として入れる。
4. Phase 4 は performance と false positive を見ながら opt-in で入れる。
5. Phase 5 は core ではなく plugin/rule pack として実装する。
6. Phase 6 は `review_batch` の利用者が candidate 比較を必要とする段階まで待つ。

最初に着手する最小実装:

1. `ReviewInput.context` と `ReviewResult.context` の追加。
2. CLI `--context-file` の追加。
3. MCP `review_diff.context` の追加。
4. `DG_CONV_001` の最小 rule。
5. blocking finding から `memoryHints` を生成する pure function。

この 5 点で、Astmend/Converge 由来の意図、DiffGuard の検出、Gnosis への学習 payload 生成が一通り接続できる。

## 7. リスクと対策

| リスク | 対策 |
| :--- | :--- |
| `ReviewResult` 契約変更で既存 consumer が壊れる | optional field のみ追加し、旧 fixture を必ず残す |
| MCP tool surface が肥大化する | 新 tool 追加ではなく既存 `review_diff` / `review_batch` の input/output 拡張を優先する |
| semantic checker が遅い | source scope、cache、opt-in config、performance test を入れる |
| memory hint が Gnosis の責務へ踏み込む | DiffGuard は payload 生成まで。登録は Gnosis 側に委譲する |
| framework rule がノイズ化する | plugin/rule pack として opt-in にする |
| path/symbol ベースの意図検証が誤検知する | confidence、suppression、allowed target、rule-specific remediation を必ず持たせる |

## 8. 採用後の成功条件

短期:

- Context 付き diff をレビューできる。
- blocking finding が proposal/operation ID と紐付く。
- Gnosis に登録可能な memory hint が生成される。
- `doNotExtract` 違反を deterministic に block できる。

中期:

- 公開 API 破壊を semantic checker で検出できる。
- shared-host MCP から workspace ごとに隔離された review ができる。
- false positive を suppression/config で運用可能にできる。

長期:

- 複数候補の batch review で安全な patch plan を推薦できる。
- framework rule は plugin として必要な repo だけに導入できる。
- DiffGuard が AI リファクタリング前後の安全ゲートとして、Astmend / Converge / Gnosis の間で安定した machine-readable contract を提供できる。

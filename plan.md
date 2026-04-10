# DiffGuard 実装計画（Execution Plan）

## 1. 目的
DiffGuard は、Astmend が生成した unified diff を入力として、変更の影響範囲を解析し、決定論ルールを中心にリスク評価を返す差分レビューエンジンである。

## 2. 実装スコープ
### In Scope
- diff 解析（変更タイプ分類）
- AST ベースの影響範囲抽出
- Rule Engine（決定論チェック）
- ローカル LLM 補助レビュー（任意）
- JSON 出力（risk, blocking, issues, llm）

### Out of Scope
- ファイル書き込み
- Git 操作
- UI
- CI/CD 統合

## 3. 完了定義（Definition of Done）
以下を満たした時点で「すぐ始められる準備が整った実装計画」とする。
1. 実装順序がタスク単位で定義されている
2. 各タスクに受け入れ基準がある
3. 依存関係とブロッカーが明示されている
4. テスト観点が先に定義されている
5. 初日から実装を開始する具体的コマンドがある

## 4. 成果物一覧
- コア実装
  - `src/analyzer/diffAnalyzer.ts`
  - `src/context/contextBuilder.ts`
  - `src/rules/functionRule.ts`
  - `src/rules/interfaceRule.ts`
  - `src/rules/importRule.ts`
  - `src/engine/reviewEngine.ts`
  - `src/llm/gemmaClient.ts`（Phase 2）
  - `src/types.ts`
- テスト
  - `tests/analyzer/*.test.ts`
  - `tests/context/*.test.ts`
  - `tests/rules/*.test.ts`
  - `tests/engine/*.test.ts`
  - `tests/fixtures/diff/*.patch`

## 5. 技術前提
- TypeScript
- pnpm
- Biome
- Vitest
- ts-morph
- zod
- ローカル LLM 実行環境（gemma4、Phase 2 以降）

## 5.1 実行環境の固定値
- Bun: `>=1.2.0`
- pnpm: `>=10`
- TypeScript: `5.x`
- モジュール解決: `NodeNext` または `Bundler`
- 文字コード: UTF-8

## 6. アーキテクチャ実装方針
### 6.1 データフロー
1. Input: `diff`, `files`
2. Diff Analyzer で変更タイプ抽出
3. Context Builder で最小コードコンテキスト抽出
4. Rule Engine で deterministic issues 生成
5. 任意で LLM Reviewer を実行
6. Engine で最終 risk/blocking を集約

### 6.2 主要型（先に固定）
```ts
export type ChangeType =
  | "function-signature"
  | "interface-change"
  | "import-change";

export type RiskLevel = "low" | "medium" | "high";

export interface ReviewInput {
  diff: string;
  files: string[];
}

export interface Issue {
  type: "missing-update" | "interface-impact" | "unused-import" | "di-violation";
  message: string;
  severity: "info" | "warn" | "error";
  file?: string;
  line?: number;
}

export interface ReviewResult {
  risk: RiskLevel;
  blocking: boolean;
  issues: Issue[];
  llm?: {
    summary: string;
    concerns: string[];
  };
}
```

### 6.3 リスク集約ルール（先に固定）
- `blocking=true` 条件
  - `issues` に `severity=error` が 1件以上ある
- `risk` 算出
  - `high`: `error` が 1件以上
  - `medium`: `error` は 0件で `warn` が 1件以上
  - `low`: `error/warn` が 0件（`info` のみ、または issue なし）

## 7. 実装WBS（作業分解）

## Phase 0: 基盤準備（0.5日）
### P0-1: プロジェクト初期化
- 作業
  - `package.json` 初期化
  - `tsconfig.json` 作成
  - `src/` と `tests/` の雛形作成
- 受け入れ基準
  - `pnpm typecheck` が成功する（内部で Bun 経由の実行）
  - `pnpm build` が成功する（最小エントリで可）

### P0-2: 開発ツール設定
- 作業
  - Biome 設定
  - Vitest 設定
  - `package.json` scripts 定義（`typecheck`, `lint`, `test`, `build`）
- 受け入れ基準
  - `pnpm lint`
  - `pnpm test`
  が実行可能
  - Biome の `noConsole` ルールが `error` で有効化されている

### P0-3: 型とスキーマの土台
- 作業
  - `src/types.ts` 作成
  - `src/schema/review.schema.ts` を Zod で作成
- 受け入れ基準
  - ReviewInput/ReviewResult の parse が通る

## Phase 1: MVP（2.0日）
### P1-1: Diff Analyzer
- 作業
  - unified diff パーサを実装
  - 変更タイプ判定ロジック実装
- 受け入れ基準
  - fixture diff 3種で `ChangeType[]` を正しく返す

### P1-2: Context Builder
- 作業
  - ts-morph で参照箇所収集
  - 最小コンテキスト抽出
- 受け入れ基準
  - 関数シグネチャ変更時に call site 候補が取得できる

### P1-3: Rule Engine
- 作業
  - `Rule` インターフェース作成
  - function/interface/import 3ルール実装
- 受け入れ基準
  - ルール単体テストで期待 Issue を返す

### P1-4: Review Engine
- 作業
  - analyzer/context/rules の統合
  - risk/blocking 集約ロジック実装
- 受け入れ基準
  - JSON 出力が仕様どおり

## Phase 2: LLM 補助（1.0日）
### P2-1: gemmaClient 実装
- 作業
  - subprocess 実行ラッパ作成
  - タイムアウトと失敗時フォールバック
- 受け入れ基準
  - LLM 失敗時も deterministic 結果のみで返却できる

### P2-2: LLM 統合
- 作業
  - prompt 組み立て
  - `llm.summary` / `llm.concerns` に反映
- 受け入れ基準
  - ルール結果と矛盾しない補助情報を返す

## Phase 3: 拡張（1.5日）
### P3-1: 複数ファイル対応
- 作業
  - files 配列ループ処理
  - issue の file/line 補強
- 受け入れ基準
  - 2ファイル以上の diff で一貫した結果を返せる

### P3-2: 参照解析強化
- 作業
  - interface/type alias/overload の解析強化
- 受け入れ基準
  - false negative が既存基準より減る

## Phase 4: 任意拡張（1.0日）
### P4-1: DI 違反ルール
- 作業
  - `di-violation` ルール追加
- 受け入れ基準
  - サンプルケースで error 判定になる

### P4-2: embedding 補助
- 作業
  - 検索補助としてのみ候補抽出
- 受け入れ基準
  - 判定ロジックに embedding を使っていない

## 8. 依存関係と実行順
1. P0-1
2. P0-2
3. P0-3
4. P1-1
5. P1-2
6. P1-3
7. P1-4
8. P2-1
9. P2-2
10. P3-1
11. P3-2
12. P4-1
13. P4-2

## 8.1 ブロッカー管理
- B1: `ts-morph` で解析対象ファイルを解決できない
  - 迂回策: path 解決を別モジュール化し、相対/絶対の双方に対応
- B2: diff パーサが想定外フォーマットで落ちる
  - 迂回策: 失敗時は `issues` に解析不能を `warn` で返し処理継続
- B3: gemma4 実行環境が無い
  - 迂回策: LLM ステップをスキップし deterministic 結果のみ返す

## 9. テスト計画
### 9.1 単体テスト
- analyzer: 変更タイプ分類
- context: 参照抽出の網羅
- rules: 入力コンテキストに対する Issue 判定
- engine: risk/blocking 集約

### 9.2 統合テスト
- 1つの diff から最終 JSON までの E2E 的検証
- LLM 有無の両ケースを検証

### 9.3 回帰テスト
- 過去の diff fixture を固定化しスナップショット比較

### 9.4 カバレッジ基準
- 目標: Statements / Branches / Functions / Lines の各指標で `80%` 以上
- 判定: `vitest --coverage` の threshold 設定で自動検証

## 10. リスクと対策
- リスク: diff 形式の揺れで解析失敗
  - 対策: パース失敗時は graceful fallback とエラーメタデータ返却
- リスク: ts-morph の解析コスト増大
  - 対策: 最小コンテキスト戦略と対象ノード限定
- リスク: LLM の不安定応答
  - 対策: LLM は補助扱い、判定は Rule Engine 固定

## 11. 実装開始チェックリスト（着手前に必ず確認）
1. Bun と pnpm のバージョン確認
2. `pnpm install` 実行
3. `pnpm lint` / `pnpm test` の初期成功確認
4. fixture diff を 3ケース作成
5. `src/types.ts` と Zod schema を先に固定
6. `risk/blocking` 算出ルールを `reviewEngine` に先に実装

## 12. 初日着手手順（そのまま実行可能）
```bash
pnpm init -y
pnpm add -D typescript vitest @vitest/coverage-v8 @biomejs/biome @types/node
pnpm add ts-morph zod
mkdir -p src/{analyzer,context,rules,engine,llm,schema} tests/{analyzer,context,rules,engine,fixtures/diff}
```

`package.json` scripts は最低限以下を定義する。
```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check .",
    "test": "vitest run"
  }
}
```

次に以下の順で実装する。
1. `src/types.ts`
2. `src/schema/review.schema.ts`
3. `src/analyzer/diffAnalyzer.ts`
4. `src/rules/*.ts`
5. `src/engine/reviewEngine.ts`

## 13. マイルストーン判定
- M1: Phase 0 完了
  - 開発基盤と型が固定されている
- M2: Phase 1 完了
  - deterministic MVP が動作している
- M3: Phase 2 完了
  - LLM 補助付きで安定出力できる
- M4: Phase 3 完了
  - 複数ファイルで運用可能

## 14. 自己レビュー結果（この計画書に対して）
### レビュー観点
- 実装順が明確か
- 受け入れ基準があるか
- 着手手順が具体的か
- 依存関係が破綻していないか

### 指摘と改善
- 指摘1: 旧計画は概念中心で実行順が曖昧
  - 改善: WBS と依存順を明示
- 指摘2: タスク完了判定が弱い
  - 改善: 各タスクに受け入れ基準を追加
- 指摘3: すぐに開始できる情報が不足
  - 改善: 初日コマンドと実装順を追加
- 指摘4: `risk/blocking` の判定基準が暗黙だった
  - 改善: 集約ルールを明文化
- 指摘5: 初期セットアップの再現性が弱かった
  - 改善: Bun/pnpm バージョンと scripts を固定

### 最終判定
- 実装開始可
- 初手は `P0-1` と `P0-2` を連続実行する

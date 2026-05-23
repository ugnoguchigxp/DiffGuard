# DiffGuard 拡張実装計画

この文書の旧版は、DiffGuard を AI リファクタリングの安全ゲートへ拡張する計画として作成された。

現在の方針では、DiffGuard 本体からモデル実行・外部推論 API・生成修正機能を外し、決定論的な差分レビューとセキュリティ検証オーケストレーションに集中する。

最新の実装計画は以下を参照する。

- [LLM非依存 DiffGuard セキュリティオーケストレーター実装計画](./llm-free-security-orchestrator-implementation-plan.md)

## 現在も有効な設計判断

- `reviewDiff` / `reviewBatch` を中心経路として維持する。
- `ReviewResult` の `issues`, `findings`, `levelCounts`, `risk`, `blocking`, `context`, `memoryHints` は互換性を保つ。
- `ReviewRequestContext` と `AstmendOperationMetadata` は、Astmend / 外部ツール由来の意図や operation ID を受け取る契約として維持する。
- `createDiffGuardMcpService()` は transport-free な shared-host 向け API として維持する。
- MCP handler は薄い wrapper に留め、レビュー本体は engine / orchestrator 側に置く。
- framework rule pack と semantic checker は opt-in とし、core のノイズを増やさない。

## 旧計画から変更する点

- DiffGuard 本体でモデルを呼び出す補助レビューは扱わない。
- 指摘に対する生成修正 tool は MCP surface から削除する。
- 関連コード抽出は、モデル入力のためではなく、必要になった場合だけ決定論的な context / evidence 用途として再評価する。
- Gnosis / memoryRouter 連携は直接登録ではなく、まず evidence と memory payload の境界を明確にする。

## 次に着手すること

まず最新計画の Phase 0 を実装する。

1. モデル実行に関わる runtime file、型、schema、CLI flag、MCP tool、テストを削除する。
2. README と現役 docs を決定論的な DiffGuard の説明へ更新する。
3. 既存の決定論レビュー出力を維持したまま、`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` を通す。

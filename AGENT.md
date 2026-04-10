# DiffGuard プロジェクト - 開発ガイドライン

## 🎯 プロジェクト概要
**DiffGuard: 差分レビュー専用エンジン**
- **目的**: diff の影響範囲解析とリスク評価を行う
- **主機能**:
  - diff 解析
  - AST ベースのコンテキスト抽出
  - Rule Engine による決定論チェック
  - ローカル LLM（gemma4）による補助レビュー
- **出力**: JSON 形式の判定結果

## ⚡ 必須遵守

### コーディング規約
1. **console.log 禁止**: ログは `@logger` を使用する
2. **`any` 禁止**: 適切な型定義、または `unknown` を使用する
3. **Schema-First 必須**: 入出力とドメインデータは Zod スキーマを先に定義する
4. **決定論優先**: 判定の主役は Rule Engine。LLM は補助のみ
5. **副作用禁止**: 解析処理は読み取り専用を原則とする
6. **マジックナンバー禁止**: 定数化して `src/constants/` に配置する

### プロジェクト設定
- **言語**: TypeScript
- **Package Manager**: pnpm
- **Linter/Formatter**: Biome（保存時自動フォーマット）
- **LLM 実行**: ローカル実行（例: gemma4）

## 🏛️ 設計原則
- **DRY**: 重複を避ける
- **KISS**: シンプルな実装を優先する
- **YAGNI**: 現時点で不要な機能は実装しない
- **最小コンテキスト**: 必要なコードだけ抽出する

## 🏛️ アーキテクチャ

### 全体構成
- Astmend が生成した diff を入力として処理する
- DiffGuard 内部は以下のコンポーネントで構成する
  1. Diff Analyzer
  2. Context Builder（AST）
  3. Rule Engine
  4. LLM Reviewer（任意）

### ディレクトリ構造
```text
src/
 ├─ analyzer/
 │   └─ diffAnalyzer.ts
 ├─ context/
 │   └─ contextBuilder.ts
 ├─ rules/
 │   ├─ functionRule.ts
 │   ├─ interfaceRule.ts
 │   └─ importRule.ts
 ├─ llm/
 │   └─ gemmaClient.ts
 ├─ engine/
 │   └─ reviewEngine.ts
 └─ types.ts
```

## 🎨 実装ルール

### Diff Analyzer
- unified diff を構造化し、変更タイプを分類する
- 例: `function-signature` / `interface-change` / `import-change`

### Context Builder
- `ts-morph` などで影響範囲を抽出する
- 変更に必要な最小コードだけを取得する

### Rule Engine
- ルールは共通インターフェースで実装する
```ts
export interface Rule {
  name: string;
  run(ctx: Context): Issue[];
}
```
- MVP では以下を対象にする
  - 関数シグネチャ変更の追従漏れ
  - interface 変更の影響漏れ
  - 未使用 import

### LLM Reviewer（任意）
- ルールで検出しにくい曖昧リスクのみ補助的に扱う
- 最終判定は Rule Engine の結果を優先する
- 出力は簡潔・非幻覚（No hallucination）を徹底する

## 🔌 入出力仕様

### 入力（例）
```json
{
  "diff": "... unified diff ...",
  "files": ["src/userService.ts"]
}
```

### 出力（例）
```json
{
  "risk": "low | medium | high",
  "blocking": true,
  "issues": [
    {
      "type": "missing-update",
      "message": "関数変更に対して呼び出し側未更新"
    }
  ],
  "llm": {
    "summary": "...",
    "concerns": []
  }
}
```

## 🧪 テスト
- **ツール**: Vitest
- **対象**:
  - analyzer / context / rules / engine の単体テスト
  - diff fixture を使った統合テスト
- **方針**:
  - ルールの再現性（同一入力で同一判定）を重視する
  - LLM 部分はモックし、決定論ロジックを優先的に検証する

## 🚫 このプロジェクトで扱わないもの
- Web framework（Next.js など）
- フロントエンド UI
- API Routes / Server Actions
- Design System
- CI/CD 統合（後続フェーズ）

## 📝 コミット規約
- Conventional Commits（`feat`, `fix`, `refactor`, `docs`, `chore`）

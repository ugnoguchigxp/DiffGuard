# npm 公開チェックリスト（@ugnoguchigxp/diffguard）

## 1. 前提

- npm アカウントで `@ugnoguchigxp` スコープの公開権限を持っている
- `npm whoami` でログイン済み
- 作業ディレクトリ: `/Users/y.noguchi/Code/diffGuard`

## 2. 公開前チェック

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
```

確認ポイント:

- `npm pack --dry-run` に `dist/`, `README.md`, `LICENSE` が含まれる
- 不要ファイル（`coverage/`, `tests/`, `src/`）が tarball に含まれない
- `diffguard --help` が表示される（ローカル tarball install で確認）

## 3. バージョン更新

```bash
npm version patch
```

必要に応じて `minor` / `major` を選ぶ。

## 4. 公開

```bash
npm publish --access public
```

`publishConfig.access=public` を `package.json` に設定済みなので、通常はこのコマンドのみで公開できる。

## 5. 公開後確認

```bash
npm view @ugnoguchigxp/diffguard version
npx @ugnoguchigxp/diffguard --help
```

グローバル導線確認:

```bash
npm install -g @ugnoguchigxp/diffguard
diffguard --help
```

## 6. 既知の注意点

- コマンド名は `diffguard`（小文字）
- `diffGuard` という大文字混在コマンド名は使えない
- `diffguard-mcp` は stdio MCP サーバーとして起動し、通常は待機状態になる

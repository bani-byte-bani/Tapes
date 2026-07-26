# CLAUDE.md

このリポジトリで作業するAIアシスタント向けのガイドです。コードベースの構造・開発フロー・守るべき規約をまとめています。

## プロジェクト概要

バンドの練習録音をレビューするためのWebアプリ(MVP)。1本の長い練習録音をアップロードすると、無音区間を検出して曲単位に自動分割し、タイトル付け・トリム・音量調整をしてから保存する。保存後は曲ごとに再生・★評価・タイムラインコメントができ、リンクを発行してメンバーと共有できる。

- **ログイン機能はない。** ユーザー識別も認証もしない。ローカルデータはブラウザのIndexedDB、共有データはCloudflare R2に置き、共有は「URLを知っている人だけがアクセスできる」方式(編集はURLクエリの`token`で判定)。
- **1ブラウザ = 1Band** に簡略化されている(`DEFAULT_BAND_ID = 'default-band'`)。
- モバイル(Android Chrome)での利用を主に想定した縦1カラムUI(`.app-shell`は`max-width: 480px`)。

## コマンド

```bash
npm install        # 依存インストール
npm run dev        # Vite開発サーバー(フロントのみ。/api/* は動かない)
npm run build      # dist/ へビルド
npm run preview    # ビルド結果のプレビュー(こちらも /api/* は動かない)
npx wrangler dev   # Worker + 静的アセットをまとめてローカル実行(/api/* を試すならこれ。要 npm run build)
npx wrangler deploy # 本番デプロイ(通常はCloudflareのGit連携が自動実行する)
```

**テストもリンターも設定されていない。** テストランナー・ESLint・Prettier・TypeScriptはいずれも導入されていないので、「テストを流す」「lintする」といった検証手段は存在しない。変更の確認は `npm run build` が通ることと、実際にブラウザで動かすことで行う。テスト基盤を勝手に導入しない(必要だと思ったら提案するにとどめる)。

## アーキテクチャ

3つのレイヤーで構成される。

```
ブラウザ (React SPA, src/)
  ├─ localRepository.js  ──→ IndexedDB        … 自分の端末のデータ(WAV音源つき)
  └─ remoteRepository.js ──→ fetch('/api/...') … 共有されたデータ
                                   │
                          Cloudflare Worker (worker/index.js)
                                   │
                              R2 バケット (BUCKET)
                                shares/<shareId>/meta.json
                                shares/<shareId>/audio/<trackId>.mp3
```

- ビルド成果物 `dist/` はWorkers Static Assetsとして配信される(`wrangler.toml` の `[assets]`)。
- `run_worker_first = ["/api/*"]` により、**Workerスクリプトに届くのは `/api/*` だけ**。それ以外のパスは静的アセットが処理し、`not_found_handling = "single-page-application"` によってSPAのディープリンク(`/r/xxxx` など)も自動でindex.htmlにフォールバックする。React Router は `BrowserRouter`(ハッシュルーティングではない)。
- Cloudflare Pages **ではなく** Workers with static assets 構成。`src/repository/remoteRepository.js` 冒頭に「Cloudflare Pages Functions経由」と書かれたコメントが残っているが、これは古い記述で実体はWorker。

### ディレクトリ

| パス | 役割 |
| --- | --- |
| `src/main.jsx` | エントリ。`BrowserRouter` でApp をマウント |
| `src/App.jsx` | ルーティング定義(全ルートがここに集約) |
| `src/pages/` | 画面単位のコンポーネント |
| `src/components/` | 画面をまたいで使う部品 |
| `src/audio/audioAnalysis.js` | 解析・波形描画・WAV書き出しの中核。**最重要ファイル** |
| `src/audio/mp3Encoder.js` | 共有時のMP3エンコード(lamejs) |
| `src/db/indexedDB.js` | IndexedDBのスキーマ定義(`idb`ラッパー) |
| `src/repository/localRepository.js` | IndexedDBへのアクセスを集約 |
| `src/repository/remoteRepository.js` | `/api/*` へのアクセスを集約 |
| `src/styles.css` | 全スタイル(CSS Modules等は使っていない、単一のグローバルCSS) |
| `worker/index.js` | `/api/*` のハンドラ(共有の作成・取得・更新・音声配信) |

**リポジトリへのデータアクセスは必ず `src/repository/` 経由で行う。** ページ/コンポーネントから直接 `getDB()` や `fetch('/api/...')` を呼ばないこと。

### ルート

| ルート | 画面 | データソース |
| --- | --- | --- |
| `/` | `SessionList` セッション一覧 | IndexedDB |
| `/session/new` | `SessionNew` アップロード〜分割〜保存 | IndexedDB |
| `/session/:sessionId` | `SessionDetail` トラック一覧・共有 | IndexedDB |
| `/session/:sessionId/track/:trackId` | `TrackPlayer` 再生・★・コメント | IndexedDB |
| `/r/:shareId` | `ShareViewer` 共有リンクの閲覧(`?token=` があれば編集可) | Worker + R2 |

### API(worker/index.js)

| メソッド・パス | 内容 |
| --- | --- |
| `POST /api/share` | multipart で meta(JSON) + `audio_<trackId>` を受け取りR2へ保存。`shareId` / `editToken` / 各URLを返す。`existingShareId` + `existingEditToken` を添えると既存の共有を**上書き更新**する(リンクを変えないため) |
| `GET /api/r/:shareId` | 共有レコードを返す。`editToken` と `audioKeys` は必ず除去して返す(`toPublicRecord`) |
| `PUT /api/r/:shareId?token=` | `editToken` 一致時のみ更新。受け付けるパッチは `session.memo` / `tracks[].{title,favorite,memo}` / `addComment` / `deleteCommentId` のホワイトリスト方式(`applyPatch`) |
| `GET /api/r/:shareId/audio/:trackId` | MP3を返す(`Cache-Control: immutable`) |

**セキュリティ上の不変条件:** `editToken` と R2 の内部キー(`audioKeys`)をクライアントへ返してはいけない。レスポンス生成は必ず `toPublicRecord()` を通す。`applyPatch()` はホワイトリストのまま維持し、`{...record, ...patch}` のような無差別マージに変えない(`editToken` を書き換えられてしまう)。

## データモデル

### IndexedDB(`band-practice-review`, version 2)

| ストア | keyPath | index | 備考 |
| --- | --- | --- | --- |
| `bands` | `id` | - | 実質 `default-band` の1件のみ |
| `sessions` | `id` | `by-bandId` | `{ id, bandId, date, memo, createdAt, shareId, shareEditToken, syncStatus }` |
| `tracks` | `id` | `by-sessionId` | `{ id, sessionId, title, order, startTime, endTime, favorite, memo }` |
| `trackAudio` | `trackId` | - | `{ trackId, blob }`。**音声本体をメタデータと別ストアに分けている**(一覧表示で巨大なBlobを読まないため)。この分離は崩さないこと |
| `comments` | `id` | `by-trackId` | `{ id, trackId, time, text, author, createdAt }` |
| `settings` | `key` | - | v2で追加。`{ key: 'local', nickname }` のみ |

- ID採番はクライアント側 `nanoid(10)`、Worker側は `generateId()`(紛らわしい文字を除いた英数字。shareId=10桁 / editToken=32桁)。
- `syncStatus` は `'local'` または `'shared'`。
- **スキーマを変更するときは `DB_VERSION` を上げ、`upgrade()` に既存ユーザー向けの移行を書く。** 既存ストアを消す・keyPathを変える変更は既存端末のデータを壊すので避ける(バックアップ機能もエクスポートもない)。

### R2 のレコード(`shares/<shareId>/meta.json`)

```js
{ band, session, tracks: [...], comments: [...],
  shareId, editToken, audioKeys: { [trackId]: 'shares/.../audio/x.mp3' },
  createdAt, updatedAt }
```

## 音声処理の規約(ここが一番壊しやすい)

`src/audio/audioAnalysis.js` の解析・WAV書き出しロジックは、既存ツール `rehearsal-rec-splitter.html` (build: 2026-07-10) の実コードからの**移植**であり、挙動を元ツールと一致させることが前提になっている。数値やアルゴリズムを「改善」目的で勝手に変えないこと。

- `ANALYSIS_INTERVAL_SEC = 0.2` — RMS解析の時間刻み(固定値)。
- 無音判定のしきい値は **絶対dBFS基準**(`dbToRms()`)。ファイル内の最大振幅を基準にした相対値では**ない**。
- `computeRMS()` は全チャンネルをミックスダウンせず、全チャンネルのサンプルをまとめて二乗平均する(元ツールと同じ)。重い処理なので `onProgress` で進捗を返す。
- `detectSegments()` は「連結 → 最小演奏時間未満のplayをsilence化 → 再連結」の3段構成。返り値は `{ type: 'play'|'silence', start, end }`(秒)。
- デフォルト値 `DEFAULT_ANALYSIS_OPTIONS`: 無音判定時間60秒 / 閾値-30dB / 最小演奏時間3秒。UIのスライダー範囲(10-600 / -60〜-10 / 0-180)も元ツール準拠。
- `COMPRESSOR_PRESET`(-24dB / knee 30 / 3:1 / attack 20ms / release 250ms)はバンド練習音源向けの固定値。UIから変更させない設計。値を変えたい要望が来たらここを編集する。
- 波形描画 `drawWaveform(canvas, buffer, segments, viewRange, gain)` は canvas を都度 devicePixelRatio でリサイズする。`gain > 1` でクリップする部分は警告色(`#b0503f`)で描く。

### 音声フォーマットの使い分け

- **ローカル保存(IndexedDB)は非圧縮WAV。** `sliceAudioBufferToWavBlob()`(コンプOFF)/ `sliceAudioBufferToWavBlobWithCompressor()`(コンプON、`OfflineAudioContext` でレンダリング)。
- **共有(R2アップロード)時のみMP3に変換する。** `ShareModal` が保存済みWAVを `convertWavBlobToMp3Blob()` で128kbps MP3にしてからアップロードする。
- 音量調整(`gains`)とコンプのON/OFFは、**プレビュー再生・保存WAV・共有MP3のすべてに同じように反映される**。片方だけ変えると聴こえ方と保存内容がずれるので注意。

### SessionNew の状態管理

`src/pages/SessionNew.jsx` は最も複雑な画面(600行超)。区間データは段階的に導出される:

```
allSegments (自動判定 play+silence)
  → playSegmentsOnly()      … play だけ
  → splitPlaySegments()     … 手動分割点で更に分割 = finalSegs
  → trimOverrides を適用     … = effectiveSegs(保存対象)
```

- 曲ごとの設定(`titles` / `trimOverrides` / `gains` / `compressorOn`)は**曲IDではなく配列インデックスをキーにしている**。区間の切れ目が変わるとインデックスの意味が変わるため、再判定(`handleReanalyze`)や手動分割点の増減時にこれらを**まとめてリセットする**。この扱いを崩すと設定が別の曲に付いてしまう。
- 波形は `editMode` が `'preview'`(ズーム・タップ追従あり)と `'split'`(常に全体表示、タップで分割点を追加/削除)の2モード。ズームはプレビューモード専用。
- プレビュー再生は `<audio>` を `createMediaElementSource` でWeb Audioにつなぎ、GainNode/DynamicsCompressorNode を経由させている。コンプのバイパスは `ratio = 1` で表現している。

## コーディング規約

- **UI文言もコードコメントも日本語。** 新しいコメント・エラーメッセージ・画面テキストは日本語で書く。既存の口調(です・ます、簡潔な説明)に合わせる。
- プレーンJavaScript + JSX。**TypeScriptは使っていない**ので、`.ts` / `.tsx` を追加しない。
- 状態管理ライブラリなし。`useState` / `useEffect` とローカル関数で完結させる。Redux等を持ち込まない。
- スタイルは `src/styles.css` に集約。色は必ずCSS変数(`--color-ink`, `--color-accent` など)を使う。テープ/カセット風のレトロな配色(生成りの背景 + 琥珀色のアクセント)を守る。インラインstyleは既存コードでも細かい調整に使われているので、局所的な微調整に限れば許容。
- 依存の追加は慎重に。現状の依存は React / react-router-dom / idb / nanoid / @breezystack/lamejs のみ。
- ファイル間のimportは拡張子つき(`'./foo.jsx'`, `'../audio/audioAnalysis.js'`)で書かれている。この書き方に合わせる。

## デプロイ

CloudflareのGit連携で自動デプロイされる(Build: `npm run build` → Deploy: `npx wrangler deploy`)。手順の詳細と初回セットアップは `README.md` の「セットアップ手順」を参照。

- R2バケット名は `wrangler.toml` の `bucket_name`(現在 `band-practice-review`)と、Cloudflare上に作成したバケット名が**一致している必要がある**。
- `/api/share` などが404/500になる場合、まずバケット名の不一致とバインディング(`BUCKET`)を疑う。

## 既知の制約・未実装(触るときの前提)

- **共有後のローカル編集は自動で反映されない。** 共有済みセッションのタイトルや★をローカルで変更しても、R2側は更新されない。SessionDetail →「共有リンクを表示」→「更新をアップロード」で手動反映する。この操作は共有相手が追加した内容を上書きする可能性がある(マージ処理は実装されていない)。
- **表示名は端末ローカル。** IndexedDBの`settings`に保存するため、別端末では再入力が必要。
- **複数Band非対応。**
- 共有音声の削除機能はない(R2上のオブジェクトは残り続ける)。
- `.gitignore` が存在しない(READMEには同梱と書かれているが実際にはない)。`node_modules/` と `dist/` をコミットしないよう注意する。`.DS_Store` が誤ってコミットされている。
- 今後の候補としてREADMEに「簡易EQプリセット(BiquadFilterNodeのシェルビングで2〜3種類のプリセットボタン)」がメモされている。

## 変更時のチェックリスト

1. `npm run build` が通るか(唯一の自動検証手段)。
2. IndexedDBのスキーマを触ったなら `DB_VERSION` を上げ、既存データが壊れないか確認したか。
3. `worker/index.js` を触ったなら、`editToken` / `audioKeys` がレスポンスに漏れていないか。
4. 音声処理を触ったなら、プレビュー再生・保存WAV・共有MP3の3経路すべてに同じ効果が反映されるか。
5. `README.md` に書かれている仕様(スライダー範囲、コンプの固定値、共有の挙動など)を変えたなら、READMEも合わせて更新したか。

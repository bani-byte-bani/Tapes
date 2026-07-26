# CLAUDE.md

TAPES(バンド練習レビューサービス)のプロジェクトメモリ。詳細な機能一覧・セットアップ手順は `README.md` を参照。ここでは実装時にはまりやすい点・規約を中心にまとめる。

> **このドキュメントの読み方**
> 「現行実装」と明記した節は、コードの実態と一致していることを確認済み(最終確認: 2026-07-26)。
> 「今後の設計案」の節は**まだ実装されていない**構想であり、現行コードには存在しない。両者を混同しないこと。

## 概要

長時間のバンド練習録音を自動分割し、曲ごとにレビュー(★・コメント・トリム・音量・コンプ)できるWebアプリ。ログイン不要。**ローカルファースト(IndexedDB)+共有時のみクラウド(R2)** という設計が全体の前提。

- ユーザー識別も認証もしない。共有は「URLを知っている人だけがアクセスできる」方式(編集はURLクエリの `token` で判定)。
- **1ブラウザ = 1Band** に簡略化(`DEFAULT_BAND_ID = 'default-band'`)。複数Band対応は意図的に見送り。
- モバイル(Android Chrome)での利用を主に想定した縦1カラムUI(`.app-shell` は `max-width: 480px`)。

## 技術スタック

- フロントエンド: React + Vite (`src/`)。ビルド: `npm run build` → `dist/`
- バックエンド: Cloudflare Workers + 静的アセット配信(`worker/index.js` + `wrangler.toml` の `[assets]`)。**Cloudflare Pages Functions ではない**(2026年以降、Cloudflareのダッシュボードは新規プロジェクトをWorkers方式に倒す傾向があり、それに合わせた構成)
- ストレージ: IndexedDB(`src/db/indexedDB.js`、ローカル)、R2(共有時のみ、`worker/index.js` 経由)
- デプロイ: GitHub連携 → Cloudflare Workers Builds が `npm run build` → `npx wrangler deploy` を自動実行

## コマンド

```bash
npm install         # 依存インストール
npm run dev         # Vite開発サーバー(フロントのみ。/api/* は動かない)
npm run build       # dist/ へビルド
npm run preview     # ビルド結果のプレビュー(こちらも /api/* は動かない)
npx wrangler dev    # Worker + 静的アセットをまとめてローカル実行(/api/* を試すならこれ。要 npm run build)
npx wrangler deploy --dry-run  # デプロイ前の設定検証(バインディングが読めるか確認)
npx wrangler deploy # 本番デプロイ(通常はCloudflareのGit連携が自動実行する)
```

`--dry-run` が成功すると、以下のバインディングが認識される:

```
env.BUCKET (band-practice-review)      R2 Bucket
env.ASSETS                             Assets
```

**テストもリンターも設定されていない。** テストランナー・ESLint・Prettier・TypeScriptはいずれも未導入なので、「テストを流す」「lintする」といった検証手段は存在しない。変更の確認は `npm run build` が通ることと、実際にブラウザで動かすことで行う。テスト基盤を勝手に導入しない(必要だと思ったら提案するにとどめる)。

## アーキテクチャ(現行実装)

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

### ディレクトリ

| パス | 役割 |
| --- | --- |
| `src/main.jsx` | エントリ。`BrowserRouter` でAppをマウント |
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

**データアクセスは必ず `src/repository/` 経由で行う。** ページ/コンポーネントから直接 `getDB()` や `fetch('/api/...')` を呼ばないこと。

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

## 音声処理(現行実装)

`src/audio/audioAnalysis.js` の解析・WAV書き出しロジックは、既存ツール `rehearsal-rec-splitter.html` (build: 2026-07-10) の実コードからの**移植**であり、挙動を元ツールと一致させることが前提。数値やアルゴリズムを「改善」目的で勝手に変えないこと。

- `ANALYSIS_INTERVAL_SEC = 0.2` — RMS解析の時間刻み(固定値)。
- **無音判定は絶対dBFS基準。** グローバル最大振幅に対する相対値ではない。変換に使うのは `audioAnalysis.js` 内の**非公開関数 `dbToRms()`**(24行目)。エクスポートされている `dbToLinear()`(165行目)は**音量調整用の別関数**で、式は同一だが用途が違う。取り違えないこと。
- `computeRMS()` は全チャンネルをミックスダウンせず、全チャンネルのサンプルをまとめて二乗平均する(元ツールと同じ)。重い処理なので `onProgress` で進捗を返す。
- `detectSegments()` は「連結 → 最小演奏時間未満のplayをsilence化 → 再連結」の3段構成。返り値は `{ type: 'play'|'silence', start, end }`(秒)。
- デフォルト値 `DEFAULT_ANALYSIS_OPTIONS`: 無音判定時間60秒 / 閾値-30dB / 最小演奏時間3秒。UIのスライダー範囲(10-600 / -60〜-10 / 0-180)も元ツール準拠。
- 波形描画 `drawWaveform(canvas, buffer, segments, viewRange, gain)` は canvas を都度 devicePixelRatio でリサイズする。`gain > 1` でクリップする部分は警告色(`#b0503f`)で描く。

### 現行の処理チェーン

**現時点のエフェクトは `COMPRESSOR_PRESET` 固定値のコンプレッサー ON/OFF のみ。** Limiter も Makeup Gain もプリセット選択UIも存在しない。実際のチェーンは両経路とも3段:

```
Source → DynamicsCompressor → Gain → Destination
```

- プレビュー(リアルタイム、`AudioContext`): `SessionNew.jsx:108`
- 保存WAV(`OfflineAudioContext`): `audioAnalysis.js:266`
- コンプのバイパスは `ratio = 1` で表現する(ノードを外すのではなく)。
- `COMPRESSOR_PRESET`(-24dB / knee 30 / 3:1 / attack 20ms / release 250ms)はバンド練習音源向けの固定値。UIから変更させない設計。値を変えたい要望が来たらここを編集する。
- **チェーンの構築コードは2箇所に重複している**(プレビュー側と保存側)。共有しているのは `COMPRESSOR_PRESET` 定数だけなので、**片方だけ変更するとプレビューと保存結果がズレる**。必ず両方を直すこと。

### 音声フォーマットの使い分け

- **ローカル保存(IndexedDB)は非圧縮WAV。** `sliceAudioBufferToWavBlob()`(コンプOFF)/ `sliceAudioBufferToWavBlobWithCompressor()`(コンプON、`OfflineAudioContext` でレンダリング)。
- **共有(R2アップロード)時のみMP3に変換する。** `ShareModal` が保存済みWAVを `convertWavBlobToMp3Blob()` で128kbps MP3にしてからアップロードする。
- 音量調整(`gains`)とコンプのON/OFFは、**プレビュー再生・保存WAV・共有MP3のすべてに同じように反映される**。片方だけ変えると聴こえ方と保存内容がずれる。

## はまりやすい点

- **lamejs**: npm版 `lamejs`(1.2.1)はViteなどのESMバンドラーで `MPEGMode is not defined` エラーになる既知の不具合がある。必ず `@breezystack/lamejs` を使うこと(`src/audio/mp3Encoder.js`)。
- **無音判定の閾値は絶対dBFS**(上記「音声処理」参照)。相対値に変えない。
- **プレビューと保存でパラメータをズラさない**。現状はチェーン構築が2箇所に重複しているため、変更時は両方を手で合わせる必要がある。
- **共有後はR2が正本**: ローカルIndexedDBの変更は自動同期されない(Session詳細の「更新をアップロード」で手動反映)。この操作は共有相手が追加した内容を上書きする可能性がある(マージ処理は未実装)。
- **`SessionNew.jsx` のindexキー状態**(下記「規約」参照)。区間構成が変わるとindexの意味が変わる。

## 規約

- 曲単位の調整(曲名・トリム・音量・コンプ)はすべて `SessionNew.jsx` 内で**配列インデックスをキーにした状態**として持つ。区間構成が変わる操作(再判定 `handleReanalyze`・手動分割点の追加/削除)をしたら、`titles` / `trimOverrides` / `gains` / `compressorOn` を**4つまとめて**リセットする。1つでも残すと、その設定が別の曲に付いてしまう。
  - 新しくindexキーの状態を追加したら、上記2箇所のリセットにも必ず追加すること。
- 区間データは段階的に導出される:

  ```
  allSegments (自動判定 play+silence)
    → playSegmentsOnly()      … play だけ
    → splitPlaySegments()     … 手動分割点で更に分割 = finalSegs
    → trimOverrides を適用     … = effectiveSegs(保存対象)
  ```

- 波形は `editMode` が `'preview'`(ズーム・タップ追従あり)と `'split'`(常に全体表示、タップで分割点を追加/削除)の2モード。ズームはプレビューモード専用。
- データ取得はリポジトリパターンで抽象化(`localRepository.js` vs `remoteRepository.js`)。
  - ただし**現状は画面単位で分離しているだけ**で、1つのコンポーネントが両対応しているわけではない(`SessionDetail` / `TrackPlayer` はローカル専用、`ShareViewer` は共有専用)。例外として `NicknameField` は共有画面から使われるが `localRepository` を直接importしている(表示名は端末ローカルのため)。
- **UI文言もコードコメントも日本語。** 既存の口調(です・ます、簡潔な説明)に合わせる。
- プレーンJavaScript + JSX。**TypeScriptは使っていない**ので `.ts` / `.tsx` を追加しない。
- 状態管理ライブラリなし。`useState` / `useEffect` とローカル関数で完結させる。
- スタイルは `src/styles.css` に集約。色は必ずCSS変数(`--color-ink`, `--color-accent` など)を使う。テープ/カセット風のレトロな配色(生成りの背景 + 琥珀色のアクセント)を守る。インラインstyleは局所的な微調整に限れば許容。
- 依存の追加は慎重に。現状は React / react-router-dom / idb / nanoid / @breezystack/lamejs のみ。
- ファイル間のimportは拡張子つき(`'./foo.jsx'`, `'../audio/audioAnalysis.js'`)で書く。

## 今後の設計案(未実装)

> **以下はすべて構想であり、現行コードには存在しない。** 実装済みと誤解しないこと。
> 着手時はこの節の内容を「現行実装」の節へ移動し、この節から削除する。

### Audio Enhancement(プリセット方式のエフェクトチェーン)

現状の「コンプON/OFF」を、複数プリセットから選ぶ方式へ拡張する構想。実装する場合は以下の設計判断に従う:

- **想定チェーン**: `Source → Compressor → Makeup Gain → 手動音量調整 → Limiter → Destination`
- **Limiterは処理チェーンの最終段に置く。** 手動音量調整をLimiterより前に置かないと、ユーザーが音量を上げた分がクリッピング防止の対象から漏れる。
- **プレビューと書き出しで単一のソースを共有する。** プレビュー(`AudioContext`)と保存(`OfflineAudioContext`)でパラメータがズレないよう、`ENHANCEMENT_PRESETS`(`src/audio/audioAnalysis.js` に新設)を唯一の定義元とする。現行の `COMPRESSOR_PRESET` はこれに統合する想定。あわせて、現在2箇所に重複しているチェーン構築コードも共通化したい。
- **プリセット切り替え時は `setTargetAtTime` で滑らかに変化させる。** 直接 `.value =` で切り替えるとプチノイズが出る。現行コードは全箇所で直接代入しているため、この規約は移行時に導入することになる。
- 曲単位の状態キー(現 `compressorOn`)は `enhancement` にリネームする想定。indexキーのリセット規約は現行と同じ。

### 簡易EQプリセット

細かいパラメトリックEQではなく、「ハイを少し持ち上げる」「ローを少し持ち上げる」程度の2〜3種類のプリセットボタン。`BiquadFilterNode`(シェルビング)で実現可能。**Audio Enhancement のチェーン再設計と同時に着手するのが望ましい**(EQ単体を現行の3段チェーンに足すと、後でチェーンを組み直す際に二度手間になる)。

### 共有後のローカル編集の自動反映

現状は手動アップロードのみ。自動化する場合、`applyPatch` はホワイトリスト方式の上書きでマージ処理を持たないため、**共有相手の編集を消す競合が起きる**。着手前に競合解決の方針(最終更新優先 / フィールド単位マージ 等)を決める必要がある。

## 名前について(意図的に統一していない)

ドキュメント上のプロジェクト名は「TAPES」だが、**デプロイ上の識別子は `band-practice-review` のままにしてある**(`wrangler.toml` の `name`、`package.json` の `name`)。これは未対応の不整合ではなく、**意図的に触っていない**。

`wrangler.toml` の `name` は workers.dev のサブドメインを決めるため、変更すると配信URLが変わり、**すでに発行済みの共有リンク(`https://<name>.workers.dev/r/<shareId>`)が全て404になる**。共有URLは `worker/index.js` がリクエストのoriginから組み立てており(`140行目`)、旧URLへのリダイレクトも用意していない。

- リネームする場合は、先にカスタムドメインを当ててURLを固定するか、共有リンクが失効してよいことを確認すること。
- `update_worker_name_to_tapes` ブランチがこのリネームだけを含んだまま残っている。**上記を理解せずマージしない。**

## 既知の制約

- **表示名は端末ローカル** — IndexedDBの `settings` に保存するため、別端末では再入力が必要。
- **複数Band非対応。**
- **共有音声の削除機能はない**(R2上のオブジェクトは残り続ける)。
- **Android実機(Chrome)での動作確認が未実施。**
- **依存の脆弱性が4件残っている**(moderate 3 / high 1)。いずれも解消にメジャーアップグレードが必要なため未対応:
  - `esbuild` / `vite` — 解消には Vite 8 への破壊的アップグレードが必要。advisoryの影響範囲は**開発サーバー(`npm run dev`)のみ**で、ビルド成果物には及ばない。
  - `react-router` — 解消には react-router-dom 7 系へのメジャー移行が必要(現在 `^6.26.2`)。`<Link>` / `useNavigate` のバックスラッシュによるオープンリダイレクトで、**本番にも影響しうる**。移行の是非は要判断。
  - 破壊的変更なしで直せる分(`sharp` / `miniflare` 経由の high 3件)は `npm audit fix` 適用済み。

## 変更時のチェックリスト

1. `npm run build` が通るか(唯一の自動検証手段)。
2. `wrangler.toml` を触ったなら `npx wrangler deploy --dry-run` でバインディングが読めるか。
3. IndexedDBのスキーマを触ったなら `DB_VERSION` を上げ、既存データが壊れないか確認したか。
4. `worker/index.js` を触ったなら、`editToken` / `audioKeys` がレスポンスに漏れていないか。
5. 音声処理を触ったなら、**プレビュー再生・保存WAV・共有MP3の3経路すべて**に同じ効果が反映されるか(チェーン構築は2箇所に重複している)。
6. `README.md` に書かれている仕様(スライダー範囲、コンプの固定値、共有の挙動など)を変えたなら、READMEも合わせて更新したか。
7. 「今後の設計案」の機能を実装したなら、該当節を「現行実装」へ移したか。

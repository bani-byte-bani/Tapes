# CLAUDE.md

TAPES(バンド練習レビューサービス)のプロジェクトメモリ。詳細な機能一覧・セットアップ手順は `README.md` を参照。ここでは実装時にはまりやすい点・規約を中心にまとめる。

> **このドキュメントの読み方**
> 「現行実装」と明記した節は、コードの実態と一致していることを確認済み(最終確認: 2026-07-26)。
> 「今後の設計案」の節は**まだ実装されていない**構想であり、現行コードには存在しない。両者を混同しないこと。

## 概要

長時間のバンド練習録音を自動分割し、曲ごとにレビュー(★・コメント・トリム・音量・音質補正・EQ)できるWebアプリ。ログイン不要。**ローカルファースト(IndexedDB)+共有時のみクラウド(R2)** という設計が全体の前提。

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
| `src/repository/shareSync.js` | 共有済みSessionへの自動反映(後勝ちの差分更新) |
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

### 現行の処理チェーン(Audio Enhancement)

曲ごとに **音質補正(ダイナミクス)** と **EQ** をプリセットから選べる。チェーンは6段:

```
Source → EQ → Compressor → Makeup Gain → 手動音量調整 → Limiter → SoftClip → Destination
```

- 定義元は `audioAnalysis.js` の `ENHANCEMENT_PRESETS` / `EQ_PRESETS` **だけ**。値を変えたいときはここを直せばプレビュー・保存WAV・共有MP3の全部に反映される。
- **チェーンの組み立ても `createEnhancementChain()` に集約済み。** プレビュー(`AudioContext`)と書き出し(`OfflineAudioContext`)が同じ関数を呼ぶので、以前のような「2箇所に重複していて片方だけ直すとズレる」問題はない。**この集約を崩さないこと。**
- **Limiterは必ず手動音量調整より後に置く。** 前に置くと、ユーザーが上げた分がクリッピング防止の対象から漏れる。
- **SoftClip(WaveShaper)が最終段にいる理由:** `DynamicsCompressorNode` は平均レベルを抑える仕組みで、波形のピーク(クレストファクター)はそのまま通過する。Limiterだけでは 0dBFS 超えを防げないため、`SOFT_CLIP_KNEE`(0.75)以上をなだらかに 1.0 へ漸近させる曲線で頭を押さえている。実測でピークは最大 0.94 に収まる。
- バイパスはノードを外さず、無変化になる値を入れて素通しさせる(コンプは `ratio = 1`、EQは `peaking` の `gain = 0`、SoftClipは線形カーブ)。
- **プリセット切替は `setTargetAtTime` で滑らかに変化させる**(`applyEnhancement(..., { smooth: true, ctx })`)。直接 `.value =` で切り替えるとプチノイズが出る。書き出し時はチェーンを作った直後なので `smooth: false`(直接代入)でよい。
- 補正が `off` のときは従来どおりの挙動。音量を上げれば波形どおりクリップし、波形の警告色(赤)も意味を保つ。UIのクリップ警告も `off` のときだけ出す。
- 保存時、補正が何も掛かっていない曲は `isEnhancementActive()` が false になり、`OfflineAudioContext` を経由しない軽い経路(`sliceAudioBufferToWavBlob`)で書き出す。

### 音声フォーマットの使い分け

- **ローカル保存(IndexedDB)は非圧縮WAV。** `sliceAudioBufferToWavBlob()`(補正なし)/ `sliceAudioBufferToWavBlobWithEnhancement()`(補正あり、`OfflineAudioContext` でレンダリング)。
- **共有(R2アップロード)時のみMP3に変換する。** `ShareModal` が保存済みWAVを `convertWavBlobToMp3Blob()` で128kbps MP3にしてからアップロードする。
- 音量調整(`gains`)・音質補正(`enhancement`)・EQ(`eq`)は、**プレビュー再生・保存WAV・共有MP3のすべてに同じように反映される**。

## はまりやすい点

- **lamejs**: npm版 `lamejs`(1.2.1)はViteなどのESMバンドラーで `MPEGMode is not defined` エラーになる既知の不具合がある。必ず `@breezystack/lamejs` を使うこと(`src/audio/mp3Encoder.js`)。
- **無音判定の閾値は絶対dBFS**(上記「音声処理」参照)。相対値に変えない。
- **プレビューと保存でパラメータをズラさない**。`createEnhancementChain()` / `ENHANCEMENT_PRESETS` を唯一の定義元として使い続けること。ここを迂回して個別にノードを組むと、以前の「プレビューと保存結果がズレる」状態に戻る。
- **共有後の同期は「後勝ち」の差分更新**: 共有済みSessionでタイトル・★・コメント・メモを編集すると、`shareSync.js` 経由で自動的にR2へ反映される(後から書いた方が残る)。触っていない項目は送らないので、共有相手の編集は消えない。ただし ShareModal の「音声ごと再アップロード」は**音声を含めて丸ごと差し替える**ため、共有相手の追加分が消えることがある。
- **`SessionNew.jsx` のindexキー状態**(下記「規約」参照)。区間構成が変わるとindexの意味が変わる。

## 規約

- 曲単位の調整(曲名・トリム・音量・音質補正・EQ)はすべて `SessionNew.jsx` 内で**配列インデックスをキーにした状態**として持つ。区間構成が変わる操作(再判定 `handleReanalyze`・手動分割点の追加/削除)をしたら、`titles` / `trimOverrides` / `gains` / `enhancement` / `eq` を**5つまとめて**リセットする。1つでも残すと、その設定が別の曲に付いてしまう。
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
  - **react-router-dom は 7系**(`^7.18.1`)。使っているのは `BrowserRouter` / `Routes` / `Route` / `Link` / `useNavigate` / `useParams` / `useSearchParams` の7つだけで、データルーター系(`loader` / `action` / `errorElement`)は未使用。この範囲に留める限りv6/v7で書き方は変わらない。
- ファイル間のimportは拡張子つき(`'./foo.jsx'`, `'../audio/audioAnalysis.js'`)で書く。

## 今後の設計案(未実装)

> **以下はすべて構想であり、現行コードには存在しない。** 実装済みと誤解しないこと。
> 着手時はこの節の内容を「現行実装」の節へ移動し、この節から削除する。

### 検証手段の整備(提案段階)

テストランナーは未導入のまま。Playwrightによるスモークテスト(ルーティング / 共有の後勝ち同期 / 音質補正の実測)は作成済みだがリポジトリには入れていない。導入する場合 `playwright-core` が devDependency に1つ増える。**勝手に入れないこと**(この判断は保留中)。

### 複数Band対応・表示名の端末間共有

いずれも「ログイン不要」という前提と引き換えになる。着手するなら前提から見直す話になる。

## 名前について(意図的に統一していない)

ドキュメント上のプロジェクト名は「TAPES」だが、**デプロイ上の識別子は `band-practice-review` のままにしてある**(`wrangler.toml` の `name`、`package.json` の `name`)。これは未対応の不整合ではなく、**意図的に触っていない**。

`wrangler.toml` の `name` は workers.dev のサブドメインを決めるため、変更すると配信URLが変わり、**すでに発行済みの共有リンク(`https://<name>.workers.dev/r/<shareId>`)が全て404になる**。共有URLは `worker/index.js` がリクエストのoriginから組み立てており(`140行目`)、旧URLへのリダイレクトも用意していない。

- リネームする場合は、先にカスタムドメインを当ててURLを固定するか、共有リンクが失効してよいことを確認すること。
- `update_worker_name_to_tapes` ブランチがこのリネームだけを含んだまま残っている。**上記を理解せずマージしない。**

## 既知の制約

- **表示名は端末ローカル** — IndexedDBの `settings` に保存するため、別端末では再入力が必要。
- **複数Band非対応。**
- **共有音声の削除機能はない**(R2上のオブジェクトは残り続ける)。
- **共有の自動反映は差分更新のみ。** 音声そのものを差し替えるには ShareModal の「音声ごと再アップロード」が必要で、そちらは共有相手の追加分を消す可能性がある。
- **依存の脆弱性が `npm audit` に残っている**。現時点でいずれも本番影響なしと判断しているが、内容を理解せず「0件にする」ためだけに `--force` を当てないこと:
  - `esbuild` / `vite` — 解消には Vite 8 への破壊的アップグレードが必要。advisoryの影響範囲は**開発サーバー(`npm run dev`)のみ**で、ビルド成果物には及ばない。
  - `react-router` (high) — 「RSC Mode CSRF Bypass」。影響範囲は `>=7.12.0 <8.3.0` で 7.18.1 も含まれるが、**内容がRSC(React Server Components)モード専用**であり、本アプリはサーバーを持たないクライアント専用SPA(`BrowserRouter` + 静的配信、loader/actionも未使用)なので該当しない。解消するには `react-router` 8.3.0 が必要だが、`react-router-dom` は 7.18.1 が最新で 8.x が存在しないため、移行するなら import 元を `react-router` に切り替えることになる。
  - 解消済み: `sharp` / `miniflare` 経由の high 3件(`npm audit fix`)、react-router のオープンリダイレクト(v7移行で解消)。

## 変更時のチェックリスト

1. `npm run build` が通るか(唯一の自動検証手段)。
2. `wrangler.toml` を触ったなら `npx wrangler deploy --dry-run` でバインディングが読めるか。
3. IndexedDBのスキーマを触ったなら `DB_VERSION` を上げ、既存データが壊れないか確認したか。
4. `worker/index.js` を触ったなら、`editToken` / `audioKeys` がレスポンスに漏れていないか。
5. 音声処理を触ったなら、`ENHANCEMENT_PRESETS` と `createEnhancementChain()` だけを直したか(プレビュー・保存WAV・共有MP3の3経路が自動的に揃う)。
6. `README.md` に書かれている仕様(スライダー範囲、コンプの固定値、共有の挙動など)を変えたなら、READMEも合わせて更新したか。
7. 「今後の設計案」の機能を実装したなら、該当節を「現行実装」へ移したか。

# amazon_receipt_downloader

amazon.co.jp の注文を会社 / 個人に仕分け、会社の分の書類 (適格請求書など) の PDF を 1 つのフォルダにまとめる。
期は 11 月始まりの決算期で、終わりの年で指定する (`2026` → 2025-11-01〜2026-10-31)。

## 必要なもの

- macOS、Google Chrome、Node.js 22 以上
- `pdftotext` (`brew install poppler`)。`status` が PDF の中身を読むのに使う

```sh
npm install
```

## 使い方

```sh
node receipts.mjs login              # 専用の Chrome を起動し、ログイン済みかを確かめる。未ログインなら開いた窓でログインしてやり直す
node receipts.mjs orders 2026        # 2025 年と 2026 年の注文一覧を取得する
node receipts.mjs sort 2026          # 仕分け画面 http://127.0.0.1:8787/ を開く (Ctrl-C で止める)
node receipts.mjs fetch 2026         # 会社の注文の書類 PDF を取得する
node receipts.mjs status 2026        # 会社の注文の書類の状況を表示する
node receipts.mjs export 2026                      # out/2025-11-01_2026-10-31/ に PDF を置く (出力先は out/ に固定)
```

- 仕分け画面は `http://127.0.0.1:8787/` で開く (`localhost` では開けない)。キー: `h` / `c` 会社、`l` / `p` 個人、`u` 未分類に戻す、`j` / `k` 次 / 前。合計 ￥0 の注文 (ポイントやギフト券で全額払ったもの、無料アプリなど) は一覧のいちばん下にまとめて出る
- `fetch` は、未分類の注文が 1 件でもあると始まらない。期の終わりより前に取った注文一覧のままでも始まらない (`orders` を取り直す)。取得済みの注文は飛ばすので、途中で止まっても同じコマンドで続きから取れる。後から書類が増えた注文は `--refetch <注文番号>` で取り直す
- `fetch` の間は、専用の Chrome の窓とツールが開いたタブを閉じず、そのブラウザで別のダウンロードをしない
- `export` は毎回フォルダを作り直す。フォルダにこのツールが置いていないファイルがあると、消さずに止まる。「返金明細書」のリンクの PDF は `refund/` に置く。返金済みの商品の明細書は本体側の PDF に残るので、`refund/` を見て手で対処する
- 「領収書等」に PDF のリンクが無い注文は、「印刷可能な注文概要」を印刷して `<注文日>_<注文番号>_summary.pdf` として置く

## 置き場所

- 専用の Chrome プロファイル: `~/Library/Application Support/amazon-receipts/chrome-profile/` (ログイン状態が入る。不要になったらこのフォルダを消す)
- 取得したデータ: `./data/` (購入品・氏名・住所が入る。`.gitignore` 済み)

## Amazon に弾かれたとき

短い時間に多く取得すると、Amazon は PDF の代わりにエラーページを返すようになる。`fetch` はそれを見つけると止まり、`data/blocked.json` に時刻を残して、3 時間は取得を始めない (`--force` で無視できる)。経緯は `docs/design.md`。

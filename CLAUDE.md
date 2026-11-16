# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

amazon.co.jp の注文履歴から、指定した年の領収書を puppeteer で 1 件ずつ開き、PDF として保存する Node スクリプト。実装は `index.js` 1 本だけ。ビルド・lint・テストは無い (`npm test` は未定義のエラーを返すだけ)。

## コマンド

```sh
npm install                 # puppeteer が Chromium も取得する
node index.js 2021          # 2021 年の領収書をすべて PDF にする (年を省略すると 2020)
node index.js -f 2021       # PDF 作成中のブラウザを表示する (-f は必ず第 1 引数)
node index.js 2021 21 45    # 指定した番号の領収書だけ作り直す
```

## 処理の流れ

1. `./cookie.txt` が無ければ、headless でないブラウザを開いて手動ログインを待つ。注文履歴ページ (`#yourOrders`) に着いたら cookie を JSON で `cookie.txt` に書き、終了する。利用者はもう一度実行する。普通のブラウザで開くのは bot 検知を避けるため (README)
2. `cookie.txt` があれば、それを読み込んで注文履歴ページを開く
3. `&startIndex=` を 10 ずつ増やしてページを送り、`span.hide-if-js a` の href を領収書の URL として集める。1 ページの件数が 10 未満になったら止める (1 ページ 10 件が前提)
4. 集めた URL を順に開き、`page.pdf` で `invoice-<年>-<4 桁番号>.pdf` をカレントディレクトリに書く

## 番号が 2 種類ある

作り直し用の引数とファイル名の番号は別物で、取り違えやすい。

- **引数で渡す番号 (`current_index`)**: 収集した URL の並び (注文履歴の表示順、新しい順) での 0 始まりの位置
- **ファイル名の番号 (`filename_index`)**: `URL の総数 - current_index`。古い注文ほど小さい番号になるよう逆順にしてある (コミット `c1a10aa`)

エラー時のログは両方を出す (`current_index = ..., pad_filename_index = ...`)。作り直すときに渡すのは `current_index` のほう。

## 注意

- `cookie.txt` は認証情報そのもの。`.gitignore` 済みで、commit しない
- 途中でログイン画面へ飛ばされることがある。`-f` 付きなら 20 秒待つので、その間にパスワードを入れる。README はログイン時に「ログインしたままにする」にチェックを入れるよう案内している
- `page.waitForTimeout` を使っている。puppeteer を上げるときは、このメソッドが残っているかを確かめる (新しい版では削除されている)
- URL・セレクタ (`#yourOrders`, `span.hide-if-js a`)・ログイン画面の判定 (`/ap/signin`, `/ap/mfa`) は amazon.co.jp の画面構成に依存している。動かなくなったら、まずここを疑う

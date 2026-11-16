# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

amazon.co.jp の注文を会社 / 個人に仕分け、会社の分の書類 PDF を税理士用のフォルダにまとめる個人用ツール。`node receipts.mjs <コマンド>` で実行し、処理は `src/` にある。使い方は `README.md`、設計の経緯と実データで確かめた Amazon の挙動は `docs/design.md`。ビルド・lint・テストは無い。

**矢野氏に「今期の領収書」などの実行を頼まれたら、スキル `amazon-receipts` (`.claude/skills/amazon-receipts/SKILL.md`) の手順で進める。** 専用 Chrome の起動、仕分け画面のサーバーの起動と停止、終了コードごとの対処が書いてある。

## 構成

- `src/chrome.mjs`: 専用プロファイルの Google Chrome を `open -na` で起動し、`playwright-core` の `connectOverCDP` で接続する。Playwright から Chrome を起動しない (自動操作の痕跡が付いたブラウザでログインすると bot 検知に掛かった)
- `src/orders.mjs`: 注文一覧の取得 (暦年ごと) と、保存した HTML からの取り出し (`cheerio`)
- `src/sort-server.mjs` + `src/sorter.html`: 仕分け画面
- `src/fetch-docs.mjs`: 会社の注文の「領収書等」を開き、PDF のリンクをクリックしてダウンロードする
- `src/statements.mjs`: `pdftotext` で PDF を全ページ読み、明細書ごとに適格請求書かを判定する
- `src/status.mjs` / `src/export.mjs`: 状況の表示と、税理士用フォルダ (`out/<期間>/`、`.gitignore` 済み) の作成
- データは `data/` (`.gitignore` 済み)。注文単位で `data/docs/<注文番号>/` に書類と `meta.json` を置く。期 (11 月始まり) は注文日で絞る

## 注意

- 利用者の Amazon アカウントの実データを扱う。試験やデバッグで、矢野氏が許していない年の注文に触れない (2026-11 の開発中は「今年のデータにはアクセスしないで」と指示された)。本番の実行で触れてよい年は、スキルの「守ること」の期の確認で決まる。`data/` の下のファイルは開かない。年の絞り込みは URL ではなく、表示された注文の日付をページの中で数えて確かめる (旧 URL では絞り込みが無視され、最新の注文が出た)
- PDF は Node.js 側の通信 (`context.request`) やページ内の `fetch` で取らない。数十個で Amazon にエラーページへ切り替えられる。リンクのクリック (Chrome の設定「PDF をダウンロードする」+ `Browser.setDownloadBehavior`) なら通った
- PDF のリンク先の ID は「領収書等」を開くたびに変わる。保存した HTML の URL は使い回せない
- 1 つの PDF に明細書が何枚も入る。表題だけで判定せず、登録番号 (`T` + 13 桁) と「適格請求書ではありません」の文も見る
- `sample/` は設計を決めるときのサンプル実装で、本番では使わない

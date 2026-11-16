#!/usr/bin/env node
// Amazon (amazon.co.jp) の注文を会社 / 個人に仕分け、会社の分の書類 PDF を税理士用のフォルダにまとめる。
// 期は終わりの年で指定する (2026 → 2025-11-01〜2026-10-31)。詳しくは README.md。
import { login } from './src/chrome.mjs';
import { exportDocs } from './src/export.mjs';
import { fetchDocs } from './src/fetch-docs.mjs';
import { fetchLists, parseLists } from './src/orders.mjs';
import { period } from './src/period.mjs';
import { serveSorter } from './src/sort-server.mjs';
import { showStatus } from './src/status.mjs';
import { Fatal } from './src/util.mjs';

const USAGE = `使い方: node receipts.mjs <コマンド> [引数]
  login                      専用の Chrome を起動し、amazon.co.jp にログイン済みかを確かめる
  orders <期>                期にかかる 2 年分の注文一覧を取得する
  sort <期>                  仕分け画面 (http://127.0.0.1:8787/) を開く
  fetch <期> [--force] [--refetch <注文番号>...]
                             会社の注文の書類 PDF を取得する
  status <期>                会社の注文の書類の状況を表示する
  export <期>                out/<期間>/ に書類 PDF を置く
期は終わりの年で書く (2026 → 2025-11-01〜2026-10-31)`;

async function main(argv) {
  const [cmd, arg, ...rest] = argv;
  switch (cmd) {
    case 'login':
      return login();
    case 'orders':
      return fetchLists(period(arg)).then(() => undefined);
    case 'parse': // 保存済みの一覧から取り出し直す (Amazon にアクセスしない)
      return void parseLists(period(arg).years);
    case 'sort':
      return serveSorter(period(arg));
    case 'fetch': {
      const i = rest.indexOf('--refetch');
      return fetchDocs(period(arg), { force: rest.includes('--force'), refetch: i >= 0 ? rest.slice(i + 1).filter((a) => !a.startsWith('--')) : [] });
    }
    case 'status':
      if (showStatus(period(arg)) > 0) process.exitCode = 1;
      return;
    case 'export':
      return exportDocs(period(arg));
    default:
      console.log(USAGE);
      if (cmd) process.exitCode = 2;
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Fatal ? `エラー: ${e.message}` : e);
  process.exitCode = e instanceof Fatal ? e.code : 1;
});

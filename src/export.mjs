// 税理士用のフォルダを作る。毎回作り直すので、会社から個人に直した注文の PDF は残らない。
//   <出力先>/<期間>/<注文日>_<注文番号>_<番号>.pdf
//   <出力先>/<期間>/refund/…  (リンクの文字が「返金明細書」で始まる PDF。決めたこと F / J)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { docDir, readMeta } from './fetch-docs.mjs';
import { assertListsComplete } from './orders.mjs';
import { maybeUndelivered } from './status.mjs';
import { companyOrders, unclassified } from './store.mjs';
import { Fatal, log } from './util.mjs';

const MARK = '.amazon-receipts-export';
// このツールが置くファイルの名前。これ以外のファイルがあるフォルダは作り直さない (利用者が足したファイルを消さないため)。
const OURS = /^(\d{4}-\d{2}-\d{2}_[\w-]+_(\d+|summary)\.pdf|refund|\.amazon-receipts-export|\.DS_Store)$/;

function assertOnlyOurFiles(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!OURS.test(name)) throw new Fatal(`${full} はこのツールが置いたファイルではない。消さないよう、作り直しを止める`, 2);
    if (name === 'refund') assertOnlyOurFiles(full);
  }
}

export function exportDocs(p, destRoot) {
  if (!destRoot) throw new Fatal('出力先を指定してください (例: node receipts.mjs export 2026 ~/Desktop/receipts)', 2);
  if (unclassified(p).length) throw new Fatal(`仕分けていない注文が ${unclassified(p).length} 件ある`, 2);
  assertListsComplete(p);
  const orders = companyOrders(p);
  const missing = orders.filter((o) => !readMeta(o.orderId));
  if (missing.length) throw new Fatal(`書類を取得していない会社の注文が ${missing.length} 件ある。先に fetch を実行してください`, 2);

  // 引用符で囲まれて渡された ~ も展開する。
  const root = destRoot.startsWith('~/') ? path.join(os.homedir(), destRoot.slice(2)) : destRoot;
  const dest = path.resolve(root, p.label);
  if (fs.existsSync(dest)) {
    // このツールが作ったフォルダだけを作り直す。別の物を消さないため。
    if (!fs.existsSync(path.join(dest, MARK))) throw new Fatal(`${dest} はこのツールが作ったフォルダではないので、消さずに止める`, 2);
    assertOnlyOurFiles(dest);
  }

  // 一時フォルダにすべてコピーしてから入れ替える。コピーの途中で失敗しても、前回のフォルダが残るように。
  const work = `${dest}.partial`;
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, 'refund'), { recursive: true });
  let main = 0;
  let refund = 0;
  try {
    for (const o of orders) {
      const meta = readMeta(o.orderId);
      for (const f of meta.files) {
        const toRefund = f.label.startsWith('返金明細書');
        fs.copyFileSync(path.join(docDir(o.orderId), f.file), path.join(work, toRefund ? 'refund' : '', f.file));
        toRefund ? refund++ : main++;
      }
      if (meta.summary) {
        fs.copyFileSync(path.join(docDir(o.orderId), meta.summary), path.join(work, meta.summary));
        main++;
      }
    }
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true });
    throw new Fatal(`コピーに失敗した。出力先は前のままにしてある (${e.message})`);
  }
  if (!refund) fs.rmdirSync(path.join(work, 'refund'));
  fs.writeFileSync(path.join(work, MARK), `${new Date().toISOString()}\n`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(work, dest);
  log(`${dest} に ${main} 個、refund/ に ${refund} 個を置いた (会社の注文 ${orders.length} 件)`);

  const undelivered = orders.filter((o) => maybeUndelivered(o, readMeta(o.orderId)));
  const summary = orders.filter((o) => readMeta(o.orderId).summary);
  if (undelivered.length) log(`注意: 配達が済んでいないかもしれない注文 ${undelivered.length} 件 (後から書類が増えうる): ${undelivered.map((o) => o.orderId).join(', ')}`);
  if (summary.length) log(`注意: 注文概要を印刷して置いた注文 ${summary.length} 件: ${summary.map((o) => o.orderId).join(', ')}`);
}

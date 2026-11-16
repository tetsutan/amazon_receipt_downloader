// 税理士用のフォルダを作る。毎回作り直すので、会社から個人に直した注文の PDF は残らない。
//   <出力先>/<期間>/<注文日>_<注文番号>_<番号>.pdf
//   <出力先>/<期間>/refund/…  (リンクの文字が「返金明細書」で始まる PDF。決めたこと F / J)
import fs from 'node:fs';
import path from 'node:path';
import { docDir, readMeta } from './fetch-docs.mjs';
import { companyOrders, unclassified } from './store.mjs';
import { Fatal, log } from './util.mjs';

const MARK = '.amazon-receipts-export';

export function exportDocs(p, destRoot) {
  if (!destRoot) throw new Fatal('出力先を指定してください (例: node receipts.mjs export 2026 ~/Desktop/receipts)', 2);
  if (unclassified(p).length) throw new Fatal(`仕分けていない注文が ${unclassified(p).length} 件ある`, 2);
  const orders = companyOrders(p);
  const missing = orders.filter((o) => !readMeta(o.orderId));
  if (missing.length) throw new Fatal(`書類を取得していない会社の注文が ${missing.length} 件ある。先に fetch を実行してください`, 2);

  const dest = path.resolve(destRoot, p.label);
  if (fs.existsSync(dest)) {
    // このツールが作ったフォルダだけを作り直す。別の物を消さないため。
    if (!fs.existsSync(path.join(dest, MARK))) throw new Fatal(`${dest} はこのツールが作ったフォルダではないので、消さずに止める`, 2);
    fs.rmSync(dest, { recursive: true });
  }
  fs.mkdirSync(path.join(dest, 'refund'), { recursive: true });
  fs.writeFileSync(path.join(dest, MARK), `${new Date().toISOString()}\n`);

  let main = 0;
  let refund = 0;
  for (const o of orders) {
    const meta = readMeta(o.orderId);
    for (const f of meta.files) {
      const toRefund = f.label.startsWith('返金明細書');
      fs.copyFileSync(path.join(docDir(o.orderId), f.file), path.join(dest, toRefund ? 'refund' : '', f.file));
      toRefund ? refund++ : main++;
    }
    if (meta.summary) {
      fs.copyFileSync(path.join(docDir(o.orderId), meta.summary), path.join(dest, meta.summary));
      main++;
    }
  }
  if (!refund) fs.rmdirSync(path.join(dest, 'refund'));
  log(`${dest} に ${main} 個、refund/ に ${refund} 個を置いた (会社の注文 ${orders.length} 件)`);
}

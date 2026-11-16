// 会社の注文の全件について、書類がどうなっているかを表示する。
// 税理士用のフォルダには置かず、ターミナルに出すだけ (決めたこと H)。
import path from 'node:path';
import { docDir, readMeta } from './fetch-docs.mjs';
import { statements } from './statements.mjs';
import { companyOrders, unclassified } from './store.mjs';

const GROUPS = [
  ['missing', '未取得'],
  ['undelivered', '配達が済んでいないかもしれない (後から書類が増えうる。後日 fetch --refetch で取り直す)'],
  ['none', '適格請求書が無い (支払い明細書だけ)'],
  ['partial', '適格請求書と、そうでない明細書の両方がある'],
  ['summary', 'PDF のリンクが無く、注文概要を印刷した'],
  ['unknown', '判定できない明細書がある (PDF を開いて確かめる)'],
  ['refund', '返金の書類がある (refund/ に置かれる)'],
  ['all', 'すべて適格請求書'],
];

// 古い注文は状態が空で表示される (配達から時間がたった注文には出ない)。空のものは配達済みとみなす。
const DONE = /お届け済み|配達しました|配達済み|返品完了|返金手続き済み|キャンセル済み|Eメール配信/;
export const maybeUndelivered = (o, meta) => {
  const st = meta?.statusAtFetch ?? o.status;
  return o.kind === 'physical' && !!st && !DONE.test(st);
};

export function orderStatus(o) {
  const meta = readMeta(o.orderId);
  if (!meta) return { groups: ['missing'], detail: '' };
  const groups = [];
  if (maybeUndelivered(o, meta)) groups.push('undelivered');
  if (meta.summary) return { groups: [...groups, 'summary'], detail: meta.summary };
  const sts = meta.files.flatMap((f) => statements(path.join(docDir(o.orderId), f.file)).map((s) => ({ ...s, label: f.label })));
  const main = sts.filter((s) => !s.refund && !s.label.startsWith('返金明細書'));
  if (main.length === 0 || main.some((s) => s.judgment === 'unknown')) groups.push('unknown');
  const q = main.filter((s) => s.judgment === 'qualified').length;
  const n = main.filter((s) => s.judgment === 'not').length;
  if (q && n) groups.push('partial');
  else if (!q && n) groups.push('none');
  else if (q && !n && !groups.includes('unknown')) groups.push('all');
  if (meta.files.some((f) => f.label.startsWith('返金明細書'))) groups.push('refund');
  const detail = sts
    .filter((s) => s.judgment !== 'qualified' || s.refund)
    .map((s) => `${s.title ?? '表題なし'} ${s.issuer ?? ''} ${s.amount ?? ''}`.trim())
    .join(' / ');
  return { groups, detail };
}

export function showStatus(p) {
  const orders = companyOrders(p);
  const by = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
  for (const o of orders) {
    const s = orderStatus(o);
    for (const g of s.groups) by[g].push({ o, detail: s.detail });
  }
  console.log(`${p.from} 〜 ${p.to}: 会社の注文 ${orders.length} 件 / 未分類 ${unclassified(p).length} 件`);
  for (const [k, title] of GROUPS) {
    if (!by[k].length) continue;
    console.log(`\n${title}: ${by[k].length} 件`);
    if (k === 'all') continue;
    for (const { o, detail } of by[k]) {
      const st = k === 'undelivered' ? `  [${readMeta(o.orderId)?.statusAtFetch ?? o.status}]` : '';
      console.log(`  ${o.date} ${o.orderId} ${o.total ?? ''}${st}${k === 'missing' || k === 'undelivered' ? '' : `  ${detail}`}`);
    }
  }
  return by.missing.length;
}

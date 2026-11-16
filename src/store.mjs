// 注文と仕分けの結果の読み書き。
import { CLASS_JSON, ORDERS_JSON } from './config.mjs';
import { Fatal, readJson, writeJson } from './util.mjs';

// キャンセル済みの注文は合計も「領収書等」も無く、書類が出ないので、仕分けの対象にしない。
export const isCancelled = (o) => !o.total && !o.invoicePopoverUrl;

export function ordersIn(p) {
  const all = readJson(ORDERS_JSON, null);
  if (!all) throw new Fatal('注文の一覧が無い。先に `node receipts.mjs orders <期>` を実行してください', 2);
  const missing = p.years.filter((y) => !Object.values(all).some((o) => o.date.startsWith(`${y}-`)));
  if (missing.length) console.warn(`注意: ${missing.join(', ')} 年の注文が一覧に 1 件も無い (orders を実行していない可能性がある)`);
  return Object.values(all)
    .filter((o) => p.includes(o.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.orderId.localeCompare(b.orderId));
}

export const readClassification = () => readJson(CLASS_JSON, {});

export function setClassification(orderId, value) {
  const cls = readClassification();
  if (value === null) delete cls[orderId];
  else cls[orderId] = { value, at: new Date().toISOString() };
  writeJson(CLASS_JSON, cls);
}

export const sortable = (p) => ordersIn(p).filter((o) => !isCancelled(o));
export const unclassified = (p) => {
  const cls = readClassification();
  return sortable(p).filter((o) => !cls[o.orderId]);
};
export const companyOrders = (p) => {
  const cls = readClassification();
  return sortable(p).filter((o) => cls[o.orderId]?.value === 'company');
};

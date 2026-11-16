// 注文一覧の取得と、保存した HTML からの注文の取り出し。
import { load } from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import { connect, isSigninUrl } from './chrome.mjs';
import { BASE, LISTS, ORDERS_JSON, listUrl } from './config.mjs';
import { Fatal, clean, log, readJson, sleep, sleepBetween, writeFileAtomic, writeJson } from './util.mjs';

const MAX_PAGES = 100;

// ページ内で注文の日付を数え、件数だけを返す (日付の文字列は返さない)。
// Amazon は URL の年の絞り込みを無視して最新の注文を出すことがある (2026-11-16 に実際に起きた) ので、
// 保存する前に、表示された注文がすべて指定の年であることを確かめる。
const countYears = (page, year) =>
  page.evaluate((y) => {
    const cards = [...document.querySelectorAll('.order-card.js-order-card')];
    let match = 0;
    let noDate = 0;
    for (const card of cards) {
      const li = [...card.querySelectorAll('.order-header__header-list-item')].find((e) =>
        /注文日|サブスクリプション課金日/.test(e.textContent),
      );
      const found = li?.textContent.replace(/\s+/g, '').match(/(?:注文日|サブスクリプション課金日)(\d{4})年/)?.[1];
      if (!found) noDate++;
      else if (found === y) match++;
    }
    const pagination = document.querySelector('ul.a-pagination');
    // 注文履歴のページであることの印 (年の絞り込みの選択欄)。注文が 0 件の年でもこれはある。
    const isOrderHistory = !!document.querySelector('[name="timeFilter"]');
    const last = pagination?.querySelector('li.a-last');
    return {
      cards: cards.length,
      match,
      noDate,
      isOrderHistory,
      hasPagination: !!pagination,
      // 最後のページには「次へ」(li.a-last) そのものが無い (2023 年の実データで確認)。
      isLast: !last || last.classList.contains('a-disabled'),
      maxPageLink: Math.max(0, ...[...(pagination?.querySelectorAll('li a') ?? [])].map((a) => Number(a.textContent.trim()) || 0)),
      nextHref: last?.querySelector('a')?.getAttribute('href') ?? null,
    };
  }, year);

async function fetchYear(page, year) {
  // 一時フォルダに取得し、最後のページまで終えてから入れ替える。途中で止まっても前回の一覧が残るように。
  const dir = path.join(LISTS, `.${year}.partial`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let url = listUrl(year);
  let total = 0;
  for (let n = 1; ; n++) {
    if (n > MAX_PAGES) throw new Fatal(`${year} 年: ${MAX_PAGES} ページを超えた。取得を止める`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => {});
    await sleep(1000);
    if (isSigninUrl(page.url())) throw new Fatal('ログイン画面に移った。専用の Chrome の窓でログインしてからやり直してください', 3);
    const r = await countYears(page, year);
    if (r.cards !== r.match) {
      throw new Fatal(`${year} 年の ${n} ページ目: 注文 ${r.cards} 件のうち ${r.cards - r.match} 件が ${year} 年と確かめられない (日付が読めない ${r.noDate} 件)。保存せずに止める`);
    }
    // 注文が 0 件のページは、エラーページや確認ページの可能性がある。注文が 1 件も無い年の 1 ページ目だけを認める。
    if (r.cards === 0 && (n > 1 || !r.isOrderHistory)) {
      throw new Fatal(`${year} 年の ${n} ページ目: 注文が 1 件も無く、注文履歴のページか確かめられない (${page.url()})`);
    }
    if (r.cards > 0) {
      writeFileAtomic(path.join(dir, `page-${String(n).padStart(2, '0')}.html`), await page.content());
    }
    total += r.cards;
    log(`${year} 年 ${n} ページ目: ${r.cards} 件`);
    if (!r.hasPagination) {
      // 1 ページに収まる年はページ送りが出ない。10 件ちょうどでページ送りが無いのは読み取りの失敗を疑う。
      if (r.cards >= 10) throw new Fatal(`${year} 年の ${n} ページ目: 注文が ${r.cards} 件あるのにページ送りが見つからない`);
      break;
    }
    if (r.isLast) {
      if (r.maxPageLink > n) throw new Fatal(`${year} 年の ${n} ページ目: 「次へ」が無いのに ${r.maxPageLink} ページ目へのリンクがある`);
      break;
    }
    if (!r.nextHref) throw new Fatal(`${year} 年の ${n} ページ目: 次のページへのリンクを読めない`);
    url = new URL(r.nextHref, BASE).toString();
    await sleepBetween([1500, 3000]);
  }
  fs.writeFileSync(path.join(dir, FETCHED_AT), `${new Date().toISOString()}\n`);
  const final = path.join(LISTS, year);
  fs.rmSync(final, { recursive: true, force: true });
  fs.renameSync(dir, final);
  log(`${year} 年: 合計 ${total} 件`);
  return total;
}

const FETCHED_AT = 'fetched-at.txt';

// その年の一覧を取得した時刻。記録が無い (サンプルから移した) ときは、保存したページの最も古い更新時刻を使う。
export function listFetchedAt(year) {
  const dir = path.join(LISTS, year);
  const f = path.join(dir, FETCHED_AT);
  if (fs.existsSync(f)) return new Date(fs.readFileSync(f, 'utf8').trim());
  if (!fs.existsSync(dir)) return null;
  const times = fs.readdirSync(dir).map((n) => fs.statSync(path.join(dir, n)).mtimeMs);
  return times.length ? new Date(Math.min(...times)) : null;
}

// 期の終わりより前に取った一覧のままだと、その後の注文が抜ける。fetch と export の前に確かめる。
export function assertListsComplete(p) {
  for (const year of p.years) {
    const at = listFetchedAt(year);
    if (!at) throw new Fatal(`${year} 年の注文一覧が無い。先に orders ${p.name} を実行してください`, 2);
    const endOfPeriod = new Date(`${p.to}T23:59:59+09:00`);
    if (year === p.years[1] && at <= endOfPeriod) {
      throw new Fatal(`${year} 年の注文一覧は ${at.toLocaleString('ja-JP')} に取ったもので、期の終わり (${p.to}) より前。orders ${p.name} を実行し直してください`, 2);
    }
  }
}

export async function fetchLists(p) {
  const { browser, context } = await connect();
  const page = await context.newPage();
  try {
    for (const year of p.years) await fetchYear(page, year);
  } finally {
    await page.close();
    await browser.close();
  }
  return parseLists(p.years);
}

// 1 枚の注文カードから注文を取り出す。
function parseCard($, card) {
  const header = {};
  card.find('.order-header__header-list-item').each((_, li) => {
    const label = clean($(li).find('.a-text-caps').first().text());
    if (label) header[label] = clean($(li).find('.a-size-base, .a-color-secondary:not(.a-text-caps)').first().text());
  });
  const orderId = clean(card.find('.yohtmlc-order-id span.a-color-secondary').last().text()) || header['注文番号'];
  const dateLabel = header['注文日'] ? '注文日' : header['サブスクリプション課金日'] ? 'サブスクリプション課金日' : null;
  const m = (header[dateLabel] ?? '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const link = (text) => {
    const href = card.find('a').filter((_, a) => clean($(a).text()) === text).first().attr('href');
    return href ? new URL(href, BASE).toString() : null;
  };

  // 商品: 商品ページ (/dp/<ASIN>) へのリンクを ASIN ごとにまとめる。1 商品の注文と複数商品の注文で HTML の形が違うが、
  // どちらもこのリンクは持つ。アプリストアの注文などは、注文詳細へのリンク (yo_fallback) に名前と画像が付く。
  const byAsin = new Map();
  card.find('a[href*="/dp/"]').each((_, a) => {
    const href = $(a).attr('href');
    const asin = href.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
    if (!asin) return;
    const item = byAsin.get(asin) ?? { title: null, asin, image: null, qty: null };
    const text = clean($(a).text());
    if (text && !item.title) item.title = text;
    const img = $(a).find('img').first();
    if (img.length && !item.image) {
      item.image = img.attr('src') ?? null;
      const qty = clean($(a).parent().find('.product-image__qty').first().text());
      if (qty) item.qty = Number(qty);
    }
    byAsin.set(asin, item);
  });
  const items = [...byAsin.values()];
  if (items.length === 0) {
    const links = card.find('a[href*="yo_fallback"]');
    const title = clean(links.filter((_, a) => clean($(a).text())).first().text()) || null;
    const image = links.find('img').first().attr('src') ?? null;
    if (title || image) items.push({ title, asin: null, image, qty: null });
  }

  return {
    orderId,
    kind: orderId?.startsWith('D01-') ? 'digital' : 'physical',
    date: m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null,
    dateLabel,
    total: header['合計'] ?? null,
    // 配達の状態 (「11月14日にお届け済み」「返品完了」など)。複数の発送に分かれた注文は、最初の発送の状態。
    status:
      clean(card.find('.delivery-box__primary-text').first().text()) ||
      clean(card.find('.yohtmlc-shipment-status-primaryText').first().text()) ||
      null,
    shipments: card.find('.delivery-box__primary-text').length,
    detailsUrl: link('注文内容を表示'),
    invoicePopoverUrl: link('領収書等'),
    items,
  };
}

// lists/<暦年>/ の保存済みページから注文を取り出し、orders.json の該当する年の分を置き換える。
export function parseLists(years) {
  const all = readJson(ORDERS_JSON, {});
  for (const year of years) {
    const dir = path.join(LISTS, year);
    if (!fs.existsSync(dir)) throw new Fatal(`${year} 年の注文一覧が無い。先に orders を実行してください`);
    const found = {};
    const pages = fs.readdirSync(dir).filter((f) => /^page-\d+\.html$/.test(f)).sort();
    // ページの番号が 1 から欠けずに並んでいることを確かめる (途中までしか無い一覧で注文を消さないため)。
    pages.forEach((f, i) => {
      if (f !== `page-${String(i + 1).padStart(2, '0')}.html`) throw new Fatal(`${year} 年の注文一覧のページが欠けている (${f})。orders を実行し直してください`);
    });
    for (const f of pages) {
      const $ = load(fs.readFileSync(path.join(dir, f), 'utf8'));
      $('.order-card.js-order-card').each((_, el) => {
        const o = parseCard($, $(el));
        if (!o.orderId || !o.date) throw new Fatal(`${year} 年 ${f}: 注文番号か日付を読めない注文がある`);
        if (found[o.orderId]) throw new Fatal(`${year} 年: 注文番号 ${o.orderId} が 2 回出てきた`);
        found[o.orderId] = o;
      });
    }
    for (const [id, o] of Object.entries(all)) if (o.date.startsWith(`${year}-`) && !found[id]) delete all[id];
    Object.assign(all, found);
    log(`${year} 年: ${Object.keys(found).length} 件を取り出した`);
  }
  writeJson(ORDERS_JSON, all);
  return all;
}

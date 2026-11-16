// 会社に分けた注文の書類を取得する。
// 注文ごとに「領収書等」を開き、その場で HTML を保存して、PDF のリンクを順にクリックしてダウンロードする。
//
// PDF は Node.js 側の通信やページ内の fetch で取らない。Amazon はそれらを数十個でエラーページに切り替え、
// 切り替わった後もクリックによるダウンロードは通った (2026-11-16 に確認、docs/design.md)。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { connect, isSigninUrl, pdfDownloadPrefIsSet } from './chrome.mjs';
import { BLOCKED_JSON, BLOCK_COOLDOWN_MS, CLICK_WAIT_MS, DOCS } from './config.mjs';
import { assertListsComplete } from './orders.mjs';
import { companyOrders, unclassified } from './store.mjs';
import { Fatal, log, readJson, sleep, sleepBetween, writeFileAtomic, writeJson } from './util.mjs';

export const docDir = (id) => path.join(DOCS, id);
export const readMeta = (id) => readJson(path.join(docDir(id), 'meta.json'), null);

class Blocked extends Fatal {
  constructor(message) {
    super(message, 5);
  }
}

// Amazon のエラーページ (自動アクセスとみなされたときに返る) の目印。
const isErrorPage = (html) => /api-services-support|ref=cs_503/.test(html);

function checkCooldown(force) {
  const b = readJson(BLOCKED_JSON, null);
  if (!b || force) return;
  const left = new Date(b.at).getTime() + BLOCK_COOLDOWN_MS - Date.now();
  if (left > 0) {
    throw new Fatal(
      `${new Date(b.at).toLocaleString('ja-JP')} に Amazon にエラーページを返された。` +
        `あと ${Math.ceil(left / 60000)} 分は取得しない (待たずに試すなら --force)`,
      4,
    );
  }
}

// 「領収書等」のページの書類のリンクを、上から順に返す。index はページ内の a 要素の通し番号。
const readLinks = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('a')]
      .map((a, index) => {
        const href = a.getAttribute('href') ?? '';
        const label = a.textContent.replace(/\s+/g, ' ').trim();
        const kind = href.includes('/documents/download/') ? 'pdf' : label === '印刷可能な注文概要' ? 'summary' : null;
        return { index, label, kind, href };
      })
      .filter((l) => l.kind),
  );

async function openPopover(page, o) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(o.invoicePopoverUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => {});
    await sleep(1500);
    if (isSigninUrl(page.url())) throw new Fatal('ログイン画面に移った。専用の Chrome の窓でログインしてからやり直してください', 3);
    const html = await page.content();
    if (isErrorPage(html)) throw new Blocked(`${o.orderId}: 「領収書等」の代わりに Amazon のエラーページが返った。弾かれたと判断して止める`);
    const links = await readLinks(page);
    // その注文の「領収書等」が最後まで読み込まれたことを、注文番号と「印刷可能な注文概要」のリンクで確かめる。
    if (html.includes(o.orderId) && links.some((l) => l.kind === 'summary')) return { html, links };
    log(`${o.orderId}: 「領収書等」の中身が揃っていない (${attempt} 回目)`);
    await sleep(5000);
  }
  throw new Fatal(`${o.orderId}: 「領収書等」を開けなかった`);
}

// ダウンロードの完了を DevTools Protocol の Browser ドメインで受け取る。
// 通知はブラウザ全体のものなので、書類のリンクの URL から始まったダウンロードだけを受け取る。
function downloadWatcher(cdp, dlDir) {
  let current = null;
  cdp.on('Browser.downloadWillBegin', (ev) => {
    if (current && !current.guid && ev.url.includes('/documents/download/')) current.guid = ev.guid;
  });
  cdp.on('Browser.downloadProgress', (ev) => {
    if (!current || ev.guid !== current.guid) return;
    if (ev.state === 'completed') current.resolve(path.join(dlDir, ev.guid));
    if (ev.state === 'canceled') current.reject(new Error('ダウンロードが取り消された'));
  });
  return {
    expect(timeoutMs) {
      let timer;
      const p = new Promise((resolve, reject) => {
        current = { guid: null, resolve, reject };
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      });
      const done = p.finally(() => {
        clearTimeout(timer);
        current = null;
      });
      done.catch(() => {}); // クリックが先に失敗したときに、受け手の無い reject でプロセスが落ちないように
      return done;
    },
  };
}

// クリックの後にダウンロードにならなかったとき、どのタブに何が出ているかで原因を分ける。
async function diagnose(page) {
  for (const p of page.context().pages()) {
    const url = p.url();
    if (isSigninUrl(url)) throw new Fatal('ログイン画面に移った。専用の Chrome の窓でログインしてからやり直してください', 3);
    const html = await p.content().catch(() => '');
    if (isErrorPage(html)) throw new Blocked(`PDF の代わりに Amazon のエラーページが返った (${url})。弾かれたと判断して止める`);
  }
}

async function clickPdf(page, watcher, link) {
  const done = watcher.expect(30000);
  // クリックの直前に、そのリンクが記録と同じ書類のリンクであることを確かめ、目印を付ける。
  const ok = await page.evaluate(({ index, label }) => {
    const a = document.querySelectorAll('a')[index];
    if (!a || !(a.getAttribute('href') ?? '').includes('/documents/download/')) return false;
    if (a.textContent.replace(/\s+/g, ' ').trim() !== label) return false;
    a.setAttribute('data-receipt-click', '1');
    return true;
  }, link);
  if (!ok) throw new Fatal(`「${link.label}」のリンクが、読み取ったときと違う位置にある`);
  // 人のクリックと同じ形で押すため、Playwright のクリック (マウス操作) で押す。
  await page.click('a[data-receipt-click="1"]');
  await page.evaluate(() => document.querySelector('a[data-receipt-click]')?.removeAttribute('data-receipt-click')).catch(() => {});
  try {
    return await done;
  } catch (e) {
    await diagnose(page);
    throw new Fatal(`「${link.label}」のダウンロードが終わらなかった (${e.message})`);
  }
}

// 保存する前に、PDF の中にその注文の注文番号があることを確かめる (別の注文の書類を取り違えないため)。
function assertPdfOfOrder(body, orderId, dlDir) {
  if (body.subarray(0, 5).toString() !== '%PDF-') throw new Blocked(`${orderId}: ダウンロードしたものが PDF でない (${body.length} バイト)`);
  const tmp = path.join(dlDir, `check-${orderId}.pdf`);
  fs.writeFileSync(tmp, body);
  try {
    const text = execFileSync('pdftotext', [tmp, '-'], { encoding: 'utf8' });
    if (!text.includes(orderId)) throw new Fatal(`${orderId}: ダウンロードした PDF にこの注文の注文番号が無い。保存せずに止める`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function fetchOrder(page, cdp, watcher, dlDir, o) {
  const dir = docDir(o.orderId);
  let { html, links } = await openPopover(page, o);
  const pdfLinks = links.filter((l) => l.kind === 'pdf');
  const files = [];

  for (const [n, recorded] of pdfLinks.entries()) {
    let link = recorded;
    // 前のクリックで画面が移っていたら開き直す。リンクの並びが変わっていないことを確かめ、新しい位置を使う。
    if (!page.url().includes('/your-orders/invoice/popover')) {
      ({ links } = await openPopover(page, o));
      const again = links.filter((l) => l.kind === 'pdf');
      if (again.map((l) => l.label).join('|') !== pdfLinks.map((l) => l.label).join('|')) {
        throw new Fatal(`${o.orderId}: 開き直した「領収書等」のリンクの並びが変わった`);
      }
      link = again[n];
    }
    const tmp = await clickPdf(page, watcher, link);
    const body = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    assertPdfOfOrder(body, o.orderId, dlDir);
    const file = `${o.date}_${o.orderId}_${n + 1}.pdf`;
    writeFileAtomic(path.join(dir, file), body);
    files.push({ file, label: link.label });
    log(`${o.orderId}: ${file} (${link.label})`);
    await sleepBetween(CLICK_WAIT_MS);
  }

  // PDF のリンクが 1 つも無い注文は、「印刷可能な注文概要」を印刷 → PDF にして保存する (決めたこと G)。
  let summary = null;
  if (pdfLinks.length === 0) {
    const summaryLink = links.find((l) => l.kind === 'summary');
    await page.goto(new URL(summaryLink.href, page.url()).toString(), { waitUntil: 'load' });
    await sleep(1500);
    const sh = await page.content();
    if (isErrorPage(sh)) throw new Blocked(`${o.orderId}: 注文概要の代わりに Amazon のエラーページが返った`);
    if (!sh.includes(o.orderId)) throw new Fatal(`${o.orderId}: 注文概要のページに注文番号が無い`);
    const { data } = await cdp.send('Page.printToPDF', { printBackground: true, paperWidth: 8.27, paperHeight: 11.69 });
    summary = `${o.date}_${o.orderId}_summary.pdf`;
    writeFileAtomic(path.join(dir, summary), Buffer.from(data, 'base64'));
    log(`${o.orderId}: PDF のリンクが無いので、注文概要を印刷した (${summary})`);
    await sleepBetween(CLICK_WAIT_MS);
  }

  writeFileAtomic(path.join(dir, 'popover.html'), html);
  // meta.json は最後に書く。途中で止まった注文は meta.json が無いので、次の fetch で取り直される。
  writeJson(path.join(dir, 'meta.json'), {
    orderId: o.orderId,
    fetchedAt: new Date().toISOString(),
    // 取得した時点の注文の状態。配達前などの注文は、後から書類が増えることがある。
    statusAtFetch: o.status ?? null,
    links: links.map(({ label, kind }) => ({ label, kind })),
    files,
    summary,
  });
}

export async function fetchDocs(p, { force = false, refetch = [] } = {}) {
  const rest = unclassified(p);
  if (rest.length) throw new Fatal(`仕分けていない注文が ${rest.length} 件ある。先に sort で仕分けてください`, 2);
  assertListsComplete(p);
  checkCooldown(force);
  if (!pdfDownloadPrefIsSet()) throw new Fatal('専用の Chrome の設定「PDF をダウンロードする」が入っていない。専用の Chrome を閉じてから login を実行してください', 2);

  const company = companyOrders(p);
  const unknown = refetch.filter((id) => !company.some((o) => o.orderId === id));
  if (unknown.length) throw new Fatal(`--refetch の注文番号が、この期の会社の注文に無い: ${unknown.join(', ')}`, 2);
  const targets = company.filter((o) => refetch.includes(o.orderId) || !readMeta(o.orderId));
  log(`会社の注文 ${company.length} 件のうち、取得するもの ${targets.length} 件`);
  if (!targets.length) return;
  const noLink = targets.filter((o) => !o.invoicePopoverUrl);
  if (noLink.length) throw new Fatal(`「領収書等」のリンクが無い会社の注文がある: ${noLink.map((o) => o.orderId).join(', ')}`);

  const { browser, context } = await connect();
  const page = await context.newPage();
  const dlDir = path.join(DOCS, '.downloading');
  fs.mkdirSync(dlDir, { recursive: true });
  const bcdp = await browser.newBrowserCDPSession();
  await bcdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dlDir, eventsEnabled: true });
  const watcher = downloadWatcher(bcdp, dlDir);
  const cdp = await context.newCDPSession(page);
  let done = 0;
  try {
    for (const o of targets) {
      // 取り直すときは、前の書類を消してから取る (書類が減っていた場合に古い PDF が残らないように)。
      if (refetch.includes(o.orderId)) fs.rmSync(docDir(o.orderId), { recursive: true, force: true });
      await fetchOrder(page, cdp, watcher, dlDir, o);
      done++;
      await sleepBetween(CLICK_WAIT_MS);
    }
  } catch (e) {
    if (e instanceof Blocked) writeJson(BLOCKED_JSON, { at: new Date().toISOString(), afterOrders: done, message: e.message });
    throw e;
  } finally {
    log(`取得した注文: ${done} / ${targets.length} 件`);
    // ダウンロード先を Chrome の既定に戻す (この後に利用者がダウンロードした物が data/ に入らないように)。
    await bcdp.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {});
    await page.close().catch(() => {});
    await browser.close();
  }
}

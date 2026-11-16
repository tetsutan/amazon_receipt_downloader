// 会社に分けた注文の書類を取得する。
// 注文ごとに「領収書等」を開き、その場で HTML を保存して、PDF のリンクを順にクリックしてダウンロードする。
//
// PDF は Node.js 側の通信やページ内の fetch で取らない。Amazon はそれらを数十個でエラーページに切り替え、
// 切り替わった後もクリックによるダウンロードは通った (2026-11-16 に確認、docs/design.md)。
import fs from 'node:fs';
import path from 'node:path';
import { connect, isSigninUrl } from './chrome.mjs';
import { BLOCKED_JSON, BLOCK_COOLDOWN_MS, CLICK_WAIT_MS, DOCS } from './config.mjs';
import { companyOrders, unclassified } from './store.mjs';
import { Fatal, log, readJson, sleep, sleepBetween, writeFileAtomic, writeJson } from './util.mjs';

export const docDir = (id) => path.join(DOCS, id);
export const readMeta = (id) => readJson(path.join(docDir(id), 'meta.json'), null);

class Blocked extends Fatal {}

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

// 「領収書等」のページのリンクを、上から順に { index, label, kind } で返す。
const readLinks = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('a')].map((a, index) => {
      const href = a.getAttribute('href') ?? '';
      const label = a.textContent.replace(/\s+/g, ' ').trim();
      const kind = href.includes('/documents/download/') ? 'pdf' : label === '印刷可能な注文概要' ? 'summary' : 'other';
      return { index, label, kind, href };
    }),
  );

async function openPopover(page, o) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(o.invoicePopoverUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => {});
    await sleep(1500);
    if (isSigninUrl(page.url())) throw new Fatal('ログイン画面に移った。専用の Chrome の窓でログインしてからやり直してください', 3);
    const html = await page.content();
    const links = await readLinks(page);
    // その注文の「領収書等」が最後まで読み込まれたことを、注文番号と「印刷可能な注文概要」のリンクで確かめる。
    if (html.includes(o.orderId) && links.some((l) => l.kind === 'summary')) return { html, links };
    log(`${o.orderId}: 「領収書等」の中身が揃っていない (${attempt} 回目)`);
    await sleep(5000);
  }
  throw new Fatal(`${o.orderId}: 「領収書等」を開けなかった`);
}

// ダウンロードの完了を DevTools Protocol の Browser ドメインで受け取る。
function downloadWatcher(cdp, dlDir) {
  let current = null;
  cdp.on('Browser.downloadWillBegin', (ev) => {
    if (current && !current.guid) current.guid = ev.guid;
  });
  cdp.on('Browser.downloadProgress', (ev) => {
    if (!current || ev.guid !== current.guid) return;
    if (ev.state === 'completed') current.resolve(path.join(dlDir, ev.guid));
    if (ev.state === 'canceled') current.reject(new Error('ダウンロードが取り消された'));
  });
  return {
    expect(timeoutMs) {
      const p = new Promise((resolve, reject) => {
        current = { guid: null, resolve, reject };
        setTimeout(() => reject(new Error('timeout')), timeoutMs);
      });
      return p.finally(() => (current = null));
    },
  };
}

async function clickPdf(page, watcher, link) {
  const done = watcher.expect(30000);
  // 人のクリックと同じ形で押すため、目印を付けてから Playwright のクリック (マウス操作) で押す。
  await page.evaluate((i) => document.querySelectorAll('a')[i].setAttribute('data-receipt-click', '1'), link.index);
  await page.click('a[data-receipt-click="1"]');
  // ダウンロードでは画面が移らないので、次のリンクの目印と重ならないよう外しておく。
  await page.evaluate(() => document.querySelector('a[data-receipt-click]')?.removeAttribute('data-receipt-click')).catch(() => {});
  try {
    return await done;
  } catch (e) {
    // PDF の代わりにエラーページが返ると、ダウンロードにならず画面がそのページに移る。
    const url = page.url();
    const text = await page.content().catch(() => '');
    if (url.includes('/documents/download/') || /api-services-support|cs_503/.test(text)) {
      throw new Blocked(`PDF の代わりにページが返った (${url})。Amazon に弾かれたと判断して止める`, 5);
    }
    throw new Fatal(`PDF のダウンロードが終わらなかった (${e.message})`);
  }
}

async function fetchOrder(page, cdp, watcher, dlDir, o) {
  const dir = docDir(o.orderId);
  fs.mkdirSync(dir, { recursive: true });
  const { html, links } = await openPopover(page, o);
  writeFileAtomic(path.join(dir, 'popover.html'), html);
  const pdfLinks = links.filter((l) => l.kind === 'pdf');
  const files = [];

  for (const [n, link] of pdfLinks.entries()) {
    // 前のクリックで画面が移っていたら開き直し、リンクの並びが変わっていないことを確かめる。
    if (!page.url().includes('/your-orders/invoice/popover')) {
      const again = await openPopover(page, o);
      const labels = again.links.filter((l) => l.kind === 'pdf').map((l) => l.label);
      if (labels.join('|') !== pdfLinks.map((l) => l.label).join('|')) throw new Fatal(`${o.orderId}: 開き直した「領収書等」のリンクの並びが変わった`);
    }
    const tmp = await clickPdf(page, watcher, link);
    const body = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    if (body.subarray(0, 5).toString() !== '%PDF-') throw new Blocked(`${o.orderId}: ダウンロードしたものが PDF でない (${body.length} バイト)`, 5);
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
    if (!(await page.content()).includes(o.orderId)) throw new Fatal(`${o.orderId}: 注文概要のページに注文番号が無い`);
    const { data } = await cdp.send('Page.printToPDF', { printBackground: true, paperWidth: 8.27, paperHeight: 11.69 });
    const body = Buffer.from(data, 'base64');
    summary = `${o.date}_${o.orderId}_summary.pdf`;
    writeFileAtomic(path.join(dir, summary), body);
    log(`${o.orderId}: PDF のリンクが無いので、注文概要を印刷した (${summary})`);
    await sleepBetween(CLICK_WAIT_MS);
  }

  writeJson(path.join(dir, 'meta.json'), {
    orderId: o.orderId,
    fetchedAt: new Date().toISOString(),
    links: links.filter((l) => l.kind !== 'other').map(({ label, kind }) => ({ label, kind })),
    files,
    summary,
  });
}

export async function fetchDocs(p, { force = false, refetch = [] } = {}) {
  const rest = unclassified(p);
  if (rest.length) throw new Fatal(`仕分けていない注文が ${rest.length} 件ある。先に sort で仕分けてください`, 2);
  checkCooldown(force);

  const targets = companyOrders(p).filter((o) => refetch.includes(o.orderId) || !readMeta(o.orderId));
  log(`会社の注文 ${companyOrders(p).length} 件のうち、取得するもの ${targets.length} 件`);
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
      await fetchOrder(page, cdp, watcher, dlDir, o);
      done++;
      await sleepBetween(CLICK_WAIT_MS);
    }
  } catch (e) {
    if (e instanceof Blocked) writeJson(BLOCKED_JSON, { at: new Date().toISOString(), afterOrders: done, message: e.message });
    throw e;
  } finally {
    log(`取得した注文: ${done} / ${targets.length} 件`);
    await page.close().catch(() => {});
    await browser.close();
  }
}

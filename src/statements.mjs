// PDF を全ページ読み、中に入っている明細書を 1 枚ずつに分けて、適格請求書かどうかを判定する。
// 1 つの PDF に出品者ごとの明細書が何枚も入っていることがあり、1 枚の明細書が 2 ページに続くこともある。
import { execFileSync } from 'node:child_process';

const TITLES = ['適格返還請求書', '適格請求書', '支払い明細書', '返金明細書'];

// ページの右上にある表題 (行の中に表題の語だけがある行) を探す。本文の「この書類は適格請求書ではありません」を拾わないため。
function titleOf(page) {
  for (const line of page.split('\n').slice(0, 8)) {
    const t = line.trim();
    if (TITLES.includes(t)) return t;
  }
  return null;
}

export function statements(file) {
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  const out = [];
  text.split('\f').forEach((page, i) => {
    if (!page.trim()) return;
    // 続きのページは前のページと同じ請求書番号を持つ。
    const invNo = page.match(/請求書番号\s+(\S+)/)?.[1] ?? null;
    const prev = out[out.length - 1];
    if (prev && invNo && prev.invNo === invNo) {
      prev.pages.push(i + 1);
      return;
    }
    // 続きのページで請求書番号が読めないものは、表題も発行者も無いので前の明細書の続きとみなす。
    const title = titleOf(page);
    if (prev && !title && !/発行者/.test(page)) {
      prev.pages.push(i + 1);
      return;
    }
    const amount = page.match(/(?:返還額)?合計\s+(-?)(?:￥|JPY\s*)(-?[\d,.]+)/);
    // 日本語を取り出せない PDF では「登録番号」の文字が消えるので、T で始まる 13 桁の並びそのものでも拾う。
    const registration = page.match(/登録番号: ?(T\d{13})/)?.[1] ?? page.match(/(?:^|[\s:])(T\d{13})(?!\d)/m)?.[1] ?? null;
    const notQualified = /適格(?:返還)?請求書ではありません/.test(page);
    out.push({
      title,
      invNo,
      issuer: page.match(/発行者 +(.+)/)?.[1]?.trim() ?? null,
      registration,
      amount: amount ? Number(`${amount[1]}${amount[2].replace(/,/g, '')}`) : null,
      // qualified: 適格請求書 (または適格返還請求書) と判定できる / not: そうでないと判定できる / unknown: 判定できない
      judgment: notQualified ? 'not' : registration && (title?.startsWith('適格') || title === null) ? 'qualified' : title ? 'not' : 'unknown',
      refund: title === '返金明細書' || title === '適格返還請求書',
      pages: [i + 1],
    });
  });
  return out;
}

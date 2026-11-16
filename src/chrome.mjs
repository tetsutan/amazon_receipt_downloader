// 専用プロファイルの Google Chrome の起動と接続。
// Chrome は Playwright から起動せず、通常の Google Chrome をアプリとして起動し、利用者が手でログインした後に接続する。
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CDP_PORT, CDP_URL, NORMAL_CHROME_NMH, PROFILE } from './config.mjs';
import { Fatal, log, readJson, sleep, writeJson } from './util.mjs';

const PREFS = path.join(PROFILE, 'Default', 'Preferences');

export async function isRunning() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

// 1Password の拡張機能がデスクトップ版と連携するための設定ファイルを、専用プロファイルにも置く。
// Chrome はこのファイルをプロファイルの NativeMessagingHosts/ から探すため、ふだんの Chrome の分だけでは見つからない。
function copyNativeMessagingHosts() {
  if (!fs.existsSync(NORMAL_CHROME_NMH)) return;
  const dest = path.join(PROFILE, 'NativeMessagingHosts');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(NORMAL_CHROME_NMH).filter((f) => f.startsWith('com.1password.'))) {
    fs.copyFileSync(path.join(NORMAL_CHROME_NMH, f), path.join(dest, f));
    log(`1Password の連携設定をコピーした: ${f}`);
  }
}

// PDF のリンクをクリックしたとき、ビューアで開かずにダウンロードさせる (Chrome の設定「PDF をダウンロードする」)。
// ビューアで開くと、スクリプトは表示用の枠の HTML しか受け取れない。Chrome の起動中に書くと上書きされるので、閉じているときに書く。
function setPdfDownloadPref() {
  const prefs = readJson(PREFS, {});
  if (prefs.plugins?.always_open_pdf_externally === true) return;
  prefs.plugins = { ...(prefs.plugins ?? {}), always_open_pdf_externally: true };
  writeJson(PREFS, prefs);
  log('Chrome の設定「PDF をダウンロードする」を有効にした');
}

export async function login() {
  if (await isRunning()) {
    assertDedicatedChrome();
    if (!pdfDownloadPrefIsSet()) {
      throw new Fatal('専用の Chrome が起動中で、「PDF をダウンロードする」の設定を書けない。専用の Chrome を閉じてから login をやり直してください');
    }
    log(`専用の Chrome はもう起動している (${CDP_URL})`);
    return;
  }
  fs.mkdirSync(PROFILE, { recursive: true });
  log(`専用プロファイル: ${PROFILE}`);
  copyNativeMessagingHosts();
  setPdfDownloadPref();
  execFileSync('open', [
    '-na',
    'Google Chrome',
    '--args',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://www.amazon.co.jp/',
  ]);
  for (let i = 0; i < 30 && !(await isRunning()); i++) await sleep(500);
  if (!(await isRunning())) throw new Fatal('専用の Chrome の起動を確かめられなかった');
  log('開いた Chrome の窓で amazon.co.jp にログインしてください (1Password のパスキーを使えます)');
  log('ログインの状態はプロファイルに残るので、次回からは起動するだけで使えます');
}

// ポート 9222 で動いているのが専用プロファイルの Chrome かを、プロセスの起動引数で確かめる。
// 別の Chrome がこのポートを使っていると、そちらのアカウントを操作してしまうため。
function assertDedicatedChrome() {
  const lines = execFileSync('ps', ['-ax', '-o', 'command'], { encoding: 'utf8' }).split('\n');
  const ok = lines.some((l) => l.includes(`--remote-debugging-port=${CDP_PORT}`) && l.includes(`--user-data-dir=${PROFILE}`) && !l.includes('--type='));
  if (!ok) throw new Fatal(`ポート ${CDP_PORT} で動いているのが専用プロファイルの Chrome と確かめられない。専用の Chrome 以外を閉じてから login を実行してください`);
}

export const pdfDownloadPrefIsSet = () => readJson(PREFS, {}).plugins?.always_open_pdf_externally === true;

export async function connect() {
  if (!(await isRunning())) throw new Fatal('専用の Chrome が起動していない。先に `node receipts.mjs login` を実行してください');
  assertDedicatedChrome();
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  return { browser, context };
}

export const isSigninUrl = (url) => /\/ap\/(signin|mfa|cvf)/.test(url);

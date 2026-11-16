import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = path.join(ROOT, 'data');
export const LISTS = path.join(DATA, 'lists'); // lists/<暦年>/page-NN.html
export const DOCS = path.join(DATA, 'docs'); // docs/<注文番号>/
export const ORDERS_JSON = path.join(DATA, 'orders.json');
export const CLASS_JSON = path.join(DATA, 'classification.json');
export const BLOCKED_JSON = path.join(DATA, 'blocked.json');

export const PROFILE = path.join(os.homedir(), 'Library/Application Support/amazon-receipts/chrome-profile');
export const NORMAL_CHROME_NMH = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
export const CDP_PORT = 9222;
export const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
export const SORT_PORT = 8787;

export const BASE = 'https://www.amazon.co.jp';
export const listUrl = (year) => `${BASE}/your-orders/orders?timeFilter=year-${year}`;

// Amazon にエラーページを返されたら、この時間は取得を始めない (2026-11-16 は 1 時間 48 分後も続いていた)。
export const BLOCK_COOLDOWN_MS = 3 * 60 * 60 * 1000;
// クリックとクリックの間の待ち時間 (2026-11-16 にこの間隔で 66 個続けて取れた)。
export const CLICK_WAIT_MS = [5000, 8000];

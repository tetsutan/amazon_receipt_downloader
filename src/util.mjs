import fs from 'node:fs';
import path from 'node:path';

export const log = (m) => console.log(`[${new Date().toLocaleTimeString('ja-JP')}] ${m}`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sleepBetween = ([min, max]) => sleep(min + Math.random() * (max - min));
export const yen = (s) => Number(String(s ?? '').replace(/[^\d]/g, '')) || 0;
export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

// 書きかけのファイルを残さないよう、一時ファイルに書いてから置き換える。
export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
}
export const writeJson = (file, value) => writeFileAtomic(file, JSON.stringify(value, null, 2));

export class Fatal extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

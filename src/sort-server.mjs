// 仕分け画面。127.0.0.1 だけで待ち受ける。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SORT_PORT } from './config.mjs';
import { ordersIn, isCancelled, readClassification, setClassification } from './store.mjs';
import { Fatal, log } from './util.mjs';

const HTML = path.join(import.meta.dirname, 'sorter.html');

export function serveSorter(p, port = SORT_PORT) {
  const origin = `http://127.0.0.1:${port}`;
  // 一覧が無ければ、起動の時点で分かるメッセージで止める (要求の処理中に落ちないように)。
  const count = ordersIn(p).length;
  const send = (res, status, type, body) => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };
  const server = http.createServer((req, res) => {
    // ほかのサイトのページから仕分けを書き換えられないよう、宛先と送信元がこの画面であることを確かめる。
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, 'text/plain', 'bad host');
    if (req.method === 'GET' && req.url === '/') return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(HTML));
    if (req.method === 'GET' && req.url === '/api/data') {
      let orders;
      try {
        orders = ordersIn(p);
      } catch (e) {
        return send(res, 500, 'text/plain', e.message);
      }
      return send(
        res,
        200,
        'application/json',
        JSON.stringify({
          period: p,
          orders: orders.filter((o) => !isCancelled(o)),
          cancelled: orders.filter(isCancelled).length,
          classification: readClassification(),
        }),
      );
    }
    if (req.method === 'POST' && req.url === '/api/classify') {
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return send(res, 403, 'text/plain', 'bad origin');
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { orderId, value } = JSON.parse(body);
          if (!['company', 'personal', null].includes(value)) return send(res, 400, 'text/plain', 'bad value');
          if (!ordersIn(p).some((o) => o.orderId === orderId)) return send(res, 400, 'text/plain', 'unknown order');
          setClassification(orderId, value);
          send(res, 200, 'application/json', '{"ok":true}');
        } catch (e) {
          send(res, 500, 'text/plain', e.message);
        }
      });
      return;
    }
    send(res, 404, 'text/plain', 'not found');
  });
  return new Promise((resolve, reject) => {
    server.on('error', (e) =>
      reject(e.code === 'EADDRINUSE' ? new Fatal(`ポート ${port} が使用中で、仕分け画面を起動できない。前回の sort が動いたままになっていないか確かめてください`, 2) : e),
    );
    server.listen(port, '127.0.0.1', () => {
      log(`仕分け画面: ${origin}/  (${p.from} 〜 ${p.to}、注文 ${count} 件)`);
      log('ブラウザで開いて仕分けてください (localhost ではなく 127.0.0.1 で開く)。終わったら Ctrl-C で止めます');
    });
  });
}

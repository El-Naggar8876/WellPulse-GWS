#!/usr/bin/env node
/* Local mock of the Apps Script backend + static server for the app.
 * Usage: node tools/mock-server.js [port]      (default 8080)
 *   App:        http://localhost:8080/
 *   API:        http://localhost:8080/api      (same contract as backend/Code.gs)
 *   Data view:  http://localhost:8080/__mock/  (what the Google Sheet would show)
 *   Simulate server down: http://localhost:8080/__mock/offline?on=1  (on=0 to restore)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const ROOT = path.join(__dirname, '..', 'app');
const DATA_DIR = path.join(__dirname, 'mock-data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const DATA_FILE = path.join(DATA_DIR, 'readings.json');
const FARMERS_FILE = path.join(DATA_DIR, 'farmers.json');
const TOKEN = 'gws-2026';
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const LIMITS = {
  ec: { softMin: 0.1, softMax: 15, hardMin: 0, hardMax: 100 },
  temp: { softMin: 10, softMax: 40, hardMin: -5, hardMax: 60 }
};
let serverDown = false;
let readings = [];
try { readings = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { readings = []; }
let farmers = {};
try { farmers = JSON.parse(fs.readFileSync(FARMERS_FILE, 'utf8')); } catch (e) {
  farmers = { F001: { name: 'Ahmed', wells: [{ id: 'W1', label: 'البئر الشمالي' }, { id: 'W2', label: 'البئر الجنوبي' }], lang: 'ar' } };
  fs.writeFileSync(FARMERS_FILE, JSON.stringify(farmers, null, 2));
}
const persist = () => fs.writeFileSync(DATA_FILE, JSON.stringify(readings, null, 2));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

function validate(r) {
  if (!r || !r.id) return 'missing id';
  if (!r.farmer_id) return 'missing farmer_id';
  const ec = Number(r.ec_ms), tc = Number(r.temp_c);
  if (!isFinite(ec) || !isFinite(tc)) return 'invalid numbers';
  if (ec < LIMITS.ec.hardMin || ec > LIMITS.ec.hardMax) return 'ec out of range';
  if (tc < LIMITS.temp.hardMin || tc > LIMITS.temp.hardMax) return 'temp out of range';
  return null;
}

function submit(body, host) {
  if (body.token !== TOKEN) return { ok: false, error: 'bad token' };
  const results = [];
  const ids = new Set(readings.map(r => r.id));
  for (const r of body.records || []) {
    const reason = validate(r);
    if (reason) { results.push({ id: r.id, ok: false, status: 'rejected', reason }); continue; }
    if (ids.has(r.id)) { results.push({ id: r.id, ok: true, status: 'duplicate' }); continue; }
    let photo_url = '';
    if (r.photo && /^data:image\/jpeg;base64,/.test(r.photo)) {
      const file = path.join(PHOTO_DIR, r.id + '.jpg');
      fs.writeFileSync(file, Buffer.from(r.photo.split(',')[1], 'base64'));
      photo_url = 'http://' + host + '/__mock/photos/' + r.id + '.jpg';
    }
    const row = Object.assign({}, r, { photo: undefined, photo_url, received_at: new Date().toISOString(),
      ec25_ms: +(Number(r.ec_ms) / (1 + 0.02 * (Number(r.temp_c) - 25))).toFixed(4) });
    readings.push(row); ids.add(r.id);
    results.push({ id: r.id, ok: true, status: 'inserted', photo_url });
  }
  persist();
  return { ok: true, results };
}

function tableHtml() {
  const cols = ['received_at', 'id', 'farmer_id', 'farmer_name', 'well_id', 'well_label', 'ts_local', 'ec', 'ec_unit', 'ec_ms', 'temp_c', 'ec25_ms', 'lat', 'lon', 'acc_m', 'note', 'photo_url', 'app_version'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let h = '<!doctype html><meta charset="utf-8"><title>WellPulse mock sheet</title><style>body{font-family:system-ui;padding:16px}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ccc;padding:4px 8px;white-space:nowrap}th{background:#e6f3f5}</style>';
  h += '<h2>Mock "Readings" sheet (' + readings.length + ' rows)</h2><p>Server down simulation: <b>' + (serverDown ? 'ON' : 'off') + '</b> · <a href="/__mock/offline?on=1">turn on</a> · <a href="/__mock/offline?on=0">turn off</a> · <a href="/__mock/reset">clear data</a></p>';
  h += '<table><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr>';
  readings.slice().reverse().forEach(r => { h += '<tr>' + cols.map(c => '<td>' + (c === 'photo_url' && r[c] ? '<a href="' + esc(r[c]) + '">photo</a>' : esc(r[c])) + '</td>').join('') + '</tr>'; });
  return h + '</table>';
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://' + req.headers.host);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); return res.end(); }

  if (u.pathname === '/api') {
    if (serverDown) { res.writeHead(503); return res.end('down'); }
    if (req.method === 'GET') {
      if (u.searchParams.get('token') !== TOKEN) return json(res, 200, { ok: false, error: 'bad token' });
      const action = u.searchParams.get('action');
      if (action === 'config') {
        const f = farmers[u.searchParams.get('f')];
        return json(res, 200, { ok: true, limits: LIMITS, farmer: f ? Object.assign({ id: u.searchParams.get('f') }, f) : null });
      }
      return json(res, 200, { ok: true, version: 'mock', count: readings.length });
    }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 30e6) req.destroy(); });
    req.on('end', () => {
      try { const b = JSON.parse(body || '{}'); return json(res, 200, b.action === 'submit' ? submit(b, req.headers.host) : { ok: false, error: 'unknown action' }); }
      catch (e) { return json(res, 200, { ok: false, error: 'bad json' }); }
    });
    return;
  }

  if (u.pathname.startsWith('/__mock')) {
    if (u.pathname === '/__mock/offline') { serverDown = u.searchParams.get('on') === '1'; return json(res, 200, { ok: true, serverDown }); }
    if (u.pathname === '/__mock/reset') { readings = []; persist(); res.writeHead(302, { Location: '/__mock/' }); return res.end(); }
    if (u.pathname === '/__mock/state') return json(res, 200, { ok: true, count: readings.length, serverDown, ids: readings.map(r => r.id) });
    if (u.pathname.startsWith('/__mock/photos/')) {
      const f = path.join(PHOTO_DIR, path.basename(u.pathname));
      if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return fs.createReadStream(f).pipe(res); }
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(tableHtml());
  }

  // static app
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('WellPulse mock server');
  console.log('  App:  http://localhost:' + PORT + '/?f=F001&n=Ahmed&w=W1:North%20well,W2:South%20well&l=ar&api=http://localhost:' + PORT + '/api');
  console.log('  Data: http://localhost:' + PORT + '/__mock/');
});

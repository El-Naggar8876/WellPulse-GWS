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
const VIEWER_KEY = 'atlas-7q2m9x';
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
  farmers = {
    F001: { name: 'Ahmed', lang: 'ar', wells: [{ id: 'W1', label: 'البئر الشمالي', lat: 30.72, lon: 31.62, village: 'Zagazig' }, { id: 'W2', label: 'البئر الجنوبي', lat: 30.69, lon: 31.65, village: 'Zagazig' }] },
    F002: { name: 'Fatma Ali', lang: 'en', wells: [{ id: 'W1', label: 'Main well', lat: 30.58, lon: 31.50, village: 'Minya al-Qamh', depth_m: 42 }] },
    F003: { name: 'Saeed Hassan', lang: 'ar', wells: [{ id: 'W1', label: 'بئر الحقل', lat: 30.85, lon: 31.78, village: 'Abu Kabir' }, { id: 'W2', label: 'بئر البيت' }] }
  };
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
  h += '<h2>Mock "Readings" sheet (' + readings.length + ' rows)</h2><p>Server down simulation: <b>' + (serverDown ? 'ON' : 'off') + '</b> · <a href="/__mock/offline?on=1">turn on</a> · <a href="/__mock/offline?on=0">turn off</a> · <a href="/__mock/reset">clear data</a> · <a href="/__mock/seed">seed demo data</a> · <a href="/dashboard/?key=' + VIEWER_KEY + '">open dashboard</a></p>';
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
        const action = u.searchParams.get('action');
      if (action !== 'data' && u.searchParams.get('token') !== TOKEN) return json(res, 200, { ok: false, error: 'bad token' });
      if (action === 'data') {
        if (u.searchParams.get('key') !== VIEWER_KEY) return json(res, 200, { ok: false, error: 'bad key' });
        const cols = ['id', 'farmer_id', 'farmer_name', 'well_id', 'well_label', 'ts_epoch', 'ec_ms', 'ec25', 'temp_c', 'lat', 'lon', 'flag', 'note', 'photo_url'];
        const rows = readings.map(r => [r.id, r.farmer_id, r.farmer_name || '', r.well_id || '', r.well_label || '', Number(r.ts_epoch), r.ec_ms == null ? null : Number(r.ec_ms), r.ec25_ms == null ? null : Number(r.ec25_ms), r.temp_c == null ? null : Number(r.temp_c), r.lat == null ? null : Number(r.lat), r.lon == null ? null : Number(r.lon), '', r.note || '', r.photo_url || '']).sort((a, b) => a[5] - b[5]);
        const wells = Object.entries(farmers).flatMap(([fid, f]) => (f.wells || []).map(w => ({ well_id: w.id, farmer_id: fid, label: w.label, lat: w.lat == null ? null : w.lat, lon: w.lon == null ? null : w.lon, village: w.village || '', depth_m: w.depth_m == null ? null : w.depth_m })));
        return json(res, 200, { ok: true, version: 'mock', generated_at: new Date().toISOString(), config: { limits: LIMITS, classes: [0.7, 3], map: { lat: 26.8, lon: 30.8, zoom: 5.3 }, project_name: 'GWS Groundwater Monitoring (mock)' }, wells, farmers: Object.entries(farmers).map(([id, f]) => ({ id, name: f.name, lang: f.lang })), columns: cols, readings: rows });
      }
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
    if (u.pathname === '/__mock/code') {
      const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8').replace("var SHEET_ID = '';", "var SHEET_ID = '" + (u.searchParams.get('sheet') || '') + "';");
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); return res.end(src);
    }
    if (u.pathname === '/__mock/offline') { serverDown = u.searchParams.get('on') === '1'; return json(res, 200, { ok: true, serverDown }); }
    if (u.pathname === '/__mock/seed') {
      const now = Date.now(); let n = 0;
      Object.entries(farmers).forEach(([fid, f], fi) => (f.wells || []).forEach((w, wi) => {
        const base = [0.5, 1.4, 3.6, 2.2, 0.9][(fi * 2 + wi) % 5];
        for (let k = 26; k >= 0; k--) {
          const ts = now - k * 7 * 86400000 - (fi * 3 + wi) * 3600000;
          const ec = +(base * (1 + 0.15 * Math.sin(k / 3) + 0.04 * (k % 3)) + (k < 6 && wi === 0 ? 0.3 * (6 - k) / 6 : 0)).toFixed(2);
          const temp = +(22 + 6 * Math.sin((now - ts) / (365 * 86400000) * 2 * Math.PI)).toFixed(1);
          readings.push({ id: 'seed-' + fid + '-' + w.id + '-' + k, farmer_id: fid, farmer_name: f.name, well_id: w.id, well_label: w.label, ts_local: new Date(ts).toISOString(), ts_epoch: ts, tz: 'Africa/Cairo', ec, ec_unit: 'mS/cm', ec_ms: ec, temp_c: temp, ec25_ms: +(ec / (1 + 0.02 * (temp - 25))).toFixed(4), lat: w.lat ? w.lat + 0.0005 : null, lon: w.lon ? w.lon + 0.0005 : null, acc_m: w.lat ? 8 : null, note: k === 0 ? 'demo' : '', app_version: 'seed', received_at: new Date(ts).toISOString() });
          n++;
        }
      }));
      persist(); res.writeHead(302, { Location: '/__mock/' }); return res.end();
    }
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

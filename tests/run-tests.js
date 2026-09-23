/* Node test runner (no dependencies): node tests/run-tests.js */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

/* ---------- load browser modules in Node ---------- */
function loadSource(file) {
  // Run in the current realm (not vm) so assert.deepStrictEqual works on returned objects.
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
}
const loadBrowserModule = f => loadSource(path.join('app', 'js', f));
const loadGs = () => loadSource(path.join('backend', 'Code.gs'));
const { WP_UTIL: U } = loadBrowserModule('util.js');
const { WP_I18N: I } = loadBrowserModule('i18n.js');
const G = loadGs();

console.log('\nutil.js');
test('normalizeNumber handles Latin digits', () => { assert.strictEqual(U.normalizeNumber('12.5'), 12.5); assert.strictEqual(U.normalizeNumber(' 7 '), 7); });
test('normalizeNumber handles Arabic-Indic digits and ٫ separator', () => { assert.strictEqual(U.normalizeNumber('١٢٫٥'), 12.5); assert.strictEqual(U.normalizeNumber('٣'), 3); });
test('normalizeNumber handles Persian digits and comma', () => { assert.strictEqual(U.normalizeNumber('۲۳,۴'), 23.4); });
test('normalizeNumber rejects garbage', () => { assert(isNaN(U.normalizeNumber('abc'))); assert(isNaN(U.normalizeNumber(''))); assert(isNaN(U.normalizeNumber('1.2.3'))); assert(isNaN(U.normalizeNumber(null))); });
test('normalizeNumber accepts leading dot and negatives', () => { assert.strictEqual(U.normalizeNumber('.5'), 0.5); assert.strictEqual(U.normalizeNumber('-2'), -2); });
test('toMilliSiemens converts units', () => { assert.strictEqual(U.toMilliSiemens(1500, 'µS/cm'), 1.5); assert.strictEqual(U.toMilliSiemens(2, 'dS/m'), 2); assert.strictEqual(U.toMilliSiemens(3, 'mS/cm'), 3); });
test('ec25 compensates linearly', () => { assert.strictEqual(U.ec25(1, 25), 1); assert(Math.abs(U.ec25(1.2, 35) - 1.0) < 1e-9); assert(isNaN(U.ec25(NaN, 20))); });
test('checkRange levels', () => {
  const lim = { softMin: 0.1, softMax: 15, hardMin: 0, hardMax: 100 };
  assert.strictEqual(U.checkRange(5, lim).level, 'ok');
  assert.strictEqual(U.checkRange(20, lim).level, 'soft');
  assert.strictEqual(U.checkRange(0.05, lim).level, 'soft');
  assert.strictEqual(U.checkRange(150, lim).level, 'hard');
  assert.strictEqual(U.checkRange(-1, lim).level, 'hard');
  assert.strictEqual(U.checkRange(NaN, lim).level, 'invalid');
});
test('isBigJump', () => { assert.strictEqual(U.isBigJump(3, 1, 0.5), true); assert.strictEqual(U.isBigJump(1.2, 1, 0.5), false); assert.strictEqual(U.isBigJump(1, 0, 0.5), false); });
test('uuid format and uniqueness', () => { const a = U.uuid(), b = U.uuid(); assert.notStrictEqual(a, b); assert(/^[0-9a-f-]{36}$/.test(a)); });
test('isoLocal has offset', () => { assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(U.isoLocal(new Date()))); });
test('parseEnrollParams parses full link', () => {
  const p = U.parseEnrollParams('?f=f001&n=Ahmed&w=W1:North%20well,W2&l=en&api=http://x/api');
  assert.strictEqual(p.farmerId, 'f001'); assert.strictEqual(p.farmerName, 'Ahmed'); assert.strictEqual(p.lang, 'en');
  assert.deepStrictEqual(p.wells, [{ id: 'W1', label: 'North well' }, { id: 'W2', label: 'W2' }]); assert.strictEqual(p.api, 'http://x/api');
});
test('parseEnrollParams returns null without farmer id', () => { assert.strictEqual(U.parseEnrollParams('?n=x'), null); assert.strictEqual(U.parseEnrollParams(''), null); });
test('parseEnrollParams defaults lang to ar', () => { assert.strictEqual(U.parseEnrollParams('?f=A').lang, 'ar'); });
test('fmtNum trims zeros', () => { assert.strictEqual(U.fmtNum(1.5), '1.5'); assert.strictEqual(U.fmtNum(2), '2'); assert.strictEqual(U.fmtNum(NaN), '–'); });

console.log('\ni18n.js');
test('every key exists in both languages', () => {
  const ar = Object.keys(I.dict.ar), en = Object.keys(I.dict.en);
  const missingEn = ar.filter(k => !en.includes(k)), missingAr = en.filter(k => !ar.includes(k));
  assert.deepStrictEqual(missingEn, [], 'missing in en'); assert.deepStrictEqual(missingAr, [], 'missing in ar');
});
test('no empty strings', () => { ['ar', 'en'].forEach(l => Object.entries(I.dict[l]).forEach(([k, v]) => assert(v && String(v).trim(), l + '.' + k))); });
test('placeholders match between languages', () => {
  Object.keys(I.dict.en).forEach(k => {
    const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
    assert.strictEqual(ph(I.dict.ar[k]), ph(I.dict.en[k]), 'placeholders differ for ' + k);
  });
});
test('t() interpolates and falls back', () => { I.setLang('en'); assert.strictEqual(I.t('sent_partial', { n: 2, t: 5 }), 'Sent 2 of 5'); assert.strictEqual(I.t('nope'), 'nope'); I.setLang('ar'); assert.strictEqual(I.dict.ar.dir, 'rtl'); });
test('index.html only uses known i18n keys', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)].map(m => m[1]);
  const unknown = keys.filter(k => !I.dict.en[k]);
  assert.deepStrictEqual(unknown, []);
});
test('app.js only uses known i18n keys', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'app.js'), 'utf8');
  const keys = [...js.matchAll(/\bt\('([a-z_]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('_'));
  const unknown = [...new Set(keys)].filter(k => !I.dict.en[k]);
  assert.deepStrictEqual(unknown, []);
  ['pending', 'sending', 'sent', 'failed', 'rejected'].forEach(s => assert(I.dict.en['status_' + s] && I.dict.ar['status_' + s]));
});

console.log('\nbackend/Code.gs');
test('computeEc25', () => { assert.strictEqual(G.computeEc25(1, 25), 1); assert.strictEqual(G.computeEc25(1.2, 35), 1); assert.strictEqual(G.computeEc25('x', 1), ''); });
test('validateRecord accepts a good record and flags unusual values', () => {
  assert.deepStrictEqual(G.validateRecord({ id: 'a', farmer_id: 'F', ec_ms: 2, temp_c: 22 }), { ok: true, flag: '' });
  assert.deepStrictEqual(G.validateRecord({ id: 'a', farmer_id: 'F', ec_ms: 30, temp_c: 45 }), { ok: true, flag: 'ec_unusual;temp_unusual' });
});
test('validateRecord rejects bad records', () => {
  assert.strictEqual(G.validateRecord(null).ok, false);
  assert.strictEqual(G.validateRecord({ farmer_id: 'F', ec_ms: 1, temp_c: 20 }).reason, 'missing id');
  assert.strictEqual(G.validateRecord({ id: 'a', ec_ms: 1, temp_c: 20 }).reason, 'missing farmer_id');
  assert.strictEqual(G.validateRecord({ id: 'a', farmer_id: 'F', ec_ms: 'x', temp_c: 20 }).reason, 'invalid ec');
  assert.strictEqual(G.validateRecord({ id: 'a', farmer_id: 'F', ec_ms: 1 }).reason, 'invalid temp');
  assert.strictEqual(G.validateRecord({ id: 'a', farmer_id: 'F', ec_ms: 500, temp_c: 20 }).reason, 'ec out of range');
  assert.strictEqual(G.validateRecord({ id: 'a', farmer_id: 'F', ec_ms: 1, temp_c: 90 }).reason, 'temp out of range');
});
test('validateRecord honours custom limits', () => {
  const lim = G.limitsFromRows([['ec_hard_max', 5], ['temp_soft_max', '35'], ['junk', 'x'], ['ec_soft_min', '']]);
  assert.strictEqual(lim.ec.hardMax, 5); assert.strictEqual(lim.temp.softMax, 35); assert.strictEqual(lim.ec.softMin, 0.1);
  assert.strictEqual(G.validateRecord({ id: 'a', farmer_id: 'F', ec_ms: 6, temp_c: 20 }, lim).reason, 'ec out of range');
});
test('rowFromRecord has HEADERS.length columns and computes ec25', () => {
  const now = new Date('2026-09-22T10:00:00Z');
  const row = G.rowFromRecord({ id: 'a', farmer_id: 'F', ec: 1200, ec_unit: 'µS/cm', ec_ms: 1.2, temp_c: 35, lat: 30.1, lon: 31.2, acc_m: 8, note: 'n', ts_epoch: '123' }, now, 'http://p', 'x');
  assert.strictEqual(row.length, G.HEADERS.length);
  const h = G.HEADERS;
  assert.strictEqual(row[h.indexOf('ec25_ms_cm')], 1); assert.strictEqual(row[h.indexOf('lat')], 30.1); assert.strictEqual(row[h.indexOf('photo_url')], 'http://p');
  assert.strictEqual(row[h.indexOf('flag')], 'x'); assert.strictEqual(row[h.indexOf('ts_epoch')], 123); assert.strictEqual(row[h.indexOf('meter_compensated')], 'unknown');
});
test('rowFromRecord keeps ec as-is when meter is compensated', () => {
  const row = G.rowFromRecord({ id: 'a', farmer_id: 'F', ec: 1.2, ec_ms: 1.2, temp_c: 35, meter_compensated: true }, new Date(), '', '');
  assert.strictEqual(row[G.HEADERS.indexOf('ec25_ms_cm')], 1.2); assert.strictEqual(row[G.HEADERS.indexOf('lat')], '');
});
test('parseWells', () => { assert.deepStrictEqual(G.parseWells('W1:North, W2'), [{ id: 'W1', label: 'North' }, { id: 'W2', label: 'W2' }]); assert.deepStrictEqual(G.parseWells(''), []); });
test('toCsv quotes correctly', () => { assert.strictEqual(G.toCsv([['a', 'b,c', 'd"e'], [1, null, '']]), 'a,"b,c","d""e"\r\n1,,'); });
test('toGeoJson skips rows without coordinates', () => {
  const h = ['id', 'lat', 'lon'];
  const g = G.toGeoJson(h, [['a', 30, 31], ['b', '', ''], ['c', 'x', 1]]);
  assert.strictEqual(g.features.length, 1); assert.deepStrictEqual(g.features[0].geometry.coordinates, [31, 30]); assert.strictEqual(g.features[0].properties.id, 'a');
});

/* Fake Sheet to exercise processSubmit end-to-end */
function fakeSheet(initialRows) {
  const rows = initialRows.slice();
  return {
    rows,
    getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
      setValues: vals => { vals.forEach((v, i) => { rows[r - 1 + i] = v; }); }
    })
  };
}
test('processSubmit inserts, dedupes and rejects', () => {
  const sh = fakeSheet([G.HEADERS]);
  const photos = [];
  const deps = { sheet: sh, limits: G.DEFAULT_LIMITS, savePhoto: r => { if (r.photo) { photos.push(r.id); return 'url:' + r.id; } return ''; }, now: () => 'T' };
  const recs = [
    { id: 'r1', farmer_id: 'F', ec: 1, ec_unit: 'mS/cm', ec_ms: 1, temp_c: 20 },
    { id: 'r2', farmer_id: 'F', ec: 2, ec_unit: 'mS/cm', ec_ms: 2, temp_c: 21, photo: 'data:image/jpeg;base64,AAAA' },
    { id: 'r1', farmer_id: 'F', ec: 1, ec_unit: 'mS/cm', ec_ms: 1, temp_c: 20 },       // duplicate within batch
    { id: 'r3', farmer_id: 'F', ec: 999, ec_unit: 'mS/cm', ec_ms: 999, temp_c: 20 }    // rejected
  ];
  const out = G.processSubmit(recs, deps);
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.results.map(x => x.status), ['inserted', 'inserted', 'duplicate', 'rejected']);
  assert.strictEqual(out.results[1].photo_url, 'url:r2'); assert.deepStrictEqual(photos, ['r2']);
  assert.strictEqual(sh.rows.length, 3);
  // Re-sending the same batch inserts nothing new
  const out2 = G.processSubmit(recs.slice(0, 2), deps);
  assert.deepStrictEqual(out2.results.map(x => x.status), ['duplicate', 'duplicate']);
  assert.strictEqual(sh.rows.length, 3);
});
test('processSubmit rejects non-array and oversized batches', () => {
  const deps = { sheet: fakeSheet([G.HEADERS]), limits: G.DEFAULT_LIMITS, savePhoto: () => '', now: () => 'T' };
  assert.strictEqual(G.processSubmit('x', deps).ok, false);
  assert.strictEqual(G.processSubmit(new Array(201).fill({}), deps).ok, false);
});

console.log('\nbackend/Code.gs – dashboard & wells');
test('configFromRows returns limits and dashboard settings with overrides', () => {
  const c = G.configFromRows([['class_1_max', 1], ['map_center_lat', '30.5'], ['project_name', 'Test GWS'], ['ec_hard_max', 50], ['bogus', 9], ['map_zoom', '']]);
  assert.strictEqual(c.dash.class1Max, 1); assert.strictEqual(c.dash.class2Max, 3); assert.strictEqual(c.dash.mapLat, 30.5); assert.strictEqual(c.dash.mapZoom, G.DEFAULT_DASH.mapZoom);
  assert.strictEqual(c.dash.projectName, 'Test GWS'); assert.strictEqual(c.limits.ec.hardMax, 50);
});
test('wellsFromRows parses coordinates and skips blank rows', () => {
  const w = G.wellsFromRows([['W1', 'F001', 'North', 30.1, 31.2, 'Village', 45, '', ''], ['W2', 'F001', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '', '']]);
  assert.strictEqual(w.length, 2); assert.deepStrictEqual([w[0].lat, w[0].lon, w[0].depth_m], [30.1, 31.2, 45]); assert.strictEqual(w[1].label, 'W2'); assert.strictEqual(w[1].lat, null); assert.strictEqual(w[1].depth_m, null);
});
test('compactReadings maps by header, filters by since and sorts by time', () => {
  const H = G.HEADERS; const row = v => H.map(h => v[h] === undefined ? '' : v[h]);
  const rows = [row({ id: 'b', farmer_id: 'F', well_id: 'W', ts_epoch: 200, ec_ms_cm: 2, ec25_ms_cm: 2.1, temp_c: 20, lat: 30, lon: 31, flag: 'x' }), row({ id: 'a', farmer_id: 'F', well_id: 'W', ts_epoch: 100, ec_ms_cm: 1, ec25_ms_cm: '', temp_c: 21 }), row({ id: 'c', farmer_id: 'F', well_id: 'W', ts_epoch: '' })];
  const out = G.compactReadings(H, rows, 0);
  assert.strictEqual(out.length, 2); assert.strictEqual(out[0][0], 'a'); assert.strictEqual(out[1][0], 'b');
  const ix = {}; G.DATA_COLUMNS.forEach((c, i) => { ix[c] = i; });
  assert.strictEqual(out[1][ix.ec25], 2.1); assert.strictEqual(out[0][ix.ec25], null); assert.strictEqual(out[1][ix.lat], 30); assert.strictEqual(out[0][ix.lat], null);
  assert.strictEqual(G.compactReadings(H, rows, 150).length, 1);
});
test('planWellUpserts appends unknown wells and fills missing coordinates only', () => {
  const wellRows = [['W1', 'F001', 'North', '', '', '', '', '', ''], ['W2', 'F001', 'South', 30, 31, '', '', '', '']];
  const recs = [{ well_id: 'W1', farmer_id: 'F001', lat: 30.1, lon: 31.1 }, { well_id: 'W2', farmer_id: 'F001', lat: 1, lon: 1 }, { well_id: 'W3', farmer_id: 'F002', well_label: 'New', lat: 29, lon: 32 }, { well_id: 'W3', farmer_id: 'F002', lat: 29.5, lon: 32.5 }, { well_id: 'W4', farmer_id: 'F002', lat: null, lon: null }];
  const plan = G.planWellUpserts(wellRows, recs, 'T');
  assert.deepStrictEqual(plan.update, [{ rowIndex: 0, lat: 30.1, lon: 31.1 }]);
  assert.strictEqual(plan.append.length, 1); assert.deepStrictEqual(plan.append[0].slice(0, 5), ['W3', 'F002', 'New', 29, 32]); assert.strictEqual(plan.append[0].length, G.WELL_HEADERS.length);
});
test('processSubmit calls afterInsert only with newly inserted records', () => {
  const sh = fakeSheet([G.HEADERS]); let got = null;
  const deps = { sheet: sh, limits: G.DEFAULT_LIMITS, savePhoto: () => '', now: () => 'T', afterInsert: recs => { got = recs.map(r => r.id); } };
  G.processSubmit([{ id: 'n1', farmer_id: 'F', ec_ms: 1, temp_c: 20, well_id: 'W', lat: 30, lon: 31 }, { id: 'n2', farmer_id: 'F', ec_ms: 999, temp_c: 20 }], deps);
  assert.deepStrictEqual(got, ['n1']);
  got = null; G.processSubmit([{ id: 'n1', farmer_id: 'F', ec_ms: 1, temp_c: 20 }], deps); assert.strictEqual(got, null);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

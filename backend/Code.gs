/**
 * WellPulse GWS – Google Apps Script backend.
 *
 * Deploy as a Web App:  Execute as "Me", Who has access "Anyone".
 * Run setup() once to create the sheets. Optionally set GCS_BUCKET and run installNightlyTrigger().
 *
 * Endpoints:
 *   POST {action:'submit', token, records:[...]}      -> {ok, results:[{id, ok, status, reason?, photo_url?}]}   (farmer app)
 *   GET  ?action=config&token=..&f=FARMER_ID           -> {ok, limits, farmer:{id,name,wells:[{id,label}],lang}} (farmer app)
 *   GET  ?action=ping&token=..                         -> {ok, version, count}
 *   GET  ?action=data&key=VIEWER_KEY[&since=epoch_ms]  -> {ok, config, wells, farmers, columns, readings}      (dashboard)
 */

var TOKEN = 'gws-2026';                 // must match API_TOKEN in app/js/config.js (farmer app)
var VIEWER_KEY = 'atlas-7q2m9x';        // read-only key for the researcher dashboard (share the dashboard link with ?key=...)
var SHEET_ID = '';                      // only needed when this script is NOT bound to the sheet (standalone project)
var VERSION = '1.1.0';
var SHEET_READINGS = 'Readings';
var SHEET_FARMERS = 'Farmers';
var SHEET_WELLS = 'Wells';
var SHEET_CONFIG = 'Config';
var SHEET_LOG = 'Log';
var PHOTO_FOLDER_NAME = 'WellPulse Photos';
var GCS_BUCKET = '';                    // e.g. 'my-gee-bucket' (leave empty to disable export)
var GCS_PREFIX = 'wellpulse/';
var EC_TEMP_COEFF = 0.02;               // 2 % per °C, linear compensation to 25 °C

var HEADERS = ['received_at', 'id', 'farmer_id', 'farmer_name', 'well_id', 'well_label', 'ts_local', 'ts_epoch', 'tz',
  'ec', 'ec_unit', 'ec_ms_cm', 'temp_c', 'ec25_ms_cm', 'meter_compensated', 'lat', 'lon', 'acc_m', 'note', 'photo_url',
  'app_version', 'device', 'lang', 'flag'];
var WELL_HEADERS = ['well_id', 'farmer_id', 'label', 'lat', 'lon', 'village', 'depth_m', 'notes', 'updated_at'];

var DEFAULT_LIMITS = {
  ec: { softMin: 0.1, softMax: 15, hardMin: 0, hardMax: 100 },
  temp: { softMin: 10, softMax: 40, hardMin: -5, hardMax: 60 }
};
// Defaults for the dashboard: FAO irrigation-water salinity classes (mS/cm) and map start view (Egypt).
var DEFAULT_DASH = { class1Max: 0.7, class2Max: 3.0, mapLat: 26.8, mapLon: 30.8, mapZoom: 5.3, projectName: 'GWS-SENCE Groundwater Monitoring' };

/* ============================ pure helpers (unit-tested) ============================ */

function computeEc25(ecMs, tempC, coeff) {
  var a = coeff === undefined ? EC_TEMP_COEFF : coeff;
  if (typeof ecMs !== 'number' || typeof tempC !== 'number' || isNaN(ecMs) || isNaN(tempC)) return '';
  return Math.round(ecMs / (1 + a * (tempC - 25)) * 10000) / 10000;
}

/** Returns {ok:true, flag:''|'…'} or {ok:false, reason}. */
function validateRecord(r, limits) {
  var L = limits || DEFAULT_LIMITS;
  if (!r || typeof r !== 'object') return { ok: false, reason: 'invalid record' };
  if (!r.id || typeof r.id !== 'string' || r.id.length > 64) return { ok: false, reason: 'missing id' };
  if (!r.farmer_id) return { ok: false, reason: 'missing farmer_id' };
  var ec = Number(r.ec_ms), tc = Number(r.temp_c);
  if (r.ec_ms === undefined || r.ec_ms === null || r.ec_ms === '' || isNaN(ec)) return { ok: false, reason: 'invalid ec' };
  if (r.temp_c === undefined || r.temp_c === null || r.temp_c === '' || isNaN(tc)) return { ok: false, reason: 'invalid temp' };
  if (ec < L.ec.hardMin || ec > L.ec.hardMax) return { ok: false, reason: 'ec out of range' };
  if (tc < L.temp.hardMin || tc > L.temp.hardMax) return { ok: false, reason: 'temp out of range' };
  var flag = '';
  if (ec < L.ec.softMin || ec > L.ec.softMax) flag = 'ec_unusual';
  if (tc < L.temp.softMin || tc > L.temp.softMax) flag = flag ? flag + ';temp_unusual' : 'temp_unusual';
  return { ok: true, flag: flag };
}

function rowFromRecord(r, receivedAt, photoUrl, flag) {
  var ec = Number(r.ec_ms), tc = Number(r.temp_c);
  var ec25 = r.meter_compensated === true ? ec : computeEc25(ec, tc);
  return [
    receivedAt, r.id, r.farmer_id, r.farmer_name || '', r.well_id || '', r.well_label || '', r.ts_local || '', Number(r.ts_epoch) || '',
    r.tz || '', Number(r.ec), r.ec_unit || '', ec, tc, ec25, r.meter_compensated === true ? 'yes' : (r.meter_compensated === false ? 'no' : 'unknown'),
    r.lat === null || r.lat === undefined ? '' : Number(r.lat), r.lon === null || r.lon === undefined ? '' : Number(r.lon),
    r.acc_m === null || r.acc_m === undefined ? '' : Number(r.acc_m), (r.note || '').toString().slice(0, 200), photoUrl || '',
    r.app_version || '', (r.device || '').toString().slice(0, 120), r.lang || '', flag || ''
  ];
}

/** "W1:North well, W2:South well" -> [{id,label}] */
function parseWells(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
    var parts = x.split(':');
    return { id: parts[0].trim(), label: (parts[1] || parts[0]).trim() };
  });
}

/** Config sheet rows [key, value] -> { limits, dash }. Unknown keys are ignored; blanks keep defaults. */
function configFromRows(rows) {
  var L = JSON.parse(JSON.stringify(DEFAULT_LIMITS));
  var D = JSON.parse(JSON.stringify(DEFAULT_DASH));
  var map = { ec_soft_min: ['ec', 'softMin'], ec_soft_max: ['ec', 'softMax'], ec_hard_min: ['ec', 'hardMin'], ec_hard_max: ['ec', 'hardMax'],
    temp_soft_min: ['temp', 'softMin'], temp_soft_max: ['temp', 'softMax'], temp_hard_min: ['temp', 'hardMin'], temp_hard_max: ['temp', 'hardMax'] };
  var dmap = { class_1_max: 'class1Max', class_2_max: 'class2Max', map_center_lat: 'mapLat', map_center_lon: 'mapLon', map_zoom: 'mapZoom' };
  (rows || []).forEach(function (row) {
    var k = String(row[0] || '').trim(), raw = row[1], v = Number(raw);
    if (raw === '' || raw === null || raw === undefined) return;
    if (map[k] && !isNaN(v)) L[map[k][0]][map[k][1]] = v;
    else if (dmap[k] && !isNaN(v)) D[dmap[k]] = v;
    else if (k === 'project_name') D.projectName = String(raw);
  });
  return { limits: L, dash: D };
}
function limitsFromRows(rows) { return configFromRows(rows).limits; }

/** Wells sheet rows (without header) -> [{well_id, farmer_id, label, lat, lon, village, depth_m}] */
function wellsFromRows(rows) {
  return (rows || []).filter(function (r) { return r[0] !== '' && r[0] !== null && r[0] !== undefined; }).map(function (r) {
    var lat = Number(r[3]), lon = Number(r[4]);
    return { well_id: String(r[0]).trim(), farmer_id: String(r[1] || '').trim(), label: String(r[2] || r[0]).trim(),
      lat: r[3] === '' || isNaN(lat) ? null : lat, lon: r[4] === '' || isNaN(lon) ? null : lon,
      village: String(r[5] || ''), depth_m: r[6] === '' || r[6] === undefined || isNaN(Number(r[6])) ? null : Number(r[6]) };
  });
}

/** Columns of the compact readings array sent to the dashboard. */
var DATA_COLUMNS = ['id', 'farmer_id', 'farmer_name', 'well_id', 'well_label', 'ts_epoch', 'ec_ms', 'ec25', 'temp_c', 'lat', 'lon', 'flag', 'note', 'photo_url'];

/** Readings sheet rows (with header row first) -> compact arrays for the dashboard; since filters by ts_epoch. */
function compactReadings(headerRow, rows, since) {
  var idx = {}; headerRow.forEach(function (h, i) { idx[h] = i; });
  var out = [];
  rows.forEach(function (r) {
    var ts = Number(r[idx.ts_epoch]);
    if (!ts || (since && ts < since)) return;
    var num = function (k) { var v = r[idx[k]]; return v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v); };
    out.push([String(r[idx.id]), String(r[idx.farmer_id]), String(r[idx.farmer_name] || ''), String(r[idx.well_id] || ''), String(r[idx.well_label] || ''),
      ts, num('ec_ms_cm'), num('ec25_ms_cm'), num('temp_c'), num('lat'), num('lon'), String(r[idx.flag] || ''), String(r[idx.note] || ''), String(r[idx.photo_url] || '')]);
  });
  out.sort(function (a, b) { return a[5] - b[5]; });
  return out;
}

/**
 * Given existing wells and newly inserted records, decide which Wells rows to append or update with coordinates.
 * Returns { append: [[...]], update: [{rowIndex, lat, lon}] }. rowIndex is 0-based within the data rows.
 */
function planWellUpserts(wellRows, records, now) {
  var byKey = {};
  wellRows.forEach(function (r, i) { byKey[String(r[0]).trim() + '|' + String(r[1] || '').trim()] = { i: i, lat: r[3], lon: r[4] }; });
  var append = [], update = [], seen = {};
  records.forEach(function (r) {
    if (!r.well_id || r.lat === null || r.lat === undefined || r.lon === null || r.lon === undefined || r.lat === '' || r.lon === '') return;
    var key = String(r.well_id).trim() + '|' + String(r.farmer_id || '').trim();
    if (seen[key]) return; seen[key] = true;
    var w = byKey[key];
    if (!w) append.push([r.well_id, r.farmer_id || '', r.well_label || r.well_id, Number(r.lat), Number(r.lon), '', '', 'auto from app GPS', now]);
    else if (w.lat === '' || w.lat === null || w.lat === undefined) update.push({ rowIndex: w.i, lat: Number(r.lat), lon: Number(r.lon) });
  });
  return { append: append, update: update };
}

function toCsv(rows) {
  return rows.map(function (row) {
    return row.map(function (v) {
      var s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\r\n');
}

function toGeoJson(headers, rows) {
  var iLat = headers.indexOf('lat'), iLon = headers.indexOf('lon');
  var features = [];
  rows.forEach(function (row) {
    var lat = Number(row[iLat]), lon = Number(row[iLon]);
    if (row[iLat] === '' || row[iLon] === '' || isNaN(lat) || isNaN(lon)) return;
    var props = {};
    headers.forEach(function (h, i) { props[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]; });
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props });
  });
  return { type: 'FeatureCollection', features: features };
}

/* ============================ Google-side glue ============================ */

function ss() { return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }
function sheet(name) { var s = ss().getSheetByName(name); if (!s) throw new Error('Missing sheet ' + name + ' – run setup()'); return s; }

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getConfig() {
  var s = ss().getSheetByName(SHEET_CONFIG);
  if (!s || s.getLastRow() < 2) return configFromRows([]);
  return configFromRows(s.getRange(2, 1, s.getLastRow() - 1, 2).getValues());
}
function getLimits() { return getConfig().limits; }

function getFarmerRows() {
  var s = ss().getSheetByName(SHEET_FARMERS);
  if (!s || s.getLastRow() < 2) return [];
  return s.getRange(2, 1, s.getLastRow() - 1, 4).getValues();
}

function getFarmer(id) {
  if (!id) return null;
  var rows = getFarmerRows();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === String(id).trim().toUpperCase()) {
      return { id: String(rows[i][0]).trim(), name: String(rows[i][1] || ''), wells: parseWells(rows[i][2]), lang: String(rows[i][3] || 'ar') };
    }
  }
  return null;
}

function getWellRows() {
  var s = ss().getSheetByName(SHEET_WELLS);
  if (!s || s.getLastRow() < 2) return [];
  return s.getRange(2, 1, s.getLastRow() - 1, WELL_HEADERS.length).getValues();
}

function existingIds(readingsSheet) {
  var n = readingsSheet.getLastRow();
  var set = {};
  if (n < 2) return set;
  readingsSheet.getRange(2, 2, n - 1, 1).getValues().forEach(function (r) { if (r[0]) set[String(r[0])] = true; });
  return set;
}

function photoFolder() {
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
}

function savePhoto(r) {
  if (!r.photo || typeof r.photo !== 'string') return '';
  var m = r.photo.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) return '';
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], r.id + (m[1] === 'image/png' ? '.png' : '.jpg'));
  var file = photoFolder().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function log(msg) {
  try { var s = ss().getSheetByName(SHEET_LOG); if (s) s.appendRow([new Date(), String(msg).slice(0, 500)]); } catch (e) { /* ignore */ }
}

/** Fill the Wells registry with coordinates from readings that carried GPS (never blocks a submit). */
function upsertWellCoords(insertedRecords) {
  try {
    var s = ss().getSheetByName(SHEET_WELLS);
    if (!s) return;
    var plan = planWellUpserts(getWellRows(), insertedRecords, new Date());
    plan.update.forEach(function (u) { s.getRange(u.rowIndex + 2, 4, 1, 2).setValues([[u.lat, u.lon]]); s.getRange(u.rowIndex + 2, 9).setValue(new Date()); });
    if (plan.append.length) s.getRange(s.getLastRow() + 1, 1, plan.append.length, WELL_HEADERS.length).setValues(plan.append);
  } catch (e) { log('upsertWellCoords: ' + e); }
}

/** Core submit logic; deps allows tests to inject sheet/photo functions. */
function processSubmit(records, deps) {
  var d = deps || { sheet: sheet(SHEET_READINGS), limits: getLimits(), savePhoto: savePhoto, now: function () { return new Date(); }, afterInsert: upsertWellCoords };
  var results = [];
  if (!Array.isArray(records)) return { ok: false, error: 'records must be an array' };
  if (records.length > 200) return { ok: false, error: 'too many records' };
  var ids = existingIds(d.sheet);
  var rows = [], inserted = [];
  records.forEach(function (r) {
    var v = validateRecord(r, d.limits);
    if (!v.ok) { results.push({ id: r && r.id, ok: false, status: 'rejected', reason: v.reason }); return; }
    if (ids[r.id]) { results.push({ id: r.id, ok: true, status: 'duplicate' }); return; }
    var photoUrl = '';
    try { photoUrl = d.savePhoto(r); } catch (e) { photoUrl = ''; }
    rows.push(rowFromRecord(r, d.now(), photoUrl, v.flag));
    inserted.push(r);
    ids[r.id] = true;
    results.push({ id: r.id, ok: true, status: 'inserted', photo_url: photoUrl });
  });
  if (rows.length) {
    var start = d.sheet.getLastRow() + 1;
    d.sheet.getRange(start, 1, rows.length, HEADERS.length).setValues(rows);
    if (d.afterInsert) d.afterInsert(inserted);
  }
  return { ok: true, results: results };
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return jsonOut({ ok: false, error: 'bad json' }); }
  if (!body || body.token !== TOKEN) return jsonOut({ ok: false, error: 'bad token' });
  if (body.action !== 'submit') return jsonOut({ ok: false, error: 'unknown action' });
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var out = processSubmit(body.records);
    return jsonOut(out);
  } catch (err) {
    log('doPost error: ' + err);
    return jsonOut({ ok: false, error: String(err) });
  } finally { try { lock.releaseLock(); } catch (e2) { /* ignore */ } }
}

/** Dashboard payload: config + wells + farmers + compact readings. */
function buildDataPayload(since) {
  var cfg = getConfig();
  var rs = sheet(SHEET_READINGS);
  var n = rs.getLastRow();
  var values = n >= 1 ? rs.getRange(1, 1, n, HEADERS.length).getValues() : [HEADERS];
  var farmers = getFarmerRows().map(function (r) { return { id: String(r[0]).trim(), name: String(r[1] || ''), lang: String(r[3] || 'ar') }; }).filter(function (f) { return f.id; });
  return {
    ok: true, version: VERSION, generated_at: new Date().toISOString(),
    config: { limits: cfg.limits, classes: [cfg.dash.class1Max, cfg.dash.class2Max], map: { lat: cfg.dash.mapLat, lon: cfg.dash.mapLon, zoom: cfg.dash.mapZoom }, project_name: cfg.dash.projectName },
    wells: wellsFromRows(getWellRows()), farmers: farmers,
    columns: DATA_COLUMNS, readings: compactReadings(values[0], values.slice(1), since ? Number(since) : 0)
  };
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'data') {
    if (p.key !== VIEWER_KEY) return jsonOut({ ok: false, error: 'bad key' });
    try { return jsonOut(buildDataPayload(p.since)); } catch (err) { log('data error: ' + err); return jsonOut({ ok: false, error: String(err) }); }
  }
  if (p.token !== TOKEN) return jsonOut({ ok: false, error: 'bad token' });
  if (p.action === 'config') return jsonOut({ ok: true, limits: getLimits(), farmer: getFarmer(p.f) });
  var n = 0; try { n = Math.max(0, sheet(SHEET_READINGS).getLastRow() - 1); } catch (err) { /* not set up */ }
  return jsonOut({ ok: true, version: VERSION, count: n });
}

/* ============================ one-time setup (safe to re-run) ============================ */

function setup() {
  var s = ss();
  var r = s.getSheetByName(SHEET_READINGS) || s.insertSheet(SHEET_READINGS);
  if (r.getLastRow() === 0) { r.appendRow(HEADERS); r.setFrozenRows(1); r.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold'); }
  var f = s.getSheetByName(SHEET_FARMERS) || s.insertSheet(SHEET_FARMERS);
  if (f.getLastRow() === 0) {
    f.appendRow(['farmer_id', 'name', 'wells (id:label, id:label)', 'lang']);
    f.appendRow(['F001', 'Example Farmer', 'W1:North well, W2:South well', 'ar']);
    f.setFrozenRows(1); f.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  var w = s.getSheetByName(SHEET_WELLS) || s.insertSheet(SHEET_WELLS);
  if (w.getLastRow() === 0) { w.appendRow(WELL_HEADERS); w.setFrozenRows(1); w.getRange(1, 1, 1, WELL_HEADERS.length).setFontWeight('bold'); }
  var c = s.getSheetByName(SHEET_CONFIG) || s.insertSheet(SHEET_CONFIG);
  if (c.getLastRow() === 0) { c.appendRow(['key', 'value', 'description']); c.setFrozenRows(1); c.getRange(1, 1, 1, 3).setFontWeight('bold'); }
  var existing = {};
  if (c.getLastRow() > 1) c.getRange(2, 1, c.getLastRow() - 1, 1).getValues().forEach(function (x) { existing[String(x[0]).trim()] = true; });
  [
    ['ec_soft_min', 0.1, 'EC (mS/cm) below this asks the farmer to confirm'],
    ['ec_soft_max', 15, 'EC (mS/cm) above this asks the farmer to confirm'],
    ['ec_hard_min', 0, 'EC (mS/cm) below this is rejected'],
    ['ec_hard_max', 100, 'EC (mS/cm) above this is rejected'],
    ['temp_soft_min', 10, 'Temp (°C) below this asks the farmer to confirm'],
    ['temp_soft_max', 40, 'Temp (°C) above this asks the farmer to confirm'],
    ['temp_hard_min', -5, 'Temp (°C) below this is rejected'],
    ['temp_hard_max', 60, 'Temp (°C) above this is rejected'],
    ['class_1_max', 0.7, 'Dashboard: EC25 (mS/cm) up to this = low salinity (FAO: no restriction)'],
    ['class_2_max', 3, 'Dashboard: EC25 up to this = moderate (FAO: slight to moderate); above = high (severe)'],
    ['map_center_lat', 26.8, 'Dashboard: map start latitude'],
    ['map_center_lon', 30.8, 'Dashboard: map start longitude'],
    ['map_zoom', 5.3, 'Dashboard: map start zoom'],
    ['project_name', 'GWS-SENCE Groundwater Monitoring', 'Dashboard: project title shown in the header']
  ].forEach(function (row) { if (!existing[row[0]]) c.appendRow(row); });
  var l = s.getSheetByName(SHEET_LOG) || s.insertSheet(SHEET_LOG);
  if (l.getLastRow() === 0) l.appendRow(['time', 'message']);
  var first = s.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && s.getSheets().length > 1) s.deleteSheet(first);
  photoFolder();
  Logger.log('Setup complete.');
}

/* ============================ one-off imports (run from the editor) ============================ */

// Rows to import: [farmer_id, farmer_name, lang, well_id, well_label, lat, lon, village, depth_m]
var IMPORT_ROWS = [
  ['SEKEM', 'SEKEM Farm', 'en', 'SK1_G', 'SK1_G', 30.41901, 31.63744, 'Belbeis', '']
];

/** Upserts IMPORT_ROWS into the Farmers and Wells tabs (safe to re-run; existing coordinates are kept unless blank). */
function importWellsFromCode() {
  var s = ss();
  var f = s.getSheetByName(SHEET_FARMERS), w = s.getSheetByName(SHEET_WELLS);
  if (!f || !w) throw new Error('Run setup() first');
  var farmers = f.getLastRow() > 1 ? f.getRange(2, 1, f.getLastRow() - 1, 4).getValues() : [];
  var wells = getWellRows();
  var fIndex = {}; farmers.forEach(function (r, i) { fIndex[String(r[0]).trim().toUpperCase()] = i; });
  var wIndex = {}; wells.forEach(function (r, i) { wIndex[String(r[0]).trim() + '|' + String(r[1]).trim()] = i; });
  var now = new Date(), added = 0;
  IMPORT_ROWS.forEach(function (r) {
    var fid = String(r[0]).trim(), wid = String(r[3]).trim(), label = r[4] || wid;
    if (fIndex[fid.toUpperCase()] === undefined) { f.appendRow([fid, r[1] || fid, wid + ':' + label, r[2] || 'ar']); fIndex[fid.toUpperCase()] = farmers.length; farmers.push([fid, r[1], wid + ':' + label, r[2]]); }
    else {
      var row = fIndex[fid.toUpperCase()] + 2, cur = String(f.getRange(row, 3).getValue() || '');
      if (cur.split(',').map(function (x) { return x.split(':')[0].trim(); }).indexOf(wid) < 0) f.getRange(row, 3).setValue(cur ? cur + ', ' + wid + ':' + label : wid + ':' + label);
    }
    var key = wid + '|' + fid;
    if (wIndex[key] === undefined) { w.appendRow([wid, fid, label, r[5], r[6], r[7] || '', r[8] || '', 'imported', now]); wIndex[key] = wells.length; wells.push([wid, fid, label, r[5], r[6]]); added++; }
    else if (wells[wIndex[key]][3] === '' && r[5] !== '') w.getRange(wIndex[key] + 2, 4, 1, 2).setValues([[r[5], r[6]]]);
  });
  Logger.log('Import done, wells added: ' + added);
}

/** Utility: set one key in the Config tab (adds the row if missing). Edit PROJECT_NAME_FIX and run fixProjectName() from the editor. */
var PROJECT_NAME_FIX = 'GWS-SENCE Groundwater Monitoring';
function setConfigValue(key, value) {
  var c = sheet(SHEET_CONFIG);
  var n = c.getLastRow();
  var keys = n > 1 ? c.getRange(2, 1, n - 1, 1).getValues() : [];
  for (var i = 0; i < keys.length; i++) { if (String(keys[i][0]).trim() === key) { c.getRange(i + 2, 2).setValue(value); return 'updated ' + key; } }
  c.appendRow([key, value, '']); return 'added ' + key;
}
function fixProjectName() { Logger.log(setConfigValue('project_name', PROJECT_NAME_FIX)); }

/* ============================ export to Cloud Storage / GEE ============================ */

function readAll() {
  var s = sheet(SHEET_READINGS);
  var n = s.getLastRow();
  if (n < 2) return { headers: HEADERS, rows: [] };
  var values = s.getRange(1, 1, n, HEADERS.length).getValues();
  return { headers: values[0], rows: values.slice(1) };
}

function gcsUpload(objectName, content, mime) {
  var url = 'https://storage.googleapis.com/upload/storage/v1/b/' + encodeURIComponent(GCS_BUCKET) + '/o?uploadType=media&name=' + encodeURIComponent(objectName);
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: mime, payload: content, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  if (res.getResponseCode() >= 300) throw new Error('GCS upload failed ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return 'gs://' + GCS_BUCKET + '/' + objectName;
}

/** Writes readings.csv and readings.geojson to the bucket (for Earth Engine ingestion). */
function exportToBucket() {
  if (!GCS_BUCKET) { log('exportToBucket skipped: GCS_BUCKET not set'); return; }
  var data = readAll();
  var csv = toCsv([data.headers].concat(data.rows));
  var geo = JSON.stringify(toGeoJson(data.headers, data.rows));
  var a = gcsUpload(GCS_PREFIX + 'readings.csv', csv, 'text/csv');
  var b = gcsUpload(GCS_PREFIX + 'readings.geojson', geo, 'application/geo+json');
  log('Exported ' + data.rows.length + ' rows to ' + a + ' and ' + b);
}

function installNightlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'exportToBucket') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('exportToBucket').timeBased().everyDays(1).atHour(2).create();
  Logger.log('Nightly export trigger installed (02:00 script time zone).');
}

// Export pure functions for Node-based tests (ignored by Apps Script).
if (typeof module !== 'undefined') {
  module.exports = { computeEc25, validateRecord, rowFromRecord, parseWells, limitsFromRows, configFromRows, wellsFromRows, compactReadings,
    planWellUpserts, toCsv, toGeoJson, processSubmit, existingIds, HEADERS, WELL_HEADERS, DATA_COLUMNS, DEFAULT_LIMITS, DEFAULT_DASH };
}

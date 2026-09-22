/**
 * WellPulse GWS – Google Apps Script backend.
 *
 * Deploy as a Web App:  Execute as "Me", Who has access "Anyone".
 * Run setup() once to create the sheets. Optionally set GCS_BUCKET and run installNightlyTrigger().
 *
 * Endpoints (the app calls these):
 *   POST {action:'submit', token, records:[...]}   -> {ok, results:[{id, ok, status, reason?, photo_url?}]}
 *   GET  ?action=config&token=..&f=FARMER_ID        -> {ok, limits, farmer:{id,name,wells:[{id,label}],lang}}
 *   GET  ?action=ping&token=..                      -> {ok, version, count}
 */

var TOKEN = 'gws-2026';                 // must match API_TOKEN in app/js/config.js
var SHEET_ID = '';                      // only needed when this script is NOT bound to the sheet (standalone project)
var VERSION = '1.0.0';
var SHEET_READINGS = 'Readings';
var SHEET_FARMERS = 'Farmers';
var SHEET_CONFIG = 'Config';
var SHEET_LOG = 'Log';
var PHOTO_FOLDER_NAME = 'WellPulse Photos';
var GCS_BUCKET = '';                    // e.g. 'my-gee-bucket' (leave empty to disable export)
var GCS_PREFIX = 'wellpulse/';
var EC_TEMP_COEFF = 0.02;               // 2 % per °C, linear compensation to 25 °C

var HEADERS = ['received_at', 'id', 'farmer_id', 'farmer_name', 'well_id', 'well_label', 'ts_local', 'ts_epoch', 'tz',
  'ec', 'ec_unit', 'ec_ms_cm', 'temp_c', 'ec25_ms_cm', 'meter_compensated', 'lat', 'lon', 'acc_m', 'note', 'photo_url',
  'app_version', 'device', 'lang', 'flag'];

var DEFAULT_LIMITS = {
  ec: { softMin: 0.1, softMax: 15, hardMin: 0, hardMax: 100 },
  temp: { softMin: 10, softMax: 40, hardMin: -5, hardMax: 60 }
};

/* ============================ pure helpers (unit-tested) ============================ */

function computeEc25(ecMs, tempC, coeff) {
  var a = coeff === undefined ? EC_TEMP_COEFF : coeff;
  if (typeof ecMs !== 'number' || typeof tempC !== 'number' || isNaN(ecMs) || isNaN(tempC)) return '';
  return Math.round(ecMs / (1 + a * (tempC - 25)) * 10000) / 10000;
}

/** Returns {ok:true, flag:''|'soft'} or {ok:false, reason}. */
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

/** Limits from Config sheet rows [key, value]; falls back to defaults. */
function limitsFromRows(rows) {
  var L = JSON.parse(JSON.stringify(DEFAULT_LIMITS));
  var map = { ec_soft_min: ['ec', 'softMin'], ec_soft_max: ['ec', 'softMax'], ec_hard_min: ['ec', 'hardMin'], ec_hard_max: ['ec', 'hardMax'],
    temp_soft_min: ['temp', 'softMin'], temp_soft_max: ['temp', 'softMax'], temp_hard_min: ['temp', 'hardMin'], temp_hard_max: ['temp', 'hardMax'] };
  (rows || []).forEach(function (row) {
    var k = String(row[0] || '').trim(), v = Number(row[1]);
    if (map[k] && row[1] !== '' && !isNaN(v)) L[map[k][0]][map[k][1]] = v;
  });
  return L;
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

function getLimits() {
  var s = ss().getSheetByName(SHEET_CONFIG);
  if (!s || s.getLastRow() < 2) return DEFAULT_LIMITS;
  return limitsFromRows(s.getRange(2, 1, s.getLastRow() - 1, 2).getValues());
}

function getFarmer(id) {
  var s = ss().getSheetByName(SHEET_FARMERS);
  if (!s || s.getLastRow() < 2 || !id) return null;
  var rows = s.getRange(2, 1, s.getLastRow() - 1, 4).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === String(id).trim().toUpperCase()) {
      return { id: String(rows[i][0]).trim(), name: String(rows[i][1] || ''), wells: parseWells(rows[i][2]), lang: String(rows[i][3] || 'ar') };
    }
  }
  return null;
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

/** Core submit logic; `deps` allows tests to inject sheet/photo functions. */
function processSubmit(records, deps) {
  var d = deps || { sheet: sheet(SHEET_READINGS), limits: getLimits(), savePhoto: savePhoto, now: function () { return new Date(); } };
  var results = [];
  if (!Array.isArray(records)) return { ok: false, error: 'records must be an array' };
  if (records.length > 200) return { ok: false, error: 'too many records' };
  var ids = existingIds(d.sheet);
  var rows = [];
  records.forEach(function (r) {
    var v = validateRecord(r, d.limits);
    if (!v.ok) { results.push({ id: r && r.id, ok: false, status: 'rejected', reason: v.reason }); return; }
    if (ids[r.id]) { results.push({ id: r.id, ok: true, status: 'duplicate' }); return; }
    var photoUrl = '';
    try { photoUrl = d.savePhoto(r); } catch (e) { photoUrl = ''; }
    rows.push(rowFromRecord(r, d.now(), photoUrl, v.flag));
    ids[r.id] = true;
    results.push({ id: r.id, ok: true, status: 'inserted', photo_url: photoUrl });
  });
  if (rows.length) {
    var start = d.sheet.getLastRow() + 1;
    d.sheet.getRange(start, 1, rows.length, HEADERS.length).setValues(rows);
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

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.token !== TOKEN) return jsonOut({ ok: false, error: 'bad token' });
  if (p.action === 'config') return jsonOut({ ok: true, limits: getLimits(), farmer: getFarmer(p.f) });
  var n = 0; try { n = Math.max(0, sheet(SHEET_READINGS).getLastRow() - 1); } catch (err) { /* not set up */ }
  return jsonOut({ ok: true, version: VERSION, count: n });
}

/* ============================ one-time setup ============================ */

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
  var c = s.getSheetByName(SHEET_CONFIG) || s.insertSheet(SHEET_CONFIG);
  if (c.getLastRow() === 0) {
    c.appendRow(['key', 'value', 'description']);
    c.appendRow(['ec_soft_min', 0.1, 'EC (mS/cm) below this asks the farmer to confirm']);
    c.appendRow(['ec_soft_max', 15, 'EC (mS/cm) above this asks the farmer to confirm']);
    c.appendRow(['ec_hard_min', 0, 'EC (mS/cm) below this is rejected']);
    c.appendRow(['ec_hard_max', 100, 'EC (mS/cm) above this is rejected']);
    c.appendRow(['temp_soft_min', 10, 'Temp (°C) below this asks the farmer to confirm']);
    c.appendRow(['temp_soft_max', 40, 'Temp (°C) above this asks the farmer to confirm']);
    c.appendRow(['temp_hard_min', -5, 'Temp (°C) below this is rejected']);
    c.appendRow(['temp_hard_max', 60, 'Temp (°C) above this is rejected']);
    c.setFrozenRows(1); c.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  var l = s.getSheetByName(SHEET_LOG) || s.insertSheet(SHEET_LOG);
  if (l.getLastRow() === 0) l.appendRow(['time', 'message']);
  photoFolder();
  Logger.log('Setup complete.');
}

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
  module.exports = { computeEc25, validateRecord, rowFromRecord, parseWells, limitsFromRows, toCsv, toGeoJson, processSubmit, existingIds, HEADERS, DEFAULT_LIMITS };
}

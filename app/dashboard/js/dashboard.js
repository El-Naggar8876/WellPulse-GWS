/* WellPulse Atlas – researcher dashboard. Reads the Apps Script data endpoint (viewer key) and renders map, KPIs, charts, table. */
(function () {
  'use strict';
  const CFG = window.WP_CONFIG || {};
  // API can be overridden for local testing with ?api=http://localhost:8080/api (remembered in this browser).
  const apiUrl = () => (localStorage.getItem('wp_atlas_api') || CFG.API_URL || '').trim();
  const LS = { key: 'wp_atlas_key', cache: 'wp_atlas_cache', lang: 'wp_atlas_lang', theme: 'wp_atlas_theme', base: 'wp_atlas_base' };
  const $ = id => document.getElementById(id);

  /* ---------------- i18n ---------------- */
  const I18N = {
    en: {
      dir: 'ltr', gate_sub: 'Groundwater salinity monitoring for researchers and policy makers. Enter the viewer key you received from the project team.',
      gate_ph: 'Viewer key', gate_go: 'Open dashboard', gate_bad: 'That key was not accepted.', gate_net: 'Could not reach the data service. Check your connection and try again.',
      refresh: 'Refresh data', export: 'Export CSV', print: 'Print report', share: 'Copy share link', theme: 'Light / dark', fit: 'Fit map to wells',
      updated: 'Updated {t}', just_now: 'just now', min_ago: '{n} min ago', h_ago: '{n} h ago', cached: 'cached', loading: 'Loading data…', copied: 'Link copied',
      all_classes: 'All wells', class_low: 'Low', class_mod: 'Moderate', class_high: 'High', class_none: 'No data',
      lg1: 'Low: EC25 ≤ {a} mS/cm', lg2: 'Moderate: {a} – {b} mS/cm', lg3: 'High: > {b} mS/cm', legend_title: 'Salinity class (latest reading)',
      p30: 'Last 30 days', p90: 'Last 90 days', p365: 'Last 12 months', pall: 'All time', all_farmers: 'All farmers', search_ph: 'Search well or farmer…',
      satellite: 'Satellite', street: 'Street',
      k_wells: 'Wells monitored', k_farmers: 'Active farmers', k_readings: 'Readings', k_recent: 'Readings, last 30 days', k_high: 'Wells in high class', k_median: 'Median EC25 (mS/cm)',
      of_total: 'of {n} registered', vs_prev: 'vs previous 30 days', no_coords: '{n} wells without coordinates',
      ch_trend: 'Salinity over time (EC25, mS/cm)', ch_classes: 'Wells by salinity class', ch_monthly: 'Readings per month', ch_scatter: 'Temperature vs EC25',
      latest_readings: 'Latest readings', rows_shown: '{n} of {t} readings', foot_note: 'Data is read live from the project sheet. Salinity classes follow the FAO irrigation water guideline unless changed in the Config tab.',
      wells_list: 'Wells', back: 'All wells', last_reading: 'Last reading', readings_n: '{n} readings', mean: 'Mean', min: 'Min', max: 'Max', trend: 'Trend', rising: 'Rising', falling: 'Falling', stable: 'Stable',
      farmer: 'Farmer', village: 'Village', depth: 'Depth (m)', coords: 'Coordinates', open_maps: 'Open in Google Maps', photos: 'Photos', no_readings_period: 'No readings in the selected period.',
      col_date: 'Date', col_farmer: 'Farmer', col_well: 'Well', col_ec25: 'EC25', col_ec: 'EC (raw)', col_temp: 'Temp °C', col_class: 'Class', col_gps: 'GPS', col_note: 'Note', col_photo: 'Photo',
      empty: 'No readings yet. Once farmers start sending data it will appear here.', no_api: 'API_URL is not configured in js/config.js.', unit_ms: 'mS/cm',
      month_short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], cls_name: ['No data', 'Low', 'Moderate', 'High'], readings_word: 'readings', wells_word: 'wells'
    },
    ar: {
      dir: 'rtl', gate_sub: 'منصة رصد ملوحة المياه الجوفية للباحثين وصانعي القرار. أدخل مفتاح المشاهدة الذي حصلت عليه من فريق المشروع.',
      gate_ph: 'مفتاح المشاهدة', gate_go: 'فتح اللوحة', gate_bad: 'المفتاح غير صحيح.', gate_net: 'تعذّر الوصول إلى خدمة البيانات. تحقق من الاتصال وحاول مجدداً.',
      refresh: 'تحديث البيانات', export: 'تصدير CSV', print: 'طباعة التقرير', share: 'نسخ رابط المشاركة', theme: 'فاتح / داكن', fit: 'تكبير على الآبار',
      updated: 'آخر تحديث {t}', just_now: 'الآن', min_ago: 'منذ {n} دقيقة', h_ago: 'منذ {n} ساعة', cached: 'نسخة محفوظة', loading: 'جارٍ تحميل البيانات…', copied: 'تم نسخ الرابط',
      all_classes: 'كل الآبار', class_low: 'منخفضة', class_mod: 'متوسطة', class_high: 'مرتفعة', class_none: 'بلا بيانات',
      lg1: 'منخفضة: EC25 ≤ {a} mS/cm', lg2: 'متوسطة: {a} – {b} mS/cm', lg3: 'مرتفعة: > {b} mS/cm', legend_title: 'درجة الملوحة (آخر قراءة)',
      p30: 'آخر 30 يوماً', p90: 'آخر 90 يوماً', p365: 'آخر 12 شهراً', pall: 'كل الفترة', all_farmers: 'كل المزارعين', search_ph: 'ابحث عن بئر أو مزارع…',
      satellite: 'قمر صناعي', street: 'خريطة',
      k_wells: 'آبار مرصودة', k_farmers: 'مزارعون نشطون', k_readings: 'القراءات', k_recent: 'قراءات آخر 30 يوماً', k_high: 'آبار بملوحة مرتفعة', k_median: 'وسيط EC25 (mS/cm)',
      of_total: 'من {n} مسجّلة', vs_prev: 'مقارنة بالثلاثين يوماً السابقة', no_coords: '{n} آبار بدون إحداثيات',
      ch_trend: 'الملوحة عبر الزمن (EC25، mS/cm)', ch_classes: 'الآبار حسب درجة الملوحة', ch_monthly: 'عدد القراءات شهرياً', ch_scatter: 'درجة الحرارة مقابل EC25',
      latest_readings: 'أحدث القراءات', rows_shown: '{n} من {t} قراءة', foot_note: 'تُقرأ البيانات مباشرة من جدول المشروع. درجات الملوحة وفق دليل الفاو لمياه الري ما لم تُغيّر في ورقة الإعدادات.',
      wells_list: 'الآبار', back: 'كل الآبار', last_reading: 'آخر قراءة', readings_n: '{n} قراءة', mean: 'المتوسط', min: 'الأدنى', max: 'الأعلى', trend: 'الاتجاه', rising: 'صاعد', falling: 'هابط', stable: 'مستقر',
      farmer: 'المزارع', village: 'القرية', depth: 'العمق (م)', coords: 'الإحداثيات', open_maps: 'فتح في خرائط جوجل', photos: 'الصور', no_readings_period: 'لا توجد قراءات في الفترة المحددة.',
      col_date: 'التاريخ', col_farmer: 'المزارع', col_well: 'البئر', col_ec25: 'EC25', col_ec: 'EC (خام)', col_temp: 'الحرارة °C', col_class: 'الدرجة', col_gps: 'GPS', col_note: 'ملاحظة', col_photo: 'صورة',
      empty: 'لا توجد قراءات بعد. ستظهر هنا فور أن يبدأ المزارعون بالإرسال.', no_api: 'لم يتم ضبط API_URL في js/config.js.', unit_ms: 'mS/cm',
      month_short: ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'], cls_name: ['بلا بيانات', 'منخفضة', 'متوسطة', 'مرتفعة'], readings_word: 'قراءة', wells_word: 'بئر'
    }
  };
  let lang = localStorage.getItem(LS.lang) || 'en';
  const t = (k, v) => { let s = (I18N[lang] && I18N[lang][k]) ?? I18N.en[k] ?? k; if (v && typeof s === 'string') Object.keys(v).forEach(x => { s = s.split('{' + x + '}').join(v[x]); }); return s; };
  function applyI18n() {
    document.documentElement.lang = lang; document.documentElement.dir = I18N[lang].dir;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
    document.querySelectorAll('#langSeg button, .gate-lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === lang));
  }
  const locale = () => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
  const fmtNum = (v, d) => (v === null || v === undefined || isNaN(v)) ? '–' : Number(v).toLocaleString(locale(), { maximumFractionDigits: d === undefined ? 2 : d, minimumFractionDigits: 0 });
  const fmtDate = (ts, withTime) => { try { return new Intl.DateTimeFormat(locale(), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(ts)); } catch (e) { return new Date(ts).toLocaleString(); } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let toastTimer; const toast = m => { const el = $('toast'); el.textContent = m; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2200); };
  const cssVar = n => getComputedStyle(document.body).getPropertyValue(n).trim();

  /* ---------------- state ---------------- */
  const state = {
    data: null, readings: [], wells: [], wellsByKey: {}, classes: [0.7, 3], mapCfg: { lat: 26.8, lon: 30.8, zoom: 5.3 },
    filters: { cls: 'all', period: 0, farmer: '', q: '' }, selected: null, map: null, mapReady: false, charts: {}, loadedAt: 0, fromCache: false
  };
  const wellKey = (wellId, farmerId) => String(wellId || '').trim() + '|' + String(farmerId || '').trim();
  const classify = v => (v === null || v === undefined || isNaN(v)) ? 0 : (v <= state.classes[0] ? 1 : (v <= state.classes[1] ? 2 : 3));
  const classColor = k => cssVar('--c' + k) || ['#7a95a0', '#3ccf7a', '#f2b84b', '#f06a6a'][k];

  /* ---------------- data ---------------- */
  function getKey() {
    const u = new URL(location.href); const k = u.searchParams.get('key'), api = u.searchParams.get('api');
    if (api !== null) { if (api) localStorage.setItem('wp_atlas_api', api); else localStorage.removeItem('wp_atlas_api'); u.searchParams.delete('api'); if (!k) location.replace(u.toString()); }
    if (k) { localStorage.setItem(LS.key, k); u.searchParams.delete('key'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); }
    return localStorage.getItem(LS.key) || '';
  }
  async function fetchWithTimeout(url, ms) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), ms);
    try { const res = await fetch(url, { redirect: 'follow', signal: ctl.signal }); if (!res.ok) throw new Error('HTTP ' + res.status); return await res.json(); }
    finally { clearTimeout(timer); }
  }
  async function fetchData(key) {
    if (!apiUrl()) throw new Error('no_api');
    const u = new URL(apiUrl()); u.searchParams.set('action', 'data'); u.searchParams.set('key', key); u.searchParams.set('_', Date.now());
    let last;
    for (let i = 0; i < 2; i++) { try { return await fetchWithTimeout(u.toString(), 45000); } catch (e) { last = e; await new Promise(r => setTimeout(r, 1500)); } }
    throw last;
  }
  function buildModel(data) {
    state.data = data;
    state.classes = (data.config && data.config.classes) || [0.7, 3];
    if (data.config && data.config.map) state.mapCfg = data.config.map;
    const cols = data.columns; const ix = {}; cols.forEach((c, i) => { ix[c] = i; });
    state.readings = (data.readings || []).map(r => ({
      id: r[ix.id], farmer_id: r[ix.farmer_id], farmer_name: r[ix.farmer_name], well_id: r[ix.well_id], well_label: r[ix.well_label], ts: r[ix.ts_epoch],
      ec: r[ix.ec_ms], ec25: r[ix.ec25] === null ? r[ix.ec_ms] : r[ix.ec25], temp: r[ix.temp_c], lat: r[ix.lat], lon: r[ix.lon], flag: r[ix.flag], note: r[ix.note], photo: r[ix.photo_url],
      key: wellKey(r[ix.well_id], r[ix.farmer_id])
    }));
    const farmers = {}; (data.farmers || []).forEach(f => { farmers[f.id] = f.name; });
    const wells = {};
    (data.wells || []).forEach(w => { wells[wellKey(w.well_id, w.farmer_id)] = Object.assign({ readings: [] }, w, { farmer_name: farmers[w.farmer_id] || '' }); });
    state.readings.forEach(r => {
      let w = wells[r.key];
      if (!w) { w = wells[r.key] = { well_id: r.well_id, farmer_id: r.farmer_id, label: r.well_label || r.well_id, lat: null, lon: null, village: '', depth_m: null, readings: [], farmer_name: r.farmer_name || farmers[r.farmer_id] || '' }; }
      if (!w.farmer_name && r.farmer_name) w.farmer_name = r.farmer_name;
      w.readings.push(r);
    });
    Object.values(wells).forEach(w => {
      w.readings.sort((a, b) => a.ts - b.ts);
      if ((w.lat === null || w.lon === null) && w.readings.some(r => r.lat !== null && r.lon !== null)) {
        const pts = w.readings.filter(r => r.lat !== null && r.lon !== null);
        w.lat = pts.reduce((s, r) => s + r.lat, 0) / pts.length; w.lon = pts.reduce((s, r) => s + r.lon, 0) / pts.length; w.coordsFromApp = true;
      }
    });
    state.wellsByKey = wells; state.wells = Object.values(wells);
    document.title = 'WellPulse Atlas';
    $('projectName').textContent = (data.config && data.config.project_name) || '';
  }
  async function load(force) {
    const key = getKey();
    if (!key) { showGate(''); return; }
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(LS.cache) || 'null'); } catch (e) { cached = null; }
    if (cached && cached.key === key && cached.data && !state.data) { buildModel(cached.data); state.loadedAt = cached.t; state.fromCache = true; showMain(); renderAll(); }
    setLive(false, t('loading'));
    try {
      const data = await fetchData(key);
      if (!data.ok) { if (data.error === 'bad key') { localStorage.removeItem(LS.key); localStorage.removeItem(LS.cache); showGate(t('gate_bad')); return; } throw new Error(data.error || 'server'); }
      buildModel(data); state.loadedAt = Date.now(); state.fromCache = false;
      try { localStorage.setItem(LS.cache, JSON.stringify({ key, t: state.loadedAt, data })); } catch (e) { /* quota */ }
      showMain(); renderAll(); setLive(true);
    } catch (e) {
      if (!state.data) { showGate(e.message === 'no_api' ? t('no_api') : t('gate_net')); }
      else { setLive(false); toast(t('gate_net')); }
    }
  }
  function setLive(ok, text) {
    const dot = $('liveDot'); dot.classList.toggle('stale', !ok);
    if (text) { $('updatedText').textContent = text; return; }
    const ago = Date.now() - state.loadedAt, m = Math.round(ago / 60000);
    const when = m < 1 ? t('just_now') : (m < 60 ? t('min_ago', { n: m }) : t('h_ago', { n: Math.round(m / 60) }));
    $('updatedText').textContent = t('updated', { t: when }) + (state.fromCache ? ' · ' + t('cached') : '');
  }

  /* ---------------- gate / layout ---------------- */
  function showGate(msg) { $('gate').hidden = false; $('top').hidden = true; $('main').hidden = true; $('gateErr').textContent = msg || ''; setTimeout(() => $('gateKey').focus(), 50); }
  function showMain() { $('gate').hidden = true; $('top').hidden = false; $('main').hidden = false; }

  /* ---------------- filtering ---------------- */
  function periodStart() { const d = Number(state.filters.period); return d ? Date.now() - d * 86400000 : 0; }
  function wellStats() {
    const since = periodStart(), f = state.filters, q = f.q.trim().toLowerCase();
    const out = [];
    state.wells.forEach(w => {
      if (f.farmer && w.farmer_id !== f.farmer) return;
      if (q && !((w.label || '').toLowerCase().includes(q) || (w.well_id || '').toLowerCase().includes(q) || (w.farmer_name || '').toLowerCase().includes(q) || (w.farmer_id || '').toLowerCase().includes(q) || (w.village || '').toLowerCase().includes(q))) return;
      const rs = w.readings.filter(r => r.ts >= since);
      const vals = rs.map(r => r.ec25).filter(v => v !== null && !isNaN(v));
      const last = rs.length ? rs[rs.length - 1] : null;
      const prev = rs.length > 1 ? rs[rs.length - 2] : null;
      const cls = last ? classify(last.ec25) : 0;
      if (f.cls !== 'all' && String(cls) !== f.cls) return;
      let trend = 'stable';
      if (last && prev && prev.ec25) { const d = (last.ec25 - prev.ec25) / prev.ec25; trend = d > 0.1 ? 'rising' : (d < -0.1 ? 'falling' : 'stable'); }
      out.push({ w, rs, n: rs.length, last, cls, trend, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null });
    });
    return out;
  }
  function filteredReadings(stats) { const keys = new Set(stats.map(s => s.w.well_id + '|' + s.w.farmer_id)); return stats.flatMap(s => s.rs).sort((a, b) => b.ts - a.ts).filter(r => keys.has(r.key)); }
  const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  /* ---------------- render ---------------- */
  function renderAll() {
    applyI18n();
    $('lg1').textContent = t('lg1', { a: state.classes[0] }); $('lg2').textContent = t('lg2', { a: state.classes[0], b: state.classes[1] }); $('lg3').textContent = t('lg3', { b: state.classes[1] });
    renderFarmerSelect();
    const stats = wellStats(); const rs = filteredReadings(stats);
    renderKpis(stats, rs); renderMap(stats); renderPanel(stats); renderCharts(stats, rs); renderTable(rs);
    $('footVersion').textContent = 'v' + ((state.data && state.data.version) || ''); $('footGenerated').textContent = state.data && state.data.generated_at ? fmtDate(state.data.generated_at, true) : '';
    setLive(!state.fromCache);
  }
  function renderFarmerSelect() {
    const sel = $('farmerSel'); const cur = state.filters.farmer;
    const farmers = {}; state.wells.forEach(w => { farmers[w.farmer_id] = w.farmer_name || w.farmer_id; });
    sel.innerHTML = '<option value="">' + t('all_farmers') + '</option>' + Object.keys(farmers).sort().map(id => '<option value="' + esc(id) + '">' + esc(farmers[id]) + ' (' + esc(id) + ')</option>').join('');
    sel.value = cur;
  }
  function renderKpis(stats, rs) {
    const now = Date.now(), d30 = now - 30 * 86400000, d60 = now - 60 * 86400000;
    const withData = stats.filter(s => s.n > 0).length, farmers = new Set(rs.map(r => r.farmer_id)).size;
    const recent = state.readings.filter(r => r.ts >= d30), prevWin = state.readings.filter(r => r.ts >= d60 && r.ts < d30);
    const high = stats.filter(s => s.cls === 3).length;
    const med = median(rs.map(r => r.ec25).filter(v => v !== null)), medRecent = median(recent.map(r => r.ec25).filter(v => v !== null)), medPrev = median(prevWin.map(r => r.ec25).filter(v => v !== null));
    let trendHtml = '';
    if (medRecent !== null && medPrev !== null && medPrev) { const d = (medRecent - medPrev) / medPrev * 100; trendHtml = '<div class="sub ' + (d > 2 ? 'up' : (d < -2 ? 'down' : '')) + '">' + (d > 0 ? '+' : '') + fmtNum(d, 0) + '% ' + t('vs_prev') + '</div>'; }
    const noCoords = state.wells.filter(w => w.lat === null || w.lon === null).length;
    const tile = (v, l, sub) => '<div class="kpi"><b>' + v + '</b><span>' + l + '</span>' + (sub || '') + '</div>';
    $('kpis').innerHTML =
      tile(fmtNum(withData, 0), t('k_wells'), '<div class="sub muted">' + t('of_total', { n: fmtNum(state.wells.length, 0) }) + (noCoords ? ' · ' + t('no_coords', { n: noCoords }) : '') + '</div>') +
      tile(fmtNum(farmers, 0), t('k_farmers')) +
      tile(fmtNum(rs.length, 0), t('k_readings')) +
      tile(fmtNum(recent.length, 0), t('k_recent')) +
      tile(fmtNum(high, 0) + (withData ? ' <span class="muted small">(' + fmtNum(high / withData * 100, 0) + '%)</span>' : ''), t('k_high')) +
      tile(fmtNum(med, 2), t('k_median'), trendHtml);
  }

  /* ---------------- map ---------------- */
  function baseStyle() {
    const sub = ['a', 'b', 'c'];
    return {
      version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
        satlab: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
        street: { type: 'raster', tiles: sub.map(s => 'https://' + s + '.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'), tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors © CARTO' }
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'satlab', type: 'raster', source: 'satlab', paint: { 'raster-opacity': 0.9 } },
        { id: 'street', type: 'raster', source: 'street', layout: { visibility: 'none' } }
      ]
    };
  }
  function wellsGeoJson(stats) {
    return { type: 'FeatureCollection', features: stats.filter(s => s.w.lat !== null && s.w.lon !== null).map(s => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [s.w.lon, s.w.lat] },
      properties: { key: s.w.well_id + '|' + s.w.farmer_id, label: s.w.label, farmer: s.w.farmer_name || s.w.farmer_id, cls: s.cls, n: s.n, ec25: s.last ? s.last.ec25 : null, ts: s.last ? s.last.ts : null }
    })) };
  }
  let popup;
  function renderMap(stats) {
    const gj = wellsGeoJson(stats);
    if (!state.map) {
      if (typeof maplibregl === 'undefined') return;
      state.map = new maplibregl.Map({ container: 'map', style: baseStyle(), center: [state.mapCfg.lon, state.mapCfg.lat], zoom: state.mapCfg.zoom, attributionControl: { compact: true } });
      state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      state.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
      state.map.on('load', () => {
        state.map.addSource('wells', { type: 'geojson', data: gj });
        state.map.addLayer({ id: 'wells-glow', type: 'circle', source: 'wells', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 0, 10, 20, 18, 100, 26], 'circle-color': ['match', ['get', 'cls'], 1, classColor(1), 2, classColor(2), 3, classColor(3), classColor(0)], 'circle-opacity': 0.25, 'circle-blur': 0.6 } });
        state.map.addLayer({ id: 'wells', type: 'circle', source: 'wells', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 0, 5, 20, 8, 100, 11], 'circle-color': ['match', ['get', 'cls'], 1, classColor(1), 2, classColor(2), 3, classColor(3), classColor(0)], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
        state.map.addLayer({ id: 'wells-sel', type: 'circle', source: 'wells', filter: ['==', ['get', 'key'], '__none__'], paint: { 'circle-radius': 16, 'circle-color': 'transparent', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
        state.map.on('click', 'wells', e => { const p = e.features[0].properties; selectWell(p.key); });
        state.map.on('mouseenter', 'wells', e => {
          state.map.getCanvas().style.cursor = 'pointer';
          const p = e.features[0].properties;
          popup = new maplibregl.Popup({ closeButton: false, offset: 14 }).setLngLat(e.features[0].geometry.coordinates)
            .setHTML('<div class="pop"><b>' + esc(p.label) + '</b><div class="muted small">' + esc(p.farmer) + '</div><div>' + (p.ec25 !== null && p.ec25 !== 'null' ? fmtNum(+p.ec25) + ' ' + t('unit_ms') + ' ' : '') + '<span class="cls k' + p.cls + '">' + t('cls_name')[p.cls] + '</span></div>' + (p.ts && p.ts !== 'null' ? '<div class="muted small">' + fmtDate(+p.ts) + '</div>' : '') + '</div>').addTo(state.map);
        });
        state.map.on('mouseleave', 'wells', () => { state.map.getCanvas().style.cursor = ''; if (popup) { popup.remove(); popup = null; } });
        state.mapReady = true; fitToWells(gj, true); applyBasemap();
      });
      return;
    }
    if (state.mapReady) { state.map.getSource('wells').setData(gj); highlightSelected(); }
  }
  function fitToWells(gj, initial) {
    const feats = (gj || wellsGeoJson(wellStats())).features;
    if (!feats.length) { if (!initial) state.map.flyTo({ center: [state.mapCfg.lon, state.mapCfg.lat], zoom: state.mapCfg.zoom }); return; }
    const b = new maplibregl.LngLatBounds(); feats.forEach(f => b.extend(f.geometry.coordinates));
    state.map.fitBounds(b, { padding: 60, maxZoom: 13, duration: initial ? 0 : 800 });
  }
  function applyBasemap() {
    if (!state.mapReady) return;
    const sat = (localStorage.getItem(LS.base) || 'sat') === 'sat';
    state.map.setLayoutProperty('sat', 'visibility', sat ? 'visible' : 'none'); state.map.setLayoutProperty('satlab', 'visibility', sat ? 'visible' : 'none'); state.map.setLayoutProperty('street', 'visibility', sat ? 'none' : 'visible');
    document.querySelectorAll('#basemapSeg button').forEach(b => b.classList.toggle('on', (b.dataset.base === 'sat') === sat));
  }
  function highlightSelected() { if (state.mapReady) state.map.setFilter('wells-sel', ['==', ['get', 'key'], state.selected || '__none__']); }
  function selectWell(key) {
    state.selected = state.selected === key ? null : key;
    highlightSelected();
    const stats = wellStats(); renderPanel(stats); renderCharts(stats, filteredReadings(stats));
    const w = state.wellsByKey[key];
    if (state.selected && w && w.lat !== null && state.mapReady) state.map.flyTo({ center: [w.lon, w.lat], zoom: Math.max(state.map.getZoom(), 12), duration: 700 });
  }

  /* ---------------- side panel ---------------- */
  function renderPanel(stats) {
    const el = $('panel');
    const sel = state.selected ? stats.find(s => s.w.well_id + '|' + s.w.farmer_id === state.selected) : null;
    if (!sel) {
      state.selected = null; highlightSelected();
      if (!stats.length) { el.innerHTML = '<h3>' + t('wells_list') + '</h3><div class="empty">' + t('empty') + '</div>'; return; }
      const sorted = stats.slice().sort((a, b) => (b.cls - a.cls) || ((b.last ? b.last.ts : 0) - (a.last ? a.last.ts : 0)));
      el.innerHTML = '<h3>' + t('wells_list') + ' <span class="muted small">' + fmtNum(stats.length, 0) + '</span></h3>' + sorted.map(s =>
        '<div class="well-row" data-key="' + esc(s.w.well_id + '|' + s.w.farmer_id) + '"><i class="sw c' + s.cls + '"></i><div class="nm"><div>' + esc(s.w.label) + '</div><div>' + esc(s.w.farmer_name || s.w.farmer_id) + ' · ' + t('readings_n', { n: s.n }) + '</div></div><b>' + (s.last ? fmtNum(s.last.ec25) : '–') + '</b></div>').join('');
      el.querySelectorAll('.well-row').forEach(r => r.onclick = () => selectWell(r.dataset.key));
      return;
    }
    const w = sel.w, last = sel.last;
    const kv = (k, v) => '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>';
    let html = '<h3><span><i class="sw c' + sel.cls + '"></i> ' + esc(w.label) + '</span><button class="back" id="btnBack">' + t('back') + '</button></h3>';
    html += '<div class="muted small">' + esc(w.farmer_name || w.farmer_id) + (w.village ? ' · ' + esc(w.village) : '') + '</div>';
    if (last) {
      html += '<div class="big">' + fmtNum(last.ec25) + ' <span class="muted small">' + t('unit_ms') + '</span></div><div class="muted small">' + t('last_reading') + ': ' + fmtDate(last.ts, true) + ' · ' + fmtNum(last.temp, 1) + ' °C · <span class="cls k' + sel.cls + '">' + t('cls_name')[sel.cls] + '</span></div>';
      html += '<div class="spark" id="spark"></div>';
      html += kv(t('readings_n', { n: '' }).trim(), fmtNum(sel.n, 0)) + kv(t('mean'), fmtNum(sel.mean)) + kv(t('min'), fmtNum(sel.min)) + kv(t('max'), fmtNum(sel.max)) + kv(t('trend'), t(sel.trend));
    } else html += '<div class="empty">' + t('no_readings_period') + '</div>';
    if (w.depth_m !== null && w.depth_m !== undefined) html += kv(t('depth'), fmtNum(w.depth_m, 1));
    if (w.lat !== null && w.lon !== null) html += kv(t('coords'), '<span dir="ltr">' + fmtNum(w.lat, 5) + ', ' + fmtNum(w.lon, 5) + '</span>') + '<div class="links" style="margin-top:8px"><a target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + w.lat + ',' + w.lon + '">' + t('open_maps') + '</a></div>';
    const photos = sel.rs.filter(r => r.photo).slice(-5);
    if (photos.length) html += '<div class="links" style="margin-top:6px">' + t('photos') + ': ' + photos.map((r, i) => '<a target="_blank" rel="noopener" href="' + esc(r.photo) + '">#' + (i + 1) + '</a>').join('') + '</div>';
    if (sel.rs.length) html += '<table class="mini-table">' + sel.rs.slice(-8).reverse().map(r => '<tr><td>' + fmtDate(r.ts) + '</td><td class="num">' + fmtNum(r.ec25) + '</td><td class="num">' + fmtNum(r.temp, 1) + ' °C</td></tr>').join('') + '</table>';
    el.innerHTML = html;
    $('btnBack').onclick = () => selectWell(state.selected);
    if (last && sel.rs.length > 1 && typeof echarts !== 'undefined') {
      const c = echarts.init($('spark'), null, { renderer: 'canvas' });
      c.setOption({ grid: { left: 6, right: 6, top: 6, bottom: 6 }, xAxis: { type: 'time', show: false }, yAxis: { type: 'value', show: false, min: v => v.min * 0.9, max: v => v.max * 1.1 },
        series: [{ type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: sel.rs.map(r => [r.ts, r.ec25]), lineStyle: { color: cssVar('--primary'), width: 2 }, itemStyle: { color: cssVar('--primary') }, areaStyle: { color: cssVar('--accent-soft') } }], tooltip: { trigger: 'axis', formatter: p => fmtDate(p[0].value[0]) + '<br>' + fmtNum(p[0].value[1]) + ' ' + t('unit_ms') } });
      state.charts.spark = c;
    }
  }

  /* ---------------- charts ---------------- */
  function chartBase() { return { textStyle: { color: cssVar('--muted'), fontFamily: cssVar('--font') }, tooltip: { backgroundColor: cssVar('--card'), borderColor: cssVar('--line'), textStyle: { color: cssVar('--text') } } }; }
  function chart(id) { const el = $(id); if (!el) return null; if (state.charts[id]) state.charts[id].dispose(); const c = echarts.init(el, null, { renderer: 'canvas' }); state.charts[id] = c; return c; }
  function renderCharts(stats, rs) {
    if (typeof echarts === 'undefined') return;
    const axis = { axisLine: { lineStyle: { color: cssVar('--line') } }, splitLine: { lineStyle: { color: cssVar('--line') } }, axisLabel: { color: cssVar('--muted') } };
    // 1) trend: selected well, else top 6 wells by readings count
    const sel = state.selected ? stats.filter(s => s.w.well_id + '|' + s.w.farmer_id === state.selected) : stats.slice().sort((a, b) => b.n - a.n).slice(0, 6);
    const palette = [cssVar('--primary'), '#f2b84b', '#f06a6a', '#3ccf7a', '#b58cff', '#ff9f6e'];
    const c1 = chart('chTrend');
    c1.setOption(Object.assign(chartBase(), {
      grid: { left: 48, right: 16, top: 30, bottom: 30 }, legend: { top: 0, textStyle: { color: cssVar('--muted') }, type: 'scroll' },
      xAxis: Object.assign({ type: 'time' }, axis), yAxis: Object.assign({ type: 'value', name: t('unit_ms'), nameTextStyle: { color: cssVar('--muted') } }, axis),
      tooltip: Object.assign(chartBase().tooltip, { trigger: 'axis', valueFormatter: v => fmtNum(v) }),
      series: sel.filter(s => s.n).map((s, i) => ({ name: s.w.label + ' · ' + (s.w.farmer_name || s.w.farmer_id), type: 'line', smooth: true, showSymbol: true, symbolSize: 6, data: s.rs.map(r => [r.ts, r.ec25]), lineStyle: { width: 2, color: palette[i % palette.length] }, itemStyle: { color: palette[i % palette.length] } }))
        .concat([{ type: 'line', markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: cssVar('--c2') }, data: [{ yAxis: state.classes[0] }, { yAxis: state.classes[1] }], label: { color: cssVar('--muted'), formatter: p => fmtNum(p.value) } }, data: [] }])
    }));
    // 2) classes donut
    const counts = [0, 0, 0, 0]; stats.forEach(s => { counts[s.cls]++; });
    const c2 = chart('chClasses');
    c2.setOption(Object.assign(chartBase(), {
      tooltip: Object.assign(chartBase().tooltip, { trigger: 'item', formatter: p => p.name + ': ' + fmtNum(p.value, 0) + ' ' + t('wells_word') + ' (' + fmtNum(p.percent, 0) + '%)' }),
      legend: { bottom: 0, textStyle: { color: cssVar('--muted') } },
      series: [{ type: 'pie', radius: ['52%', '76%'], center: ['50%', '45%'], avoidLabelOverlap: true, label: { show: false }, itemStyle: { borderColor: cssVar('--card'), borderWidth: 2 },
        data: [1, 2, 3, 0].map(k => ({ name: t('cls_name')[k], value: counts[k], itemStyle: { color: classColor(k) } })).filter(d => d.value) }]
    }));
    // 3) monthly readings (last 12 months of the filtered set)
    const months = []; const now = new Date();
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ k: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: t('month_short')[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2) }); }
    const byM = {}; rs.forEach(r => { const d = new Date(r.ts); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); byM[k] = (byM[k] || 0) + 1; });
    const c3 = chart('chMonthly');
    c3.setOption(Object.assign(chartBase(), {
      grid: { left: 40, right: 16, top: 16, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: months.map(m => m.label) }, axis), yAxis: Object.assign({ type: 'value', minInterval: 1 }, axis),
      tooltip: Object.assign(chartBase().tooltip, { trigger: 'axis' }),
      series: [{ type: 'bar', data: months.map(m => byM[m.k] || 0), itemStyle: { color: cssVar('--primary'), borderRadius: [6, 6, 0, 0] }, barMaxWidth: 28 }]
    }));
    // 4) scatter temp vs ec25
    const c4 = chart('chScatter');
    c4.setOption(Object.assign(chartBase(), {
      grid: { left: 48, right: 16, top: 16, bottom: 34 }, xAxis: Object.assign({ type: 'value', name: '°C', nameTextStyle: { color: cssVar('--muted') }, scale: true }, axis), yAxis: Object.assign({ type: 'value', name: t('unit_ms'), nameTextStyle: { color: cssVar('--muted') }, scale: true }, axis),
      tooltip: Object.assign(chartBase().tooltip, { trigger: 'item', formatter: p => esc(p.data[2]) + '<br>' + fmtNum(p.data[0], 1) + ' °C · ' + fmtNum(p.data[1]) + ' ' + t('unit_ms') }),
      series: [{ type: 'scatter', symbolSize: 9, data: rs.filter(r => r.temp !== null && r.ec25 !== null).map(r => ({ value: [r.temp, r.ec25, (r.well_label || r.well_id) + ' · ' + fmtDate(r.ts)], itemStyle: { color: classColor(classify(r.ec25)), opacity: 0.85 } })) }]
    }));
  }

  /* ---------------- table + export ---------------- */
  function renderTable(rs) {
    const cols = ['col_date', 'col_farmer', 'col_well', 'col_ec25', 'col_ec', 'col_temp', 'col_class', 'col_gps', 'col_note', 'col_photo'];
    $('table').querySelector('thead').innerHTML = '<tr>' + cols.map(c => '<th>' + t(c) + '</th>').join('') + '</tr>';
    const shown = rs.slice(0, 200);
    $('table').querySelector('tbody').innerHTML = shown.length ? shown.map(r => { const k = classify(r.ec25); return '<tr><td>' + fmtDate(r.ts, true) + '</td><td>' + esc(r.farmer_name || r.farmer_id) + '</td><td>' + esc(r.well_label || r.well_id) + '</td><td class="num"><b>' + fmtNum(r.ec25) + '</b></td><td class="num">' + fmtNum(r.ec) + '</td><td class="num">' + fmtNum(r.temp, 1) + '</td><td><span class="cls k' + k + '">' + t('cls_name')[k] + '</span></td><td>' + (r.lat !== null ? '<a target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + r.lat + ',' + r.lon + '">📍</a>' : '') + '</td><td>' + esc(r.note) + '</td><td>' + (r.photo ? '<a target="_blank" rel="noopener" href="' + esc(r.photo) + '">📷</a>' : '') + '</td></tr>'; }).join('')
      : '<tr><td colspan="10" class="empty">' + t('empty') + '</td></tr>';
    $('tableCount').textContent = t('rows_shown', { n: fmtNum(shown.length, 0), t: fmtNum(rs.length, 0) });
  }
  function exportCsv() {
    const stats = wellStats(); const rs = filteredReadings(stats);
    const head = ['id', 'farmer_id', 'farmer_name', 'well_id', 'well_label', 'timestamp', 'ec_ms_cm', 'ec25_ms_cm', 'temp_c', 'class', 'lat', 'lon', 'flag', 'note', 'photo_url'];
    const q = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [head.join(',')].concat(rs.map(r => [r.id, r.farmer_id, r.farmer_name, r.well_id, r.well_label, new Date(r.ts).toISOString(), r.ec, r.ec25, r.temp, classify(r.ec25), r.lat, r.lon, r.flag, r.note, r.photo].map(q).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'wellpulse-readings-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------------- theme / language ---------------- */
  function setTheme(th) { document.body.dataset.theme = th; localStorage.setItem(LS.theme, th); if (state.data) renderAll(); }
  function setLang(l) { lang = I18N[l] ? l : 'en'; localStorage.setItem(LS.lang, lang); applyI18n(); if (state.data) renderAll(); }

  /* ---------------- wiring ---------------- */
  function init() {
    document.body.dataset.theme = localStorage.getItem(LS.theme) || 'dark';
    applyI18n();
    document.querySelectorAll('#langSeg button, .gate-lang button').forEach(b => b.onclick = () => setLang(b.dataset.lang));
    $('btnTheme').onclick = () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
    $('btnRefresh').onclick = () => load(true);
    $('btnExport').onclick = exportCsv;
    $('btnPrint').onclick = () => { Object.values(state.charts).forEach(c => c && c.resize && c.resize()); setTimeout(() => window.print(), 300); };
    $('btnShare').onclick = async () => { const link = location.origin + location.pathname + '?key=' + encodeURIComponent(localStorage.getItem(LS.key) || ''); try { await navigator.clipboard.writeText(link); toast(t('copied')); } catch (e) { prompt('Link', link); } };
    $('btnFit').onclick = () => fitToWells(null, false);
    document.querySelectorAll('#basemapSeg button').forEach(b => b.onclick = () => { localStorage.setItem(LS.base, b.dataset.base); applyBasemap(); });
    document.querySelectorAll('#classChips .chip').forEach(b => b.onclick = () => { state.filters.cls = b.dataset.class; document.querySelectorAll('#classChips .chip').forEach(x => x.classList.toggle('on', x === b)); renderAll(); });
    $('periodSel').onchange = e => { state.filters.period = e.target.value; renderAll(); };
    $('farmerSel').onchange = e => { state.filters.farmer = e.target.value; renderAll(); };
    let st; $('search').oninput = e => { clearTimeout(st); st = setTimeout(() => { state.filters.q = e.target.value; renderAll(); }, 200); };
    $('gateForm').onsubmit = e => { e.preventDefault(); const k = $('gateKey').value.trim(); if (!k) return; localStorage.setItem(LS.key, k); state.data = null; load(true); };
    window.addEventListener('resize', () => Object.values(state.charts).forEach(c => c && c.resize && c.resize()));
    setInterval(() => { if (state.data) setLive(!state.fromCache); }, 60000);
    setInterval(() => { if (state.data && document.visibilityState === 'visible') load(true); }, 10 * 60000);
    load(false);
  }
  window.__atlas = { state, load, wellStats, classify, selectWell };
  document.addEventListener('DOMContentLoaded', init);
})();

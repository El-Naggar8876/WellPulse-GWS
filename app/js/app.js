/* WellPulse GWS – main application. */
(function () {
  const C = window.WP_CONFIG, I = window.WP_I18N, U = window.WP_UTIL, DB = window.WP_DB, S = window.WP_SYNC;
  const t = I.t;
  const $ = id => document.getElementById(id);

  const state = {
    profile: null,          // { farmerId, farmerName, wells:[{id,label}], lang }
    limits: C.LIMITS,
    readings: [],
    view: 'home',
    cap: { wellId: null, gps: null, photo: null, unit: C.DEFAULT_EC_UNIT },
    deferredInstall: null,
    swReg: null
  };

  /* ---------- helpers ---------- */
  function show(el, on) { if (el) el.hidden = !on; }
  let toastTimer;
  function toast(msg, ms) {
    const el = $('toast'); el.textContent = msg; show(el, true);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => show(el, false), ms || 2600);
  }
  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* ignore */ } }

  /** Generic modal. buttons: [{label, cls, value}] → resolves with value. */
  function modal(title, bodyHtml, buttons) {
    return new Promise(resolve => {
      $('mTitle').textContent = title || '';
      $('mBody').innerHTML = bodyHtml || '';
      const act = $('mActions'); act.innerHTML = '';
      (buttons || [{ label: t('ok'), cls: 'primary', value: true }]).forEach(b => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'btn ' + (b.cls || ''); btn.textContent = b.label;
        btn.onclick = () => { show($('modal'), false); resolve(b.value); };
        act.appendChild(btn);
      });
      show($('modal'), true);
    });
  }
  const confirmSoft = msg => modal('', '<p>' + msg + '</p>', [
    { label: t('confirm_anyway'), cls: 'primary', value: true },
    { label: t('recheck'), cls: 'ghost', value: false }
  ]);

  function fmtDate(ts, withTime) {
    const d = new Date(ts);
    const loc = I.getLang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
    const opts = withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
    try { return new Intl.DateTimeFormat(loc, opts).format(d); } catch (e) { return d.toLocaleString(); }
  }
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date();
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, now)) return t('today');
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (same(d, y)) return t('yesterday');
    return fmtDate(ts, false);
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- profile ---------- */
  async function loadProfile() {
    const stored = await DB.kvGet('profile');
    const fromUrl = U.parseEnrollParams(location.search);
    if (fromUrl) {
      const p = Object.assign({ wells: [] }, stored || {}, {
        farmerId: fromUrl.farmerId,
        farmerName: fromUrl.farmerName || (stored && stored.farmerName) || '',
        lang: fromUrl.lang
      });
      // merge wells (keep any the farmer added locally)
      const ids = new Set((p.wells || []).map(w => w.id));
      fromUrl.wells.forEach(w => { if (!ids.has(w.id)) p.wells.push(w); });
      if (fromUrl.api) localStorage.setItem('wp_api', fromUrl.api);
      if (fromUrl.token) localStorage.setItem('wp_token', fromUrl.token);
      await DB.kvSet('profile', p);
      history.replaceState(null, '', location.pathname);
      return p;
    }
    const q = new URLSearchParams(location.search);
    if (q.get('api')) { localStorage.setItem('wp_api', q.get('api')); history.replaceState(null, '', location.pathname); }
    return stored || null;
  }
  async function saveProfile() { await DB.kvSet('profile', state.profile); }

  /* ---------- navigation ---------- */
  function showView(name) {
    state.view = name;
    ['enroll', 'home', 'capture', 'history', 'settings'].forEach(v => show($('view-' + v), v === name));
    document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
    show($('tabbar'), name !== 'enroll' && name !== 'capture');
    window.scrollTo(0, 0);
    if (name === 'home') renderHome();
    if (name === 'history') renderHistory();
    if (name === 'settings') renderSettings();
  }

  /* ---------- language ---------- */
  function setLang(l) {
    I.setLang(l); I.apply();
    document.querySelectorAll('#langSeg button, #enrollLang button').forEach(b => b.classList.toggle('on', b.dataset.lang === l));
    updateNet();
    if (state.profile) { state.profile.lang = l; saveProfile(); }
    if (state.view === 'home') renderHome();
    if (state.view === 'history') renderHistory();
    if (state.view === 'settings') renderSettings();
    renderUnits();
  }

  /* ---------- network ---------- */
  function updateNet() {
    const on = navigator.onLine !== false;
    $('netBadge').classList.toggle('on', on);
    $('netText').textContent = on ? t('online') : t('offline');
  }

  /* ---------- home ---------- */
  async function refreshReadings() { state.readings = await DB.all(); }

  function pendingCount() { return state.readings.filter(r => r.status === 'pending' || r.status === 'failed').length; }

  function renderSyncCard(extra) {
    const card = $('syncCard'), n = pendingCount(), busy = S.isSyncing();
    card.classList.remove('ok', 'busy', 'err');
    const icon = $('syncIcon');
    if (busy) { card.classList.add('busy'); icon.textContent = '⟳'; $('syncTitle').textContent = t('sending'); $('syncSub').textContent = ''; }
    else if (n === 0) { card.classList.add('ok'); icon.textContent = '✓'; $('syncTitle').textContent = t('all_sent'); $('syncSub').textContent = extra || ''; }
    else { icon.textContent = String(n); $('syncTitle').textContent = n === 1 ? t('pending_one') : t('pending_n', { n }); $('syncSub').textContent = extra || (navigator.onLine === false ? t('offline') : ''); }
    if (extra && /fail|تعذّر|not configured|لم يتم/.test(extra)) { card.classList.remove('ok'); card.classList.add('err'); }
    $('btnSend').disabled = busy || n === 0;
    const badge = $('histBadge'); badge.textContent = n; show(badge, n > 0);
  }

  function renderStats() {
    const rs = state.readings, now = new Date();
    const month = rs.filter(r => { const d = new Date(r.ts_epoch); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
    const days = rs.length ? Math.floor((Date.now() - rs[0].ts_epoch) / 86400000) : '–';
    $('stats').innerHTML =
      '<div class="stat"><b>' + rs.length + '</b><span>' + t('total_readings') + '</span></div>' +
      '<div class="stat"><b>' + month + '</b><span>' + t('this_month') + '</span></div>' +
      '<div class="stat"><b>' + days + '</b><span>' + t('days_since') + '</span></div>';
  }

  function wellLabel(id) { const w = (state.profile.wells || []).find(x => x.id === id); return w ? w.label : (id || ''); }

  function renderLast() {
    const r = state.readings[0];
    if (!r) { $('lastBody').innerHTML = '<p class="muted">' + t('no_readings') + '</p>'; return; }
    $('lastBody').innerHTML =
      '<div class="last"><div class="big-val" dir="ltr">' + U.fmtNum(r.ec) + ' <small>' + esc(r.ec_unit) + '</small></div>' +
      '<div><div>' + esc(wellLabel(r.well_id)) + ' · <span dir="ltr">' + U.fmtNum(r.temp_c, 1) + ' °C</span></div>' +
      '<div class="meta">' + fmtDate(r.ts_epoch, true) + ' <span class="pill ' + r.status + '">' + t('status_' + r.status) + '</span></div></div></div>';
  }

  function renderTrend() {
    const wellId = state.readings[0] && state.readings[0].well_id;
    const pts = state.readings.filter(r => r.well_id === wellId).slice(0, 12).reverse();
    if (pts.length < 2) { $('trendBody').innerHTML = ''; show($('trendCard'), false); return; }
    show($('trendCard'), true);
    const W = 320, H = 90, padX = 18, padT = 14, padB = 16;
    const vals = pts.map(p => p.ec_ms);
    let min = Math.min(...vals), max = Math.max(...vals); if (max === min) { max += 0.5; min = Math.max(0, min - 0.5); }
    const x = i => padX + i * (W - 2 * padX) / (pts.length - 1);
    const y = v => padT + (H - padT - padB) * (1 - (v - min) / (max - min));
    let d = ''; pts.forEach((p, i) => { d += (i ? ' L' : 'M') + x(i).toFixed(1) + ' ' + y(p.ec_ms).toFixed(1); });
    const area = d + ' L' + x(pts.length - 1).toFixed(1) + ' ' + (H - padB) + ' L' + padX + ' ' + (H - padB) + ' Z';
    let svg = '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" dir="ltr"><path class="a" d="' + area + '"/><path class="l" d="' + d + '"/>';
    pts.forEach((p, i) => { svg += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.ec_ms).toFixed(1) + '" r="3"/>'; });
    svg += '<text x="' + padX + '" y="' + (H - 3) + '">' + fmtDate(pts[0].ts_epoch) + '</text>';
    svg += '<text x="' + (W - padX) + '" y="' + (H - 3) + '" text-anchor="end">' + fmtDate(pts[pts.length - 1].ts_epoch) + '</text>';
    svg += '<text x="' + padX + '" y="10">' + U.fmtNum(max) + ' mS/cm</text></svg>';
    $('trendBody').innerHTML = '<div class="muted small">' + esc(wellLabel(wellId)) + '</div>' + svg;
  }

  async function renderHome() {
    await refreshReadings();
    $('homeName').textContent = state.profile.farmerName || state.profile.farmerId;
    $('homeDate').textContent = fmtDate(Date.now(), false);
    renderSyncCard(); renderStats(); renderLast(); renderTrend();
  }

  /* ---------- capture ---------- */
  let clockTimer;
  function startCapture() {
    const c = state.cap; c.wellId = null; c.gps = null; c.photo = null; c.unit = localStorage.getItem('wp_unit') || C.DEFAULT_EC_UNIT;
    $('ecInput').value = ''; $('tempInput').value = ''; $('noteInput').value = ''; $('ecErr').textContent = ''; $('tempErr').textContent = '';
    $('ecInput').classList.remove('bad'); $('tempInput').classList.remove('bad');
    setExtra($('btnGps'), 'gpsLabel', 'add_gps', ''); setExtra($('btnPhoto'), 'photoLabel', 'add_photo', ''); show($('photoPreview'), false);
    const wells = state.profile.wells || [];
    if (wells.length === 1) c.wellId = wells[0].id;
    renderWellChips(); renderUnits();
    showView('capture');
    const tick = () => { $('capTime').textContent = fmtDate(Date.now(), true); };
    tick(); clearInterval(clockTimer); clockTimer = setInterval(tick, 15000);
    setTimeout(() => { if (c.wellId) $('ecInput').focus(); }, 250);
  }

  function setExtra(btn, labelId, key, cls) { btn.className = 'extra ' + cls; $(labelId).textContent = t(key); }

  function renderWellChips() {
    const wells = state.profile.wells || [], box = $('wellChips'); box.innerHTML = '';
    wells.forEach(w => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (state.cap.wellId === w.id ? ' on' : ''); b.textContent = w.label;
      b.onclick = () => { state.cap.wellId = w.id; renderWellChips(); vibrate(10); };
      box.appendChild(b);
    });
    const add = document.createElement('button'); add.type = 'button'; add.className = 'chip add'; add.textContent = '+ ' + t('add_well');
    add.onclick = () => { show($('addWellRow'), true); $('newWellName').focus(); };
    box.appendChild(add);
    show($('addWellRow'), wells.length === 0);
  }

  function addWell(label) {
    label = (label || '').trim(); if (!label) return null;
    const base = label.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 24) || 'W';
    let id = base, n = 2; const ids = new Set(state.profile.wells.map(w => w.id));
    while (ids.has(id)) id = base + '-' + (n++);
    const w = { id, label }; state.profile.wells.push(w); saveProfile();
    return w;
  }

  function renderUnits() {
    const seg = $('unitSeg'); seg.innerHTML = '';
    C.EC_UNITS.forEach(u => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = u; b.dir = 'ltr'; b.className = state.cap.unit === u ? 'on' : '';
      b.onclick = () => { state.cap.unit = u; localStorage.setItem('wp_unit', u); renderUnits(); };
      seg.appendChild(b);
    });
  }

  async function getGps() {
    const btn = $('btnGps');
    if (!navigator.geolocation) { toast(t('gps_failed')); return; }
    setExtra(btn, 'gpsLabel', 'gps_wait', 'busy');
    navigator.geolocation.getCurrentPosition(pos => {
      state.cap.gps = { lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6), acc: Math.round(pos.coords.accuracy || 0) };
      setExtra(btn, 'gpsLabel', 'gps_added', 'done'); $('gpsLabel').textContent += ' (±' + state.cap.gps.acc + ' m)'; vibrate(10);
    }, () => { state.cap.gps = null; setExtra(btn, 'gpsLabel', 'gps_failed', ''); toast(t('gps_failed')); },
    { enableHighAccuracy: true, timeout: C.GPS_TIMEOUT_MS, maximumAge: 60000 });
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const scale = Math.min(1, C.PHOTO_MAX_PX / Math.max(img.width, img.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url); resolve(cv.toDataURL('image/jpeg', C.PHOTO_QUALITY));
      };
      img.onerror = reject; img.src = url;
    });
  }

  async function onPhoto(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      state.cap.photo = await compressImage(f);
      $('photoImg').src = state.cap.photo; show($('photoPreview'), true);
      setExtra($('btnPhoto'), 'photoLabel', 'photo_added', 'done'); vibrate(10);
    } catch (err) { toast('Photo error'); }
    e.target.value = '';
  }

  function fieldError(inputId, errId, msg) { $(errId).textContent = msg; $(inputId).classList.toggle('bad', !!msg); }

  async function saveReading() {
    const c = state.cap;
    if (!c.wellId) { toast(t('well_required')); vibrate([30, 30, 30]); return; }
    const ecRaw = U.normalizeNumber($('ecInput').value), tempRaw = U.normalizeNumber($('tempInput').value);
    let ok = true;
    if ($('ecInput').value.trim() === '') { fieldError('ecInput', 'ecErr', t('required')); ok = false; }
    else if (isNaN(ecRaw)) { fieldError('ecInput', 'ecErr', t('invalid_number')); ok = false; } else fieldError('ecInput', 'ecErr', '');
    if ($('tempInput').value.trim() === '') { fieldError('tempInput', 'tempErr', t('required')); ok = false; }
    else if (isNaN(tempRaw)) { fieldError('tempInput', 'tempErr', t('invalid_number')); ok = false; } else fieldError('tempInput', 'tempErr', '');
    if (!ok) { vibrate([30, 30, 30]); return; }

    const ecMs = U.toMilliSiemens(ecRaw, c.unit);
    const L = state.limits;
    const ecChk = U.checkRange(ecMs, L.ec), tChk = U.checkRange(tempRaw, L.temp);
    if (ecChk.level === 'hard') { fieldError('ecInput', 'ecErr', t('out_of_range_hard', { min: ecChk.min, max: ecChk.max }) + ' (mS/cm)'); vibrate([30, 30, 30]); return; }
    if (tChk.level === 'hard') { fieldError('tempInput', 'tempErr', t('out_of_range_hard', { min: tChk.min, max: tChk.max })); vibrate([30, 30, 30]); return; }
    if (ecChk.level === 'soft' && !(await confirmSoft(t('out_of_range_soft', { min: ecChk.min, max: ecChk.max }) + ' (mS/cm)'))) return;
    if (tChk.level === 'soft' && !(await confirmSoft(t('out_of_range_soft', { min: tChk.min, max: tChk.max }) + ' (°C)'))) return;
    const prev = state.readings.find(r => r.well_id === c.wellId);
    if (prev && U.isBigJump(ecMs, prev.ec_ms, C.JUMP_FRACTION) && !(await confirmSoft(t('big_jump', { prev: U.fmtNum(prev.ec_ms) + ' mS/cm' })))) return;

    const now = new Date();
    const rec = {
      id: U.uuid(), farmer_id: state.profile.farmerId, farmer_name: state.profile.farmerName || '',
      well_id: c.wellId, well_label: wellLabel(c.wellId),
      ts_local: U.isoLocal(now), ts_epoch: now.getTime(), tz: U.timezoneName(),
      ec: ecRaw, ec_unit: c.unit, ec_ms: +ecMs.toFixed(4), temp_c: tempRaw, meter_compensated: C.METER_COMPENSATED,
      lat: c.gps ? c.gps.lat : null, lon: c.gps ? c.gps.lon : null, acc_m: c.gps ? c.gps.acc : null,
      note: $('noteInput').value.trim(), photo: c.photo || undefined,
      app_version: C.APP_VERSION, device: navigator.userAgent.slice(0, 120), lang: I.getLang(),
      status: 'pending', created_at: now.getTime()
    };
    await DB.put(rec);
    clearInterval(clockTimer);
    await refreshReadings();
    vibrate([20, 40, 20]);
    showSuccess();
  }

  /* ---------- success overlay + sending ---------- */
  function showSuccess() {
    $('ovTitle').textContent = t('saved'); $('ovSub').textContent = t('saved_sub');
    const send = $('ovSend'); send.textContent = t('send_now'); send.disabled = false; send.className = 'btn primary big';
    const online = navigator.onLine !== false && S.hasServer();
    if (!online) { $('ovSub').textContent = t('saved_sub') + ' ' + (S.hasServer() ? t('offline') : t('no_server')); }
    show($('ovLater'), true);
    // restart animations
    const w = $('overlay').querySelector('.wave-wrap'); const clone = w.cloneNode(true); w.replaceWith(clone);
    show($('overlay'), true);
  }

  async function sendFromOverlay() {
    const send = $('ovSend');
    send.disabled = true; send.textContent = t('sending');
    const res = await doSync();
    if (res.total > 0 && res.sent === res.total) {
      send.className = 'btn accent big'; send.textContent = '✓ ' + t('sent_ok'); vibrate([20, 30, 60]);
      setTimeout(() => { show($('overlay'), false); showView('home'); }, 1300);
    } else {
      send.disabled = false; send.textContent = t('send_now');
      $('ovSub').textContent = syncMessage(res);
    }
  }

  function syncMessage(res) {
    if (res.error === 'no_server') return t('no_server');
    if (res.error === 'offline') return t('offline');
    if (res.total === 0) return t('all_sent');
    if (res.sent === res.total) return t('sent_ok');
    if (res.sent > 0) return t('sent_partial', { n: res.sent, t: res.total });
    return t('send_failed');
  }

  async function doSync(silent) {
    renderSyncCard();
    const res = await S.syncAll(() => renderSyncCard());
    await refreshReadings();
    const msg = res.busy ? '' : syncMessage(res);
    renderSyncCard(msg);
    if (state.view === 'home') { renderStats(); renderLast(); renderTrend(); }
    if (state.view === 'history') renderHistory();
    if (!silent && !res.busy && res.total > 0) toast(msg);
    return res;
  }

  /* ---------- history ---------- */
  async function renderHistory() {
    await refreshReadings();
    const box = $('histList'); box.innerHTML = '';
    if (!state.readings.length) { box.innerHTML = '<div class="empty">' + t('empty_history') + '</div>'; return; }
    let lastDay = '';
    state.readings.forEach(r => {
      const dl = dayLabel(r.ts_epoch);
      if (dl !== lastDay) { const h = document.createElement('div'); h.className = 'day'; h.textContent = dl; box.appendChild(h); lastDay = dl; }
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = '<div class="vals"><b dir="ltr">' + U.fmtNum(r.ec) + ' ' + esc(r.ec_unit) + '</b> · <span dir="ltr">' + U.fmtNum(r.temp_c, 1) + ' °C</span>' +
        '<div class="meta">' + esc(wellLabel(r.well_id)) + ' · ' + fmtDate(r.ts_epoch, true) + (r.photo || r.photo_url ? ' · 📷' : '') + (r.lat ? ' · 📍' : '') + '</div></div>' +
        '<span class="pill ' + r.status + '">' + t('status_' + r.status) + '</span>';
      row.onclick = () => showDetails(r);
      box.appendChild(row);
    });
  }

  async function showDetails(r) {
    const kv = (k, v) => '<div class="kv"><span>' + k + '</span><b dir="auto">' + v + '</b></div>';
    let body = kv(t('well'), esc(wellLabel(r.well_id))) + kv('EC', U.fmtNum(r.ec) + ' ' + esc(r.ec_unit)) + kv(t('temp_label'), U.fmtNum(r.temp_c, 1) + ' °C') +
      kv(t('time'), fmtDate(r.ts_epoch, true)) + kv(t('status_' + r.status), r.last_error ? esc(r.last_error) : '');
    if (r.lat) body += kv(t('location'), r.lat + ', ' + r.lon + ' (±' + r.acc_m + ' m)');
    if (r.note) body += kv(t('note'), esc(r.note));
    if (r.photo) body += '<img src="' + r.photo + '" style="width:100%;border-radius:12px;margin-top:10px" alt="">';
    else if (r.photo_url) body += kv(t('photo'), '<a href="' + esc(r.photo_url) + '" target="_blank" rel="noopener">📷</a>');
    const buttons = [{ label: t('ok'), cls: 'primary', value: 'ok' }];
    if (r.status !== 'sent' && r.status !== 'sending') buttons.push({ label: t('delete'), cls: 'ghost danger', value: 'del' });
    const v = await modal(t('details'), body, buttons);
    if (v === 'del' && await modal('', '<p>' + t('delete_q') + '</p>', [{ label: t('yes'), cls: 'primary', value: true }, { label: t('no'), cls: 'ghost', value: false }])) {
      await DB.del(r.id); await refreshReadings(); renderHistory(); renderSyncCard();
    }
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    $('setName').textContent = state.profile.farmerName || '–'; $('setId').textContent = state.profile.farmerId;
    $('setVersion').textContent = C.APP_VERSION; $('setServer').textContent = S.hasServer() ? S.apiUrl() : t('server_not_set');
    $('btnRefreshConfig').disabled = !S.hasServer();
    const box = $('setWells'); box.innerHTML = '';
    (state.profile.wells || []).forEach(w => { const s = document.createElement('span'); s.className = 'chip'; s.textContent = w.label; box.appendChild(s); });
    document.querySelectorAll('#langSeg button').forEach(b => b.classList.toggle('on', b.dataset.lang === I.getLang()));
  }

  async function refreshConfig() {
    try {
      const cfg = await S.fetchConfig(state.profile.farmerId);
      if (cfg && cfg.ok) {
        if (cfg.limits) { state.limits = cfg.limits; await DB.kvSet('limits', cfg.limits); }
        if (cfg.farmer) {
          if (cfg.farmer.name) state.profile.farmerName = cfg.farmer.name;
          if (Array.isArray(cfg.farmer.wells) && cfg.farmer.wells.length) {
            const ids = new Set(state.profile.wells.map(w => w.id));
            cfg.farmer.wells.forEach(w => { if (!ids.has(w.id)) state.profile.wells.push(w); else Object.assign(state.profile.wells.find(x => x.id === w.id), { label: w.label }); });
          }
          await saveProfile();
        }
        toast(t('config_updated')); renderSettings(); return true;
      }
      toast(t('config_failed'));
    } catch (e) { toast(t('config_failed')); }
    return false;
  }

  async function resetApp() {
    if (!(await modal('', '<p>' + t('reset_q') + '</p>', [{ label: t('yes'), cls: 'primary danger', value: true }, { label: t('no'), cls: 'ghost', value: false }]))) return;
    await DB.clear(); await DB.kvClear(); localStorage.clear();
    location.reload();
  }

  /* ---------- install / update ---------- */
  function setupInstall() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); state.deferredInstall = e;
      if (localStorage.getItem('wp_install_dismissed') !== '1') show($('installBanner'), true);
    });
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (isIos && !standalone && localStorage.getItem('wp_install_dismissed') !== '1') { show($('iosHint'), true); show($('btnInstall'), false); show($('installBanner'), true); }
    $('btnInstall').onclick = async () => {
      if (!state.deferredInstall) return;
      state.deferredInstall.prompt(); await state.deferredInstall.userChoice; state.deferredInstall = null; show($('installBanner'), false);
    };
    $('btnInstallLater').onclick = () => { localStorage.setItem('wp_install_dismissed', '1'); show($('installBanner'), false); };
    window.addEventListener('appinstalled', () => show($('installBanner'), false));
  }

  async function setupSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      state.swReg = reg;
      const onWaiting = () => { show($('updateBanner'), true); };
      if (reg.waiting) onWaiting();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) onWaiting(); });
      });
      $('btnUpdate').onclick = () => { reg.waiting && reg.waiting.postMessage({ type: 'SKIP_WAITING' }); };
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
      reg.update().catch(() => {});
    } catch (e) { /* offline first load without SW is fine */ }
  }

  /* ---------- enrol ---------- */
  function setupEnroll() {
    let lang = 'ar';
    document.querySelectorAll('#enrollLang button').forEach(b => b.onclick = () => { lang = b.dataset.lang; setLang(lang); });
    $('enrollGo').onclick = async () => {
      const id = $('enrollId').value.trim().toUpperCase(), name = $('enrollName').value.trim();
      if (!id) { $('enrollId').focus(); toast(t('required')); return; }
      state.profile = { farmerId: id, farmerName: name, wells: [], lang };
      await saveProfile(); afterProfile();
    };
  }

  async function afterProfile() {
    setLang(state.profile.lang || C.DEFAULT_LANG);
    const lim = await DB.kvGet('limits'); if (lim) state.limits = lim;
    showView('home');
    if (navigator.onLine !== false && S.hasServer()) { doSync(true); refreshConfig().catch(() => {}); }
  }

  /* ---------- init ---------- */
  async function init() {
    I.setLang(C.DEFAULT_LANG); I.apply();
    updateNet();
    window.addEventListener('online', () => { updateNet(); renderSyncCard(); if (S.hasServer()) doSync(); });
    window.addEventListener('offline', () => { updateNet(); renderSyncCard(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.profile && navigator.onLine !== false && pendingCount() && S.hasServer()) doSync(true); });

    document.querySelectorAll('#tabbar button').forEach(b => b.onclick = () => showView(b.dataset.view));
    $('btnStart').onclick = startCapture;
    $('btnCancel').onclick = () => { clearInterval(clockTimer); showView('home'); };
    $('btnSave').onclick = saveReading;
    $('btnGps').onclick = getGps;
    $('btnPhoto').onclick = () => $('photoInput').click();
    $('photoInput').onchange = onPhoto;
    $('btnPhotoRemove').onclick = () => { state.cap.photo = null; show($('photoPreview'), false); setExtra($('btnPhoto'), 'photoLabel', 'add_photo', ''); };
    $('btnAddWell').onclick = () => { const w = addWell($('newWellName').value); if (w) { state.cap.wellId = w.id; $('newWellName').value = ''; show($('addWellRow'), false); renderWellChips(); } };
    $('setAddWell').onclick = () => { if (addWell($('setNewWell').value)) { $('setNewWell').value = ''; renderSettings(); } };
    $('btnSend').onclick = () => doSync();
    $('ovSend').onclick = sendFromOverlay;
    $('ovLater').onclick = () => { show($('overlay'), false); showView('home'); };
    $('btnRefreshConfig').onclick = refreshConfig;
    $('btnReset').onclick = resetApp;
    document.querySelectorAll('#langSeg button').forEach(b => b.onclick = () => setLang(b.dataset.lang));
    ['ecInput', 'tempInput'].forEach(id => $(id).addEventListener('input', () => { $(id).classList.remove('bad'); $(id === 'ecInput' ? 'ecErr' : 'tempErr').textContent = ''; }));
    $('ecInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('tempInput').focus(); } });
    $('tempInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('tempInput').blur(); } });

    setupEnroll(); setupInstall(); setupSW();

    state.profile = await loadProfile();
    if (!state.profile) { showView('enroll'); return; }
    await afterProfile();
  }

  // Expose a tiny test hook (used by automated browser tests only).
  window.__wp = { state, doSync, DB, refreshReadings };
  document.addEventListener('DOMContentLoaded', init);
})();

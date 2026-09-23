/* Outbox sync with the Apps Script backend (or the local mock server). */
window.WP_SYNC = (function () {
  const DB = window.WP_DB;
  let syncing = false;

  function apiUrl() { return (localStorage.getItem('wp_api') || window.WP_CONFIG.API_URL || '').trim(); }
  function token() { return (localStorage.getItem('wp_token') || window.WP_CONFIG.API_TOKEN || '').trim(); }
  function hasServer() { return !!apiUrl(); }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /** Apps Script occasionally answers a transient 404/5xx on its redirect hop; retry once before giving up. */
  async function fetchJsonWithRetry(url, init) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, init);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) { lastErr = e; if (attempt === 0) await sleep(1500); }
    }
    throw lastErr;
  }

  function post(payload) {
    return fetchJsonWithRetry(apiUrl(), {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script cannot answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
  }

  /** Strip local-only fields before upload. */
  function toPayload(r) {
    const out = {};
    ['id', 'farmer_id', 'farmer_name', 'well_id', 'well_label', 'ts_local', 'ts_epoch', 'tz', 'ec', 'ec_unit', 'ec_ms',
      'temp_c', 'meter_compensated', 'lat', 'lon', 'acc_m', 'note', 'app_version', 'device', 'lang'].forEach(k => { if (r[k] !== undefined) out[k] = r[k]; });
    if (r.photo) out.photo = r.photo; // base64 data URL
    return out;
  }

  /**
   * Send all pending/failed readings. Returns { total, sent, failed, rejected, error }.
   * onProgress(sentSoFar, total) is optional.
   */
  async function syncAll(onProgress) {
    if (syncing) return { total: 0, sent: 0, failed: 0, rejected: 0, busy: true };
    syncing = true;
    try {
      const pending = [...await DB.byStatus('pending'), ...await DB.byStatus('failed')];
      const total = pending.length;
      const summary = { total, sent: 0, failed: 0, rejected: 0 };
      if (!total) return summary;
      if (!hasServer()) { summary.failed = total; summary.error = 'no_server'; return summary; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { summary.failed = total; summary.error = 'offline'; return summary; }

      // Small batches; readings with photos go one at a time to keep payloads modest.
      const batches = [];
      let cur = [];
      for (const r of pending) {
        if (r.photo) { if (cur.length) { batches.push(cur); cur = []; } batches.push([r]); }
        else { cur.push(r); if (cur.length >= 20) { batches.push(cur); cur = []; } }
      }
      if (cur.length) batches.push(cur);

      for (const batch of batches) {
        for (const r of batch) { r.status = 'sending'; await DB.put(r); }
        let res;
        try {
          res = await post({ action: 'submit', token: token(), records: batch.map(toPayload) });
        } catch (e) {
          for (const r of batch) { r.status = 'failed'; r.last_error = String(e.message || e); await DB.put(r); }
          summary.failed += batch.length; summary.error = 'network';
          continue;
        }
        if (!res || res.ok === false) {
          for (const r of batch) { r.status = 'failed'; r.last_error = (res && res.error) || 'server'; await DB.put(r); }
          summary.failed += batch.length; summary.error = (res && res.error) || 'server';
          continue;
        }
        const byId = {};
        (res.results || []).forEach(x => { byId[x.id] = x; });
        for (const r of batch) {
          const x = byId[r.id];
          if (x && x.ok) {
            r.status = 'sent'; r.sent_at = Date.now(); r.server_status = x.status; r.last_error = '';
            if (x.photo_url) r.photo_url = x.photo_url;
            if (r.photo) { r.photo_thumb = r.photo_thumb || null; delete r.photo; } // free space once uploaded
            summary.sent++;
          } else if (x && x.status === 'rejected') {
            r.status = 'rejected'; r.last_error = x.reason || 'rejected'; summary.rejected++;
          } else {
            r.status = 'failed'; r.last_error = (x && x.reason) || 'unknown'; summary.failed++;
          }
          await DB.put(r);
        }
        if (onProgress) onProgress(summary.sent, total);
      }
      return summary;
    } finally { syncing = false; }
  }

  async function fetchConfig(farmerId) {
    if (!hasServer()) throw new Error('no_server');
    const u = new URL(apiUrl());
    u.searchParams.set('action', 'config');
    u.searchParams.set('token', token());
    if (farmerId) u.searchParams.set('f', farmerId);
    return fetchJsonWithRetry(u.toString(), { redirect: 'follow' });
  }

  return { syncAll, fetchConfig, apiUrl, hasServer, toPayload, isSyncing: () => syncing };
})();

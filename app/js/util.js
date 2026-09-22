/* Pure helper functions shared by the app and the tests (no DOM access). */
(function (root) {
  const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
  const EXT_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

  /** Normalise a user-typed number: Arabic-Indic digits, Arabic decimal separator (٫), comma → dot. */
  function normalizeNumber(str) {
    if (str === null || str === undefined) return NaN;
    let s = String(str).trim();
    if (!s) return NaN;
    let out = '';
    for (const ch of s) {
      const i1 = ARABIC_INDIC.indexOf(ch);
      const i2 = EXT_ARABIC_INDIC.indexOf(ch);
      if (i1 >= 0) out += i1;
      else if (i2 >= 0) out += i2;
      else if (ch === '٫' || ch === ',') out += '.';
      else if (ch === '‏' || ch === '‎' || ch === ' ') continue; // bidi marks / spaces
      else out += ch;
    }
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(out)) return NaN;
    return parseFloat(out);
  }

  /** Convert an EC value in the given unit to mS/cm. */
  function toMilliSiemens(value, unit) {
    if (!isFinite(value)) return NaN;
    switch (unit) {
      case 'mS/cm': return value;
      case 'dS/m': return value;          // 1 dS/m == 1 mS/cm
      case 'µS/cm': case 'uS/cm': return value / 1000;
      default: return value;
    }
  }

  /** EC compensated to 25 °C using the common linear coefficient of 2 %/°C. */
  function ec25(ecMs, tempC, alpha) {
    const a = alpha || 0.02;
    if (!isFinite(ecMs) || !isFinite(tempC)) return NaN;
    return ecMs / (1 + a * (tempC - 25));
  }

  /**
   * Validate a value against limits. Returns { level: 'ok'|'soft'|'hard', min, max }.
   */
  function checkRange(value, lim) {
    if (!isFinite(value)) return { level: 'invalid' };
    if (lim.hardMin !== undefined && value < lim.hardMin) return { level: 'hard', min: lim.hardMin, max: lim.hardMax };
    if (lim.hardMax !== undefined && value > lim.hardMax) return { level: 'hard', min: lim.hardMin, max: lim.hardMax };
    if (lim.softMin !== undefined && value < lim.softMin) return { level: 'soft', min: lim.softMin, max: lim.softMax };
    if (lim.softMax !== undefined && value > lim.softMax) return { level: 'soft', min: lim.softMin, max: lim.softMax };
    return { level: 'ok' };
  }

  /** True when the new value differs from the previous by more than `fraction` of the previous. */
  function isBigJump(newVal, prevVal, fraction) {
    if (!isFinite(newVal) || !isFinite(prevVal) || prevVal === 0) return false;
    return Math.abs(newVal - prevVal) / Math.abs(prevVal) > fraction;
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    let d = Date.now();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (d + Math.random() * 16) % 16 | 0; d = Math.floor(d / 16);
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /** ISO 8601 local time with offset, e.g. 2026-09-22T14:05:09+02:00 */
  function isoLocal(date) {
    const d = date || new Date();
    const pad = n => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const a = Math.abs(off);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  }

  function timezoneName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  /** Parse the enrolment link parameters into a profile object, or null if no farmer id. */
  function parseEnrollParams(search) {
    const p = new URLSearchParams(search || '');
    const f = (p.get('f') || '').trim();
    if (!f) return null;
    const wells = (p.get('w') || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const [id, label] = s.split(':');
      return { id: id.trim(), label: (label || id).trim() };
    });
    return {
      farmerId: f,
      farmerName: (p.get('n') || '').trim(),
      wells,
      lang: p.get('l') === 'en' ? 'en' : 'ar',
      api: p.get('api') || null,
      token: p.get('token') || null
    };
  }

  function fmtNum(v, digits) {
    if (!isFinite(v)) return '–';
    return Number(v).toFixed(digits === undefined ? 2 : digits).replace(/\.?0+$/, '');
  }

  root.WP_UTIL = { normalizeNumber, toMilliSiemens, ec25, checkRange, isBigJump, uuid, isoLocal, timezoneName, parseEnrollParams, fmtNum };
})(typeof window !== 'undefined' ? window : module.exports);

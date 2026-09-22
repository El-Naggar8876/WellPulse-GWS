/* IndexedDB wrapper: readings store + key/value settings. */
window.WP_DB = (function () {
  const DB_NAME = 'wellpulse';
  const DB_VER = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('readings')) {
          const s = db.createObjectStore('readings', { keyPath: 'id' });
          s.createIndex('status', 'status', { unique: false });
          s.createIndex('ts', 'ts_epoch', { unique: false });
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      try { result = fn(s); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  function reqToPromise(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  const api = {
    put: r => tx('readings', 'readwrite', s => s.put(r)),
    get: id => reqToPromise('readings', 'readonly', s => s.get(id)),
    del: id => tx('readings', 'readwrite', s => s.delete(id)),
    all: () => reqToPromise('readings', 'readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => y.ts_epoch - x.ts_epoch)),
    byStatus: st => reqToPromise('readings', 'readonly', s => s.index('status').getAll(st)).then(a => (a || []).sort((x, y) => x.ts_epoch - y.ts_epoch)),
    clear: () => tx('readings', 'readwrite', s => s.clear()),
    kvGet: k => reqToPromise('kv', 'readonly', s => s.get(k)).then(r => (r ? r.v : undefined)),
    kvSet: (k, v) => tx('kv', 'readwrite', s => s.put({ k, v })),
    kvClear: () => tx('kv', 'readwrite', s => s.clear())
  };
  return api;
})();

/* db.js — Persistencia en IndexedDB. Todo queda en este dispositivo. */
(function (root) {
  'use strict';
  const NAME = 'conciliador', VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('movements')) db.createObjectStore('movements', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('matches')) db.createObjectStore('matches', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(stores, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transacción cancelada'));
      out = fn(t);
    }));
  }
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  const DB = {
    async getKV(key) { const db = await open(); return reqP(db.transaction('kv').objectStore('kv').get(key)); },
    setKV(key, value) { return tx(['kv'], 'readwrite', (t) => { t.objectStore('kv').put(value, key); }); },
    async getAll(store) { const db = await open(); return reqP(db.transaction(store).objectStore(store).getAll()); },
    putMany(store, values) { return tx([store], 'readwrite', (t) => { const s = t.objectStore(store); values.forEach((v) => s.put(v)); }); },
    deleteMany(store, keys) { return tx([store], 'readwrite', (t) => { const s = t.objectStore(store); keys.forEach((k) => s.delete(k)); }); },
    /** Reemplaza el contenido de 'matches' (pocos cientos de registros). */
    replaceAll(store, values) { return tx([store], 'readwrite', (t) => { const s = t.objectStore(store); s.clear(); values.forEach((v) => s.put(v)); }); },
    clearAll() { return tx(['kv', 'movements', 'matches'], 'readwrite', (t) => { ['kv', 'movements', 'matches'].forEach((n) => t.objectStore(n).clear()); }); },
    async loadAll() {
      const db = await open();
      const t = db.transaction(['kv', 'movements', 'matches']);
      const kvStore = t.objectStore('kv');
      const [keys, vals, movements, matches] = await Promise.all([
        reqP(kvStore.getAllKeys()), reqP(kvStore.getAll()), reqP(t.objectStore('movements').getAll()), reqP(t.objectStore('matches').getAll()),
      ]);
      const kv = {}; keys.forEach((k, i) => { kv[k] = vals[i]; });
      return { kv, movements, matches };
    },
    async restoreAll(data) {
      await DB.clearAll();
      await tx(['kv', 'movements', 'matches'], 'readwrite', (t) => {
        Object.entries(data.kv || {}).forEach(([k, v]) => t.objectStore('kv').put(v, k));
        (data.movements || []).forEach((m) => t.objectStore('movements').put(m));
        (data.matches || []).forEach((m) => t.objectStore('matches').put(m));
      });
    },
    /** Pide al navegador que no borre los datos por falta de espacio (si lo permite). */
    async persist() {
      try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* sin soporte */ }
      return false;
    },
  };
  root.DB = DB;
})(self);

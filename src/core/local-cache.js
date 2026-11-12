/**
 * Tiny IndexedDB key-value cache. Holds the last-synced copy of each data
 * collection so pages can render instantly, before Firestore answers.
 * Every call fails soft: a blocked or missing IndexedDB just means "no cache".
 */
const DB_NAME = "accounting-cache";
const STORE = "kv";
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run(mode, action) {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) return resolve(undefined);
    try {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

export function cacheGetMany(keys) {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) return resolve({});
    try {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const result = {};
      keys.forEach((key) => {
        const request = store.get(key);
        request.onsuccess = () => { result[key] = request.result; };
      });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve({});
    } catch {
      resolve({});
    }
  }));
}

export function cacheSet(key, value) {
  return run("readwrite", (store) => store.put(value, key));
}

export function cacheClear() {
  return run("readwrite", (store) => store.clear());
}

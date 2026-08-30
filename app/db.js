// IndexedDB wrapper — all app state lives here, per-device, no server sync
// (v1). No library: the API is verbose but this project has no other
// runtime dependency yet either, and four small object stores don't
// justify pulling one in. Not unit-testable under plain Node (no
// IndexedDB there) — kept intentionally small and verified manually
// in-browser instead (see plan's testing strategy).
const DB_NAME = "research-digest";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("papers")) {
        db.createObjectStore("papers", { keyPath: "arxiv_id" });
      }
      if (!db.objectStoreNames.contains("interests")) {
        db.createObjectStore("interests", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("saved")) {
        db.createObjectStore("saved", { keyPath: "arxiv_id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(storeName, mode) {
  const db = await getDb();
  return db.transaction(storeName, mode).objectStore(storeName);
}

export async function getAll(storeName) {
  return wrapRequest((await store(storeName, "readonly")).getAll());
}

export async function get(storeName, key) {
  return wrapRequest((await store(storeName, "readonly")).get(key));
}

export async function put(storeName, value) {
  return wrapRequest((await store(storeName, "readwrite")).put(value));
}

export async function del(storeName, key) {
  return wrapRequest((await store(storeName, "readwrite")).delete(key));
}

// Bulk write in a single transaction — used for seed-corpus import and
// batch upserts from a fetch run.
export async function putMany(storeName, values) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const objStore = transaction.objectStore(storeName);
    for (const v of values) objStore.put(v);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// settings is a plain key/value store — these two helpers hide that shape.
export async function getSetting(key, fallback = null) {
  const row = await get("settings", key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  return put("settings", { key, value });
}

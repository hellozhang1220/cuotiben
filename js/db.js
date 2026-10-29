// 本地存储层：基于 IndexedDB，错题数据存在 iPad 本地。
// 后续接入云端时，只需在此层之外加一个同步模块，业务代码无需改动。
const DB_NAME = 'cuotiben_db';
const DB_VERSION = 1;
const STORE = 'mistakes';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('grade', 'grade', { unique: false });
        os.createIndex('subject', 'subject', { unique: false });
        os.createIndex('status', 'status', { unique: false });
        os.createIndex('nextReviewAt', 'nextReviewAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

export async function getAllMistakes() {
  const os = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = os.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getMistake(id) {
  const os = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = os.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putMistake(m) {
  const os = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = os.put(m);
    req.onsuccess = () => resolve(m);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteMistake(id) {
  const os = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = os.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  const os = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = os.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

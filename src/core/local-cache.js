/**
 * @file แคชข้อมูลในเครื่อง (IndexedDB)
 *
 * เก็บสำเนาล่าสุดของข้อมูลแต่ละชุด เพื่อให้หน้าเว็บแสดงผลได้ทันทีโดยไม่ต้องรอ Firestore
 * ทุกฟังก์ชัน "ล้มเหลวแบบเงียบ": ถ้าเบราว์เซอร์ปิดกั้น IndexedDB ก็จะทำงานเหมือนไม่มีแคช
 *
 * รูปแบบข้อมูลที่เก็บ (คีย์ = ชื่อชุดข้อมูล):
 *   "entries" → { items: [...], chunks: 0, revision: "..." }
 *   "meta"    → { settings: {...}, importFiles: [...], revision: "..." }
 */

const DATABASE_NAME = "accounting-cache";
// ชื่อฐานข้อมูลและ object store ถูกบันทึกไว้ในเบราว์เซอร์ของผู้ใช้แล้ว ห้ามเปลี่ยน
// (ถ้าเปลี่ยนต้องเพิ่มเวอร์ชันใน indexedDB.open และสร้าง store ใหม่ใน onupgradeneeded)
const STORE_NAME = "kv";

/** @type {Promise<IDBDatabase | null> | null} เปิดฐานข้อมูลครั้งเดียวแล้วใช้ซ้ำ */
let databasePromise = null;

/**
 * เปิด (หรือสร้าง) ฐานข้อมูล IndexedDB
 * @returns {Promise<IDBDatabase | null>} null เมื่อใช้งาน IndexedDB ไม่ได้
 */
function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return databasePromise;
}

/**
 * อ่านหลายคีย์ในธุรกรรมเดียว
 * @param {string[]} keys
 * @returns {Promise<Record<string, any>>} คีย์ที่ไม่มีในแคชจะเป็น undefined
 */
export async function readCacheEntries(keys) {
  const database = await openDatabase();
  if (!database) return {};
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const entries = {};
      keys.forEach((key) => {
        const request = store.get(key);
        request.onsuccess = () => { entries[key] = request.result; };
      });
      transaction.oncomplete = () => resolve(entries);
      transaction.onerror = () => resolve({});
    } catch {
      resolve({});
    }
  });
}

/**
 * รันคำสั่งเขียนหนึ่งคำสั่ง แล้วรอจนธุรกรรมเสร็จ
 * @param {(store: IDBObjectStore) => void} writeOperation
 * @returns {Promise<void>}
 */
async function runWrite(writeOperation) {
  const database = await openDatabase();
  if (!database) return;
  await new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      writeOperation(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * บันทึกค่าหนึ่งคีย์ลงแคช
 * @param {string} key
 * @param {unknown} value
 */
export function writeCacheEntry(key, value) {
  return runWrite((store) => store.put(value, key));
}

/** ล้างแคชทั้งหมด (ใช้ตอนออกจากระบบหรือเปลี่ยนผู้ใช้) */
export function clearCache() {
  return runWrite((store) => store.clear());
}

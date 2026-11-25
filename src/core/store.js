/**
 * @file คลังข้อมูลกลางของแอป (state) และการซิงก์กับ Firestore
 *
 * ภาพรวมการทำงาน
 * ---------------
 * 1. หน้าเว็บเรียก `loadData([...ชุดข้อมูลที่ต้องใช้])`
 * 2. ถ้ามีสำเนาในแคชของเครื่องครบ → ใส่ลง `state` แล้วคืนค่าทันที (หน้าแสดงผลได้เลย)
 *    จากนั้นตรวจกับ Firestore เบื้องหลัง ถ้ามีข้อมูลใหม่จะยิงอีเวนต์ให้หน้าวาดใหม่ (ดู onDataRefresh)
 * 3. ถ้าไม่มีแคช → รอดาวน์โหลดจาก Firestore ก่อนคืนค่า
 * 4. หน้าเว็บแก้ไข `state` แล้วเรียก `saveData([...ชุดข้อมูลที่แก้])` เพื่อบันทึก
 *
 * โครงสร้างใน Firestore (collection "accounting")
 * -----------------------------------------------
 * - เอกสารละชุดข้อมูล เช่น "entries" = { items: [...] }
 * - ถ้าข้อมูลใหญ่เกิน ~700KB จะแบ่งเป็นหลายเอกสาร: "entries" = { chunks: 3 } + "entries_0", "entries_1", ...
 * - "meta"  = { settings, importFiles }
 * - "revs"  = รหัสรุ่น (revision) ของแต่ละชุดข้อมูล เปลี่ยนทุกครั้งที่บันทึก
 *             ใช้ตรวจว่าแคชยังตรงกับเซิร์ฟเวอร์หรือไม่ และกันการบันทึกทับข้อมูลที่เครื่องอื่นเพิ่งแก้
 * - "main"  = โครงสร้างแบบเก่า (เอกสารเดียว) ระบบจะย้ายข้อมูลให้อัตโนมัติครั้งแรก
 *
 * หมายเหตุ: ชื่อฟิลด์ที่เก็บในฐานข้อมูล (เช่น docNo, desc, autoDesc) ห้ามเปลี่ยนชื่อ
 * เพราะจะทำให้อ่านข้อมูลเดิมไม่ได้
 */
import {
  accountingDocument,
  createWriteBatch,
  deleteDoc as firestoreDeleteDoc,
  getDoc as firestoreGetDoc,
  setDoc as firestoreSetDoc,
} from "./firebase.js";
import { authReady, getRememberedUserId, redirectToLogin, rememberUser } from "./auth.js";
import { readCacheEntries, writeCacheEntry } from "./local-cache.js";
import { logAlert, notifyError, notify } from "../components/notifications.js";

/** ชุดข้อมูลแบบรายการ (array) ที่เก็บแยกเอกสารละชุด */
export const DATA_COLLECTIONS = [
  "accounts",      // ผังบัญชี
  "entries",       // รายการในสมุดรายวัน
  "customers",     // ทะเบียนลูกค้า
  "suppliers",     // ทะเบียนเจ้าหนี้ (ผู้ขาย/ซัพพลายเออร์)
  "receivables",   // ลูกหนี้
  "payables",      // เจ้าหนี้
  "autoDesc",      // แม่แบบคำอธิบายอัตโนมัติ
  "customerNames", // รายชื่อลูกค้าจากไฟล์
  "customerCosts", // ต้นทุน/ราคาขายตามลูกค้า
  "incomingDocs",  // เอกสารรับเข้า
];

/** คีย์ของเอกสารรวม settings + importFiles */
const META_KEY = "meta";

/**
 * ขนาดของ chunk ใหม่ (ตัวอักษร JSON) — เล็กพอให้การบันทึกแต่ละครั้งส่งข้อมูลน้อย จึงเร็ว
 * (Firestore จำกัดเอกสารละ 1MB)
 */
const MAX_CHUNK_SIZE = 150000;
/** ขนาด chunk ที่เวอร์ชันก่อนหน้าใช้ — ใช้แบ่งข้อมูลในแคชรุ่นเก่าให้ตรงกับบนเซิร์ฟเวอร์ */
const LEGACY_CHUNK_SIZE = 700000;
/**
 * chunk เดิมที่แก้ไขแล้วโตขึ้น ยอมให้ใหญ่ได้ถึงค่านี้ก่อนจะแยก
 * (ถ้าแยก chunk ตรงกลาง chunk ถัดไปทั้งหมดจะเลื่อนตำแหน่ง และต้องเขียนใหม่ทั้งหมด)
 */
const MAX_GROWN_CHUNK_SIZE = 800000;
/** รวมการเขียนเป็นชุดเดียว (batch) ได้เมื่อข้อมูลไม่เกินนี้ (Firestore จำกัดคำขอละ 10MB / 500 รายการ) */
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_OPERATIONS = 450;

const LEGACY_MAIN_DOCUMENT = accountingDocument("main");
const META_DOCUMENT = accountingDocument(META_KEY);
const REVISIONS_DOCUMENT = accountingDocument("revs");

/** อีเวนต์ที่ยิงเมื่อการซิงก์เบื้องหลังได้ข้อมูลใหม่ */
const DATA_REFRESH_EVENT = "app-data-refresh";

/**
 * สร้าง state เริ่มต้น (ว่างเปล่า)
 * @returns {AppState}
 */
export function createDefaultState() {
  return {
    accounts: [],
    entries: [],
    customers: [],
    suppliers: [],
    receivables: [],
    payables: [],
    autoDesc: [],
    customerNames: [],
    customerCosts: [],
    incomingDocs: [],
    importFiles: [],
    settings: {
      company: "",
      taxId: "",
      periodStart: "",
      periodEnd: "",
      currency: "THB",
      note: "",
      lockDate: "",     // วันที่ปิดงวด: รายการที่ลงวันที่ถึงวันนี้แก้ไขไม่ได้
      vatRate: 7,
      creditDays: 30,   // เครดิตเทอมเริ่มต้น (วัน) ใช้คำนวณวันครบกำหนดลูกหนี้/เจ้าหนี้
      accountMap: {},   // บัญชีที่ผู้ใช้กำหนดเองสำหรับลงบัญชีอัตโนมัติ { role: accountId }
      journalAccountSearch: false, // สมุดรายวัน: ช่องบัญชีพิมพ์ค้นหาได้ (false = เลือกจากรายการอย่างเดียว)
      journalPartyListOnFocus: true, // สมุดรายวัน: โฟกัสช่องชื่อลูกค้าแล้วแสดงรายการตัวเลือกทันที (false = แสดงเมื่อพิมพ์)
    },
  };
}

/**
 * @typedef {ReturnType<typeof createDefaultState>} AppState
 */

/**
 * ข้อมูลทั้งหมดที่โหลดมาแล้ว — ทุกหน้าอ่านจากตัวแปรนี้
 * (ES module ส่ง live binding ดังนั้นเมื่อ replaceState() เปลี่ยนค่า ไฟล์อื่นจะเห็นค่าใหม่ทันที)
 * @type {AppState}
 */
export let state = createDefaultState();

/** ซิงก์กับเซิร์ฟเวอร์สำเร็จอย่างน้อยหนึ่งครั้งแล้วหรือยัง (ถ้ายัง จะไม่อนุญาตให้บันทึก) */
let isSynced = false;
/** จำนวนเอกสารย่อย (chunk) ปัจจุบันของแต่ละชุดข้อมูล ใช้ลบ chunk ที่เหลือเมื่อข้อมูลเล็กลง */
const chunkCounts = Object.fromEntries(DATA_COLLECTIONS.map((collection) => [collection, 0]));
/**
 * สิ่งที่รู้ว่าอยู่บนเซิร์ฟเวอร์ตอนนี้ แยกตาม chunk — ใช้เขียนเฉพาะ chunk ที่เปลี่ยน
 * null/ไม่มี = ไม่รู้ (บันทึกครั้งถัดไปจะเขียนทุก chunk)
 * @type {Record<string, { isChunked: boolean, chunks: Array<{ ids: Set<string>, json: string }> } | null>}
 */
const serverChunks = {};
/**
 * ค่าล่าสุดที่ยืนยันแล้วว่าตรงกับบนเซิร์ฟเวอร์ (หลังโหลด/บันทึกสำเร็จ)
 * ใช้คืนค่าเมื่อบันทึกไม่สำเร็จ — ถูกต้องแม้จะกดบันทึกหลายครั้งติดกันก่อนครั้งแรกเสร็จ
 */
const confirmedValues = {};
/** จำค่าปัจจุบันใน state ของชุดข้อมูลเหล่านี้ว่าตรงกับเซิร์ฟเวอร์แล้ว */
function rememberConfirmed(keys, source = state) {
  keys.forEach((key) => {
    if (key === META_KEY) {
      confirmedValues.settings = source.settings;
      confirmedValues.importFiles = source.importFiles;
    } else {
      confirmedValues[key] = source[key];
    }
  });
}
/** รหัสรุ่นของข้อมูลที่อยู่ใน state ตอนนี้ */
const loadedRevisions = {};
/** การซิงก์ที่กำลังทำอยู่ — saveData() จะรอให้เสร็จก่อน */
let pendingSync = null;
/**
 * ชุดข้อมูลที่หน้านี้โหลดมาแล้ว — ใช้กันการบันทึกชุดที่ไม่ได้โหลด
 * (ถ้าบันทึก state.entries ที่ยังว่างเพราะไม่ได้โหลด ข้อมูลจริงบนเซิร์ฟเวอร์จะถูกเขียนทับจนหาย)
 */
const loadedCollections = new Set();

const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * ทำให้ข้อมูลอยู่ในรูปแบบที่ถูกต้องเสมอ (กันข้อมูลเก่าที่ขาดฟิลด์)
 * @param {Partial<AppState>} data
 * @returns {AppState}
 */
export function normalizeState(data) {
  const settings = { ...createDefaultState().settings, ...(data.settings || {}) };
  settings.accountMap = { ...(settings.accountMap || {}) };
  return {
    accounts: asArray(data.accounts),
    entries: asArray(data.entries).map((entry) => ({ ...entry, lines: asArray(entry.lines) })),
    customers: asArray(data.customers),
    suppliers: asArray(data.suppliers),
    receivables: asArray(data.receivables),
    payables: asArray(data.payables),
    autoDesc: asArray(data.autoDesc),
    customerNames: asArray(data.customerNames),
    customerCosts: asArray(data.customerCosts),
    incomingDocs: asArray(data.incomingDocs),
    importFiles: asArray(data.importFiles),
    settings,
  };
}

/**
 * แทนที่ state ทั้งก้อน (ใช้ก่อนบันทึก และใช้คืนค่าเดิมเมื่อบันทึกไม่สำเร็จ)
 * @param {Partial<AppState>} data
 */
export function replaceState(data) {
  state = normalizeState(data);
}

/**
 * แสดงสถานะการเชื่อมต่อที่มุมล่างของเมนู
 * @param {string} text
 * @param {boolean} [isError=false]
 * @param {number | null} [percent=null] ความคืบหน้า 0-100 (แสดงเป็นแถบสีใต้ข้อความ) — null = ไม่แสดงแถบ
 */
export function setSyncStatus(text, isError = false, percent = null) {
  const statusElement = document.getElementById("status");
  if (!statusElement) return;
  statusElement.textContent = text;
  statusElement.title = text;
  statusElement.classList.toggle("error", Boolean(isError));
  // data-state ใช้กำหนดสีจุดสถานะใน CSS: busy = เหลือง, ok = เขียว, error = แดง
  statusElement.dataset.state = isError ? "error" : /กำลัง/.test(text) ? "busy" : "ok";
  if (isError) logAlert(text, { title: "การเชื่อมต่อ/บันทึกข้อมูล" });
  if (percent == null) statusElement.style.removeProperty("--progress");
  else statusElement.style.setProperty("--progress", `${percent}%`);
}

/* ------------------------------------------------------------------ */
/* ความคืบหน้า (%) ของการโหลด/บันทึก                                     */
/* นับทุกคำขอที่ส่งไป Firestore ระหว่างงานหนึ่ง แล้วแสดง "เสร็จแล้วกี่ %"  */
/* ------------------------------------------------------------------ */

/** @type {{ label: string, total: number, done: number, expected: number, shownPercent: number } | null} */
let activeProgress = null;

/** ข้อความแทน "กำลังบันทึก" ระหว่างงานใหญ่ของหน้า เช่น "กำลังนำเข้าข้อมูล" (null = ใช้ข้อความปกติ) */
let activityLabel = null;

/**
 * ตั้งชื่องานที่กำลังทำ ให้สถานะมุมล่างของเมนูแสดงชื่องานนี้ (รวมตอนบันทึก เช่น "กำลังนำเข้าข้อมูล 40%")
 * @param {string | null} label ต้องขึ้นต้นด้วย "กำลัง" เพื่อให้จุดสถานะเป็นสีเหลือง · null = เลิกใช้
 */
export function setActivityLabel(label) {
  activityLabel = label || null;
  if (activityLabel) setSyncStatus(activityLabel);
}

/**
 * เริ่มนับความคืบหน้า
 * @param {string} label ข้อความหน้าตัวเลข % เช่น "กำลังบันทึก"
 * @param {number} expected จำนวนคำขอที่คาดว่าจะส่งทั้งหมด (ประมาณการ เพื่อให้ % ขยับสม่ำเสมอ)
 */
function startProgress(label, expected) {
  activeProgress = { label, total: 0, done: 0, expected, shownPercent: 0 };
  renderProgress();
}

/** ปรับประมาณการ: จะมีคำขอเพิ่มอีก count รายการนับจากตอนนี้ */
function expectMoreRequests(count) {
  if (!activeProgress) return;
  activeProgress.expected = activeProgress.total + count;
  renderProgress();
}

function renderProgress() {
  if (!activeProgress) return;
  const { label, total, done, expected } = activeProgress;
  // จำนวนคำขอเพิ่มขึ้นระหว่างทาง (เช่น เพิ่งรู้จำนวน chunk) จึงไม่ให้ตัวเลขถอยหลัง และค้างที่ 99% จนเสร็จจริง
  const denominator = Math.max(total, expected);
  const percent = denominator ? Math.min(99, Math.round((done / denominator) * 100)) : 0;
  activeProgress.shownPercent = Math.max(activeProgress.shownPercent, percent);
  setSyncStatus(`${label} ${activeProgress.shownPercent}%`, false, activeProgress.shownPercent);
}

/** จบงาน: ล้างตัวนับ (ข้อความสถานะถัดไปจะแทนที่ % เอง) */
function finishProgress() {
  activeProgress = null;
}

/** นับคำขอหนึ่งรายการ: เพิ่มยอดรวมตอนส่ง และเพิ่มยอดที่เสร็จตอนได้ผล */
function trackRequest(request) {
  const progress = activeProgress;
  if (!progress) return request;
  progress.total += 1;
  renderProgress();
  return request.finally(() => {
    progress.done += 1;
    if (activeProgress === progress) renderProgress();
  });
}

const getDoc = (...args) => trackRequest(firestoreGetDoc(...args));
const setDoc = (...args) => trackRequest(firestoreSetDoc(...args));
const deleteDoc = (...args) => trackRequest(firestoreDeleteDoc(...args));

/** แสดงชื่อกิจการใต้โลโก้ในเมนูด้านข้าง */
function showCompanyName() {
  const companyElement = document.getElementById("brand-company");
  if (companyElement && state.settings.company) companyElement.textContent = state.settings.company;
}

const isPermissionError = (error) =>
  Boolean(error) && (error.code === "permission-denied" || /permission/i.test(error.message || ""));

const createRevision = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ */
/* การอ่าน/เขียนชุดข้อมูลแบบแบ่ง chunk                                   */
/* ------------------------------------------------------------------ */

/**
 * แบ่งรายการออกเป็นกลุ่ม ให้แต่ละกลุ่มมีขนาด JSON ไม่เกิน maxSize
 * @param {unknown[]} records
 * @param {number} [maxSize=MAX_CHUNK_SIZE]
 * @returns {unknown[][]}
 */
function splitIntoChunks(records, maxSize = MAX_CHUNK_SIZE) {
  const chunks = [];
  let currentChunk = [];
  let currentSize = 2; // นับวงเล็บ [ ]
  for (const record of records) {
    const recordSize = JSON.stringify(record).length;
    const separatorSize = currentChunk.length ? 1 : 0;
    if (currentChunk.length && currentSize + separatorSize + recordSize > maxSize) {
      chunks.push(currentChunk);
      currentChunk = [record];
      currentSize = 2 + recordSize;
    } else {
      currentChunk.push(record);
      currentSize += separatorSize + recordSize;
    }
  }
  chunks.push(currentChunk);
  return chunks;
}

/**
 * ดาวน์โหลดชุดข้อมูลหนึ่งชุดจาก Firestore (รวม chunk ให้อัตโนมัติ)
 * @param {string} collection
 * @returns {Promise<{ items: unknown[], chunks: number, existed: boolean }>}
 */
async function downloadCollection(collection) {
  const snapshot = await getDoc(accountingDocument(collection));
  if (!snapshot.exists()) return { items: [], chunks: 0, existed: false, chunkItems: [] };

  const data = snapshot.data() || {};
  if (Array.isArray(data.items)) return { items: data.items, chunks: 0, existed: true, chunkItems: [data.items] };

  const chunkCount = Number(data.chunks) || 0;
  const chunkSnapshots = await Promise.all(
    Array.from({ length: chunkCount }, (_, chunkIndex) => getDoc(accountingDocument(`${collection}_${chunkIndex}`))),
  );
  const chunkItems = chunkSnapshots.map((chunkSnapshot) => {
    const chunkData = chunkSnapshot.exists() ? chunkSnapshot.data() || {} : {};
    return Array.isArray(chunkData.items) ? chunkData.items : [];
  });
  return { items: chunkItems.flat(), chunks: chunkCount, existed: true, chunkItems };
}

/**
 * แบ่ง chunk โดยพยายามให้แต่ละรายการอยู่ใน chunk เดิมบนเซิร์ฟเวอร์
 * → แก้ไข/เพิ่มรายการเดียว จะเปลี่ยนแค่ chunk เดียว (chunk อื่นไม่ต้องเขียนใหม่)
 * - รายการใหม่ที่ต่อท้าย ใส่ใน chunk เล็ก (MAX_CHUNK_SIZE) → แต่ละครั้งส่งข้อมูลน้อย
 * - chunk เดิมโตได้ถึง MAX_GROWN_CHUNK_SIZE โดยไม่ต้องแยก
 * ลำดับของรายการยังเหมือนเดิมทุกประการ
 * @param {unknown[]} records
 * @param {{ chunks: Array<{ ids: Set<string> }> } | null} known
 */
function planChunks(records, known) {
  if (!known || !known.chunks.length) return splitIntoChunks(records);
  const previousIndexById = new Map();
  known.chunks.forEach((chunk, chunkIndex) => chunk.ids.forEach((id) => previousIndexById.set(id, chunkIndex)));
  const lastKnownIndex = known.chunks.length - 1;

  const chunks = [];
  let currentChunk = null;
  let currentSize = 0;
  let currentPreviousIndex = -1;
  for (const record of records) {
    const recordSize = JSON.stringify(record).length;
    const previousIndex = record && record.id != null ? previousIndexById.get(String(record.id)) : undefined;
    const isNewRecord = previousIndex === undefined;
    const isExistingChunk = currentPreviousIndex >= 0 && chunks.length - 1 === currentPreviousIndex;
    // รายการใหม่ต่อท้าย chunk สุดท้าย → ใช้ขนาด chunk เล็ก (chunk เดิมที่ใหญ่จะไม่ถูกเขียนใหม่ทุกครั้ง)
    const isAppending = isNewRecord && currentPreviousIndex >= lastKnownIndex;
    const sizeLimit = isExistingChunk && !isAppending ? MAX_GROWN_CHUNK_SIZE : MAX_CHUNK_SIZE;
    let needsNewChunk = !currentChunk || (currentChunk.length > 0 && currentSize + 1 + recordSize > sizeLimit);
    if (!isNewRecord && previousIndex > currentPreviousIndex) {
      currentPreviousIndex = previousIndex;
      if (chunks.length - 1 < previousIndex) {
        // เว้น chunk ว่างไว้แทน chunk ที่รายการถูกลบหมด เพื่อให้ตำแหน่ง chunk ถัดไปไม่เลื่อน
        while (chunks.length < previousIndex) chunks.push([]);
        needsNewChunk = true;
      }
    }
    if (needsNewChunk) {
      currentChunk = [];
      chunks.push(currentChunk);
      currentSize = 2;
    }
    currentSize += (currentChunk.length ? 1 : 0) + recordSize;
    currentChunk.push(record);
  }
  if (!chunks.length) chunks.push([]);
  return chunks;
}

/**
 * วางแผนการเขียนชุดข้อมูลหนึ่งชุด: เขียนเฉพาะ chunk ที่เปลี่ยน และลบ chunk ที่ไม่ใช้แล้ว
 * @param {string} collection
 * @param {unknown[]} records
 * @returns {{ writes: Array<{ ref: object, data?: object, remove?: boolean, size: number }>,
 *             onSuccess: () => void, onFailure: () => void }}
 */
function planCollectionWrites(collection, records) {
  flushChunkSnapshot(collection);
  const known = serverChunks[collection] || null;
  const chunks = planChunks(records, known);
  const chunkJsons = chunks.map((items) => JSON.stringify(items));
  const isChunked = chunks.length > 1;
  const previousChunkCount = chunkCounts[collection] || 0;
  const writes = [];
  const chunkDocument = (chunkIndex) => accountingDocument(`${collection}_${chunkIndex}`);
  const writeDocument = (ref, data, size) => writes.push({ ref, data, size });
  const removeDocument = (ref) => writes.push({ ref, remove: true, size: 0 });
  /** chunk นี้บนเซิร์ฟเวอร์เหมือนเดิมทุกตัวอักษรหรือไม่ (เหมือน = ไม่ต้องเขียน) */
  const isUnchanged = (chunkIndex) => Boolean(known && known.isChunked === isChunked
    && known.chunks[chunkIndex] && known.chunks[chunkIndex].json === chunkJsons[chunkIndex]);

  if (!isChunked) {
    if (!isUnchanged(0)) writeDocument(accountingDocument(collection), { items: chunks[0] }, chunkJsons[0].length);
    for (let chunkIndex = 0; chunkIndex < previousChunkCount; chunkIndex += 1) removeDocument(chunkDocument(chunkIndex));
  } else {
    const isSameLayout = known && known.isChunked && previousChunkCount === chunks.length;
    if (!isSameLayout) writeDocument(accountingDocument(collection), { chunks: chunks.length }, 20);
    chunks.forEach((items, chunkIndex) => {
      if (!isUnchanged(chunkIndex)) writeDocument(chunkDocument(chunkIndex), { items }, chunkJsons[chunkIndex].length);
    });
    for (let chunkIndex = chunks.length; chunkIndex < previousChunkCount; chunkIndex += 1) removeDocument(chunkDocument(chunkIndex));
  }

  return {
    writes,
    onSuccess: () => {
      chunkCounts[collection] = isChunked ? chunks.length : 0;
      rememberServerChunks(collection, chunks, isChunked, chunkJsons);
    },
    // เขียนไม่สำเร็จ (อาจสำเร็จบางส่วน) → ไม่รู้แน่ว่าบนเซิร์ฟเวอร์เป็นอย่างไร ครั้งถัดไปให้เขียนทุก chunk
    onFailure: () => { serverChunks[collection] = null; },
  };
}

/**
 * อัปโหลดชุดข้อมูลหนึ่งชุดโดยไม่เขียนรหัสรุ่น (ใช้ตอนย้ายข้อมูลจากโครงสร้างเก่า)
 * @param {string} collection
 * @param {unknown[]} records
 */
async function uploadCollection(collection, records) {
  const plan = planCollectionWrites(collection, records);
  try {
    await Promise.all(plan.writes.map((write) => (write.remove ? deleteDoc(write.ref) : setDoc(write.ref, write.data))));
  } catch (error) {
    plan.onFailure();
    throw error;
  }
  plan.onSuccess();
}

/**
 * ส่งการเขียนทั้งหมดไปเซิร์ฟเวอร์
 * - ข้อมูลไม่ใหญ่ (กรณีปกติ): รวมเป็น batch เดียว → ส่งครั้งเดียว และสำเร็จ/ล้มเหลวพร้อมกันทั้งหมด
 * - ข้อมูลใหญ่มาก (เช่น เขียนใหม่ทั้งชุดครั้งแรก): เขียนข้อมูลพร้อมกันหลายคำขอ แล้วค่อยเขียนรหัสรุ่น
 * @param {Array<{ ref: object, data?: object, remove?: boolean, size: number, merge?: boolean }>} writes
 * @param {{ ref: object, data: object }} revisionWrite เขียนรหัสรุ่นใหม่ (ต้องเกิดหลัง/พร้อมข้อมูลเสมอ)
 */
async function commitWrites(writes, revisionWrite) {
  const totalBytes = writes.reduce((total, write) => total + write.size, 0);
  if (totalBytes <= MAX_BATCH_BYTES && writes.length + 1 <= MAX_BATCH_OPERATIONS) {
    const batch = createWriteBatch();
    writes.forEach((write) => {
      if (write.remove) batch.delete(write.ref);
      else batch.set(write.ref, write.data);
    });
    batch.set(revisionWrite.ref, revisionWrite.data, { merge: true });
    await trackRequest(batch.commit());
    return;
  }
  await Promise.all(writes.map((write) => (write.remove ? deleteDoc(write.ref) : setDoc(write.ref, write.data))));
  await setDoc(revisionWrite.ref, revisionWrite.data, { merge: true });
}

/* ------------------------------------------------------------------ */
/* แคชในเครื่อง                                                         */
/* ------------------------------------------------------------------ */

function cacheCollection(collection) {
  const known = serverChunks[collection];
  return writeCacheEntry(collection, {
    items: state[collection],
    chunks: chunkCounts[collection] || 0,
    // จำนวนรายการในแต่ละ chunk บนเซิร์ฟเวอร์ (ใช้สร้างข้อมูล serverChunks จากแคชได้)
    chunkLengths: known ? known.chunks.map((chunk) => chunk.length) : null,
    revision: loadedRevisions[collection] || "",
  });
}

/** สรุป chunk หนึ่ง: id ของรายการ + JSON ไว้เทียบว่าเปลี่ยนหรือไม่ */
function describeChunk(items, json = JSON.stringify(items)) {
  const ids = new Set();
  items.forEach((item) => { if (item && item.id != null) ids.add(String(item.id)); });
  return { ids, json, length: items.length };
}

/** จำว่าบนเซิร์ฟเวอร์มี chunk อะไรบ้าง */
function rememberServerChunks(collection, chunkItems, isChunked, jsons = null) {
  serverChunks[collection] = {
    isChunked,
    chunks: chunkItems.map((items, index) => describeChunk(items, jsons ? jsons[index] : undefined)),
  };
}

/**
 * สร้าง serverChunks จากแคช (แคชตรงกับเซิร์ฟเวอร์เพราะตรวจรหัสรุ่นแล้ว)
 * ทำตอนเครื่องว่าง เพื่อไม่ให้หน้าเว็บโหลดช้าลง
 */
function rememberServerChunksFromCache(collection, cacheEntry) {
  serverChunks[collection] = null;
  const items = cacheEntry && cacheEntry.items;
  if (!Array.isArray(items)) return;
  const lengths = cacheEntry.chunkLengths;
  const serverChunkCount = cacheEntry.chunks || 0;
  const isChunked = serverChunkCount > 0;

  const compute = () => {
    if (serverChunks[collection] !== null) return; // มีข้อมูลที่ใหม่กว่าแล้ว (ดาวน์โหลด/บันทึก)
    let slices = null;
    if (Array.isArray(lengths) && lengths.reduce((total, length) => total + length, 0) === items.length) {
      slices = [];
      let offset = 0;
      lengths.forEach((length) => {
        slices.push(items.slice(offset, offset + length));
        offset += length;
      });
    } else {
      // แคชรุ่นเก่า (ไม่มี chunkLengths): เวอร์ชันก่อนหน้าแบ่ง chunk ด้วย splitIntoChunks เสมอ
      // จึงแบ่งซ้ำแบบเดียวกันได้ — ใช้เมื่อจำนวน chunk ตรงกับที่บันทึกไว้เท่านั้น
      const greedyChunks = splitIntoChunks(items, LEGACY_CHUNK_SIZE);
      const greedyCount = greedyChunks.length === 1 ? 0 : greedyChunks.length;
      if (greedyCount === serverChunkCount) slices = greedyChunks;
    }
    if (slices) rememberServerChunks(collection, slices, isChunked);
  };
  pendingChunkSnapshots.set(collection, compute);
  // คำนวณตอนเครื่องว่าง เพื่อไม่ให้หน้าเว็บโหลดช้าลง (ถ้ากดบันทึกก่อน จะคำนวณทันทีใน planCollectionWrites)
  const schedule = window.requestIdleCallback || ((callback) => setTimeout(callback, 200));
  schedule(() => {
    if (pendingChunkSnapshots.get(collection) === compute) {
      pendingChunkSnapshots.delete(collection);
      compute();
    }
  });
}

/** งานสร้าง serverChunks จากแคชที่ยังไม่ได้ทำ (บันทึกก่อนเครื่องว่าง → ทำทันที) */
const pendingChunkSnapshots = new Map();
function flushChunkSnapshot(collection) {
  const compute = pendingChunkSnapshots.get(collection);
  if (!compute) return;
  pendingChunkSnapshots.delete(collection);
  compute();
}

function cacheMeta() {
  return writeCacheEntry(META_KEY, {
    settings: state.settings,
    importFiles: state.importFiles,
    revision: loadedRevisions[META_KEY] || "",
  });
}

/**
 * ใส่ข้อมูลจากแคชลง state (ใช้ตอนเปิดหน้าแบบทันที)
 * @param {string[]} collections
 * @param {Record<string, any>} cacheEntries
 */
function applyCacheToState(collections, cacheEntries) {
  collections.forEach((collection) => loadedCollections.add(collection));
  collections.forEach((collection) => rememberServerChunksFromCache(collection, cacheEntries[collection]));
  const data = { ...state, settings: cacheEntries.meta.settings, importFiles: cacheEntries.meta.importFiles };
  collections.forEach((collection) => {
    data[collection] = cacheEntries[collection].items;
    chunkCounts[collection] = cacheEntries[collection].chunks || 0;
    loadedRevisions[collection] = cacheEntries[collection].revision;
  });
  loadedRevisions[META_KEY] = cacheEntries.meta.revision;
  state = normalizeState(data);
  rememberConfirmed([...collections, META_KEY]);
}

/* ------------------------------------------------------------------ */
/* การซิงก์กับ Firestore                                                */
/* ------------------------------------------------------------------ */

async function readRemoteRevisions() {
  const snapshot = await getDoc(REVISIONS_DOCUMENT);
  return { exists: snapshot.exists(), revisions: snapshot.exists() ? snapshot.data() || {} : {} };
}

/**
 * ย้ายข้อมูลจากโครงสร้างเก่า (เอกสาร "main" เอกสารเดียว) ไปเป็นแบบแยกชุด ทำครั้งเดียว
 */
async function migrateLegacyMainDocument() {
  const mainSnapshot = await getDoc(LEGACY_MAIN_DOCUMENT);
  if (!mainSnapshot.exists()) return;
  state = normalizeState(mainSnapshot.data() || {});
  try {
    await Promise.all([
      ...DATA_COLLECTIONS.map((collection) => uploadCollection(collection, state[collection])),
      setDoc(META_DOCUMENT, { importFiles: state.importFiles, settings: state.settings }),
    ]);
    notify("ย้ายข้อมูลไปยังโครงสร้างใหม่เรียบร้อย");
  } catch (error) {
    console.warn("ย้ายข้อมูลจากโครงสร้างเก่าไม่สำเร็จ", error);
  }
}

/**
 * ประทับรหัสรุ่นให้ชุดข้อมูลที่ยังไม่มี เพื่อให้ครั้งต่อไปข้ามการดาวน์โหลดได้
 * @param {string[]} keys
 * @param {Record<string, string>} remoteRevisions (ถูกแก้ไขในฟังก์ชันนี้)
 */
async function stampMissingRevisions(keys, remoteRevisions) {
  const missing = {};
  keys.forEach((key) => {
    if (!remoteRevisions[key]) missing[key] = createRevision();
  });
  if (!Object.keys(missing).length) return;
  try {
    await setDoc(REVISIONS_DOCUMENT, missing, { merge: true });
    Object.assign(remoteRevisions, missing);
  } catch (error) {
    console.warn("บันทึกรหัสรุ่นข้อมูลไม่สำเร็จ", error);
  }
}

let isPrefetching = false;

/**
 * โหลดชุดข้อมูลที่หน้านี้ไม่ได้ใช้ เก็บลงแคชในเครื่องล่วงหน้า (เบื้องหลัง)
 * → หลังเข้าสู่ระบบ เปิดเมนูไหนก็แสดงข้อมูลได้ทันทีจากแคช ไม่ต้องรอดาวน์โหลด
 * ไม่แตะ state ของหน้าปัจจุบัน ดาวน์โหลดเฉพาะชุดที่รหัสรุ่นในแคชไม่ตรงกับเซิร์ฟเวอร์
 * @param {string[]} pageCollections ชุดข้อมูลที่หน้านี้โหลดไปแล้ว
 * @param {Record<string, string>} remoteRevisions รหัสรุ่นบนเซิร์ฟเวอร์ที่เพิ่งอ่านมา
 */
function prefetchOtherCollections(pageCollections, remoteRevisions) {
  if (isPrefetching) return;
  const others = DATA_COLLECTIONS.filter((collection) => !pageCollections.includes(collection));
  if (!others.length) return;
  isPrefetching = true;
  const schedule = window.requestIdleCallback || ((callback) => setTimeout(callback, 300));
  schedule(async () => {
    try {
      const cacheEntries = await readCacheEntries(others);
      const stale = others.filter((collection) => {
        const cached = cacheEntries[collection];
        return !cached || !remoteRevisions[collection] || cached.revision !== remoteRevisions[collection];
      });
      // ทีละชุด เพื่อไม่แย่งเครือข่ายกับการบันทึกของผู้ใช้
      for (const collection of stale) {
        const download = await downloadCollection(collection);
        // หน้านี้อาจโหลด/บันทึกชุดนี้เองระหว่างนั้น → ให้ข้อมูลของหน้าเป็นตัวจริง ไม่เขียนทับ
        if (loadedCollections.has(collection)) continue;
        await writeCacheEntry(collection, {
          items: download.items,
          chunks: download.chunks,
          chunkLengths: download.chunkItems.map((items) => items.length),
          revision: remoteRevisions[collection] || "",
        });
      }
    } catch (error) {
      console.warn("โหลดข้อมูลล่วงหน้าไม่สำเร็จ (จะโหลดเมื่อเปิดหน้านั้นแทน)", error);
    } finally {
      isPrefetching = false;
    }
  });
}

/**
 * ทำให้ชุดข้อมูลที่ขอตรงกับ Firestore — ชุดที่รหัสรุ่นในแคชตรงกับเซิร์ฟเวอร์จะไม่ดาวน์โหลดซ้ำ
 * @param {string[]} collections ชุดข้อมูลที่หน้านี้ต้องใช้
 * @param {Record<string, any>} cacheEntries ข้อมูลในแคช (อาจไม่ครบ)
 * @param {boolean} isBackground true = หน้าแสดงข้อมูลจากแคชไปแล้ว กำลังตรวจสอบเบื้องหลัง
 * @returns {Promise<boolean>} พร้อมใช้งานหรือไม่
 */
async function syncWithServer(collections, cacheEntries, isBackground) {
  try {
    const user = await authReady;
    if (!user) {
      redirectToLogin();
      return false;
    }

    const estimateDownload = (collection) => 1 + ((cacheEntries[collection] && cacheEntries[collection].chunks) || chunkCounts[collection] || 0);
    const sum = (numbers) => numbers.reduce((total, number) => total + number, 0);
    startProgress(isBackground ? "กำลังซิงก์ข้อมูล" : "กำลังโหลดข้อมูล", 2 + sum(collections.map(estimateDownload)));
    const remote = await readRemoteRevisions();
    const isStale = (key) => !cacheEntries[key] || !remote.revisions[key] || remote.revisions[key] !== cacheEntries[key].revision;
    const staleCollections = collections.filter(isStale);
    const isMetaStale = isStale(META_KEY);
    // รู้แล้วว่าต้องดาวน์โหลดชุดไหนบ้าง จึงปรับประมาณการให้ตรงขึ้น
    expectMoreRequests(sum(staleCollections.map(estimateDownload)) + (isMetaStale ? 1 : 0));

    const [downloads, metaSnapshot] = await Promise.all([
      Promise.all(staleCollections.map(downloadCollection)),
      isMetaStale ? getDoc(META_DOCUMENT) : Promise.resolve(null),
    ]);

    const isEmptyDatabase = !remote.exists
      && !downloads.some((download) => download.existed)
      && !(metaSnapshot && metaSnapshot.exists());
    if (isEmptyDatabase && !isBackground) await migrateLegacyMainDocument();

    // รวมข้อมูลที่ดาวน์โหลดใหม่กับข้อมูลในแคชที่ยังใช้ได้
    const nextData = { ...state };
    const changedKeys = [];
    staleCollections.forEach((collection, index) => {
      nextData[collection] = downloads[index].items;
      chunkCounts[collection] = downloads[index].chunks;
      rememberServerChunks(collection, downloads[index].chunkItems, downloads[index].chunks > 0);
      changedKeys.push(collection);
    });

    let usedCache = false;
    collections.forEach((collection) => {
      if (staleCollections.includes(collection) || !cacheEntries[collection]) return;
      chunkCounts[collection] = cacheEntries[collection].chunks || 0;
      if (!serverChunks[collection]) rememberServerChunksFromCache(collection, cacheEntries[collection]);
      if (!isBackground) {
        nextData[collection] = cacheEntries[collection].items;
        usedCache = true;
      }
    });

    if (isMetaStale && metaSnapshot) {
      const meta = metaSnapshot.exists() ? metaSnapshot.data() || {} : {};
      if ("importFiles" in meta) nextData.importFiles = meta.importFiles;
      if ("settings" in meta) nextData.settings = meta.settings;
      changedKeys.push(META_KEY);
    } else if (!isBackground && cacheEntries.meta) {
      nextData.importFiles = cacheEntries.meta.importFiles;
      nextData.settings = cacheEntries.meta.settings;
      usedCache = true;
    }
    if (changedKeys.length || usedCache) state = normalizeState(nextData);
    rememberConfirmed(isBackground ? changedKeys : [...collections, META_KEY]);

    await stampMissingRevisions([...collections, META_KEY], remote.revisions);
    [...collections, META_KEY].forEach((key) => { loadedRevisions[key] = remote.revisions[key] || ""; });
    await Promise.all([...collections.map(cacheCollection), cacheMeta()]);

    collections.forEach((collection) => loadedCollections.add(collection));
    isSynced = true;
    finishProgress();
    showCompanyName();
    setSyncStatus("ซิงก์ข้อมูลแล้ว");
    prefetchOtherCollections(collections, remote.revisions);

    // แจ้งหน้าเว็บให้วาดใหม่ เฉพาะกรณีที่หน้าแสดงข้อมูลจากแคชไปแล้วและข้อมูลเปลี่ยนจริง
    const refreshedKeys = isBackground ? changedKeys.filter((key) => cacheEntries[key]) : [];
    if (refreshedKeys.length) {
      window.dispatchEvent(new CustomEvent(DATA_REFRESH_EVENT, { detail: { keys: refreshedKeys } }));
      notify("อัปเดตข้อมูลล่าสุดจากเซิร์ฟเวอร์แล้ว");
    }
    return true;
  } catch (error) {
    console.error(error);
    finishProgress();
    if (isPermissionError(error)) {
      setSyncStatus("ไม่มีสิทธิ์เข้าถึงข้อมูล", true);
      notifyError("บัญชีผู้ใช้นี้ไม่มีสิทธิ์เข้าถึงข้อมูล");
      return false;
    }
    if (isBackground) {
      // ออฟไลน์: ยังดูข้อมูลจากแคชได้ แต่บันทึกไม่ได้จนกว่าจะเชื่อมต่อสำเร็จ
      setSyncStatus("ออฟไลน์ · แสดงข้อมูลที่บันทึกไว้ในเครื่อง", true);
      return true;
    }
    setSyncStatus(`เชื่อมต่อ Firebase ไม่สำเร็จ: ${error.message || error}`, true);
    notifyError("เชื่อมต่อ Firebase ไม่สำเร็จ");
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* API สำหรับหน้าเว็บ                                                   */
/* ------------------------------------------------------------------ */

/**
 * โหลดชุดข้อมูลที่หน้าต้องใช้
 * @param {string[]} [collections=DATA_COLLECTIONS] เช่น ["accounts", "entries"]
 * @returns {Promise<boolean>} true เมื่อ state พร้อมแสดงผล
 *
 * @example
 * if (await loadData(["accounts", "entries"])) renderPage();
 */
export async function loadData(collections = DATA_COLLECTIONS) {
  const requested = [...new Set(collections)];
  const unknown = requested.filter((collection) => !DATA_COLLECTIONS.includes(collection));
  if (unknown.length) throw new Error(`ไม่รู้จักชุดข้อมูล: ${unknown.join(", ")}`);

  // ยังไม่เคยล็อกอินบนเครื่องนี้: ต้องรอ Firebase ยืนยันตัวตนก่อน
  if (!getRememberedUserId()) {
    const user = await authReady;
    if (!user) {
      redirectToLogin();
      return false;
    }
    await rememberUser(user);
  }

  const cacheEntries = await readCacheEntries([...requested, META_KEY]);
  const isCacheComplete = Boolean(cacheEntries.meta) && requested.every((collection) => cacheEntries[collection]);

  if (isCacheComplete) {
    applyCacheToState(requested, cacheEntries);
    showCompanyName();
    setSyncStatus("กำลังซิงก์ข้อมูล 0%", false, 0);
    pendingSync = syncWithServer(requested, cacheEntries, true);
    return true;
  }

  setSyncStatus("กำลังโหลดข้อมูล 0%", false, 0);
  pendingSync = syncWithServer(requested, cacheEntries, false);
  return pendingSync;
}

/**
 * ลงทะเบียนฟังก์ชันวาดหน้าใหม่ เมื่อการซิงก์เบื้องหลังได้ข้อมูลที่ใหม่กว่า
 * @param {(changedKeys: string[]) => void} callback
 */
export function onDataRefresh(callback) {
  window.addEventListener(DATA_REFRESH_EVENT, (event) => callback(event.detail.keys));
}

/**
 * ตรวจข้อมูลใหม่อีกครั้ง เมื่อหน้าถูกแสดงจริงหลังจากโหลดไว้ล่วงหน้า
 *
 * เมนูด้านข้าง prerender หน้าถัดไปตอนชี้เมาส์ (app-shell.js) — หน้านั้นอ่านข้อมูลไว้ "ก่อน" ผู้ใช้คลิก
 * ถ้าระหว่างนั้นผู้ใช้เพิ่มข้อมูลในหน้าปัจจุบัน (เช่น เพิ่มลูกค้า) หน้าที่โหลดไว้จะยังเป็นข้อมูลเก่า
 * → ตอนแสดงหน้า: ใช้ข้อมูลในแคชที่ใหม่กว่า (หน้าก่อนหน้าเพิ่งบันทึก) แล้วตรวจกับเซิร์ฟเวอร์ซ้ำ
 * ใช้กับหน้าที่เบราว์เซอร์เก็บไว้ (กดย้อนกลับ / bfcache) ด้วย
 */
async function refreshAfterPageShown() {
  if (pendingSync) await pendingSync;
  if (!isSynced || hasPendingSave()) return;
  const collections = [...loadedCollections];
  if (!collections.length) return;
  const cacheEntries = await readCacheEntries([...collections, META_KEY]);

  // แคชใหม่กว่าข้อมูลในหน้า (รหัสรุ่นต่างกัน) → ใช้ข้อมูลในแคชทันที
  const changedKeys = collections.filter((key) => cacheEntries[key] && cacheEntries[key].revision
    && cacheEntries[key].revision !== loadedRevisions[key]);
  const isMetaChanged = Boolean(cacheEntries.meta && cacheEntries.meta.revision
    && cacheEntries.meta.revision !== loadedRevisions[META_KEY]);
  if (changedKeys.length || isMetaChanged) {
    const nextData = { ...state };
    changedKeys.forEach((key) => {
      nextData[key] = cacheEntries[key].items;
      chunkCounts[key] = cacheEntries[key].chunks || 0;
      loadedRevisions[key] = cacheEntries[key].revision;
      rememberServerChunksFromCache(key, cacheEntries[key]);
    });
    if (isMetaChanged) {
      nextData.settings = cacheEntries.meta.settings;
      nextData.importFiles = cacheEntries.meta.importFiles;
      loadedRevisions[META_KEY] = cacheEntries.meta.revision;
    }
    state = normalizeState(nextData);
    const keys = [...changedKeys, ...(isMetaChanged ? [META_KEY] : [])];
    rememberConfirmed(keys);
    window.dispatchEvent(new CustomEvent(DATA_REFRESH_EVENT, { detail: { keys } }));
  }
  // แคชอาจยังไม่ทันเขียน (เพิ่งบันทึกเสร็จ) → ตรวจกับเซิร์ฟเวอร์อีกรอบ ได้ข้อมูลใหม่จะวาดหน้าใหม่ให้เอง
  pendingSync = syncWithServer(collections, cacheEntries, true);
}

if (document.prerendering) {
  document.addEventListener("prerenderingchange", () => { refreshAfterPageShown(); }, { once: true });
}
window.addEventListener("pageshow", (event) => {
  if (event.persisted) refreshAfterPageShown();
});

/**
 * บันทึกจริงหนึ่งครั้ง (เรียกผ่านคิวใน saveData เท่านั้น)
 * - ปฏิเสธการบันทึก ถ้าเครื่องอื่นแก้ชุดข้อมูลเดียวกันหลังจากที่เราโหลดมา แล้วโหลดข้อมูลล่าสุดมาแทน
 * @param {string[]} [keys]
 * @returns {Promise<boolean>}
 */
async function performSave(keys) {
  if (pendingSync) await pendingSync;
  if (!isSynced) {
    notifyError("ยังเชื่อมต่อข้อมูลไม่สำเร็จ บันทึกไม่ได้");
    return false;
  }

  // settings และ importFiles เก็บรวมกันในเอกสาร "meta"
  const toStorageKey = (key) => (key === "settings" || key === "importFiles" ? META_KEY : key);
  const targets = [...new Set((keys && keys.length ? keys : [...DATA_COLLECTIONS, META_KEY]).map(toStorageKey))];

  // ป้องกันข้อมูลหาย: ห้ามบันทึกชุดข้อมูลที่หน้านี้ไม่ได้โหลด (ยกเว้นการบันทึกทั้งหมด เช่น กู้คืนไฟล์สำรอง)
  const isFullReplace = !(keys && keys.length);
  const notLoaded = targets.filter((key) => DATA_COLLECTIONS.includes(key) && !loadedCollections.has(key));
  if (!isFullReplace && notLoaded.length) {
    console.error("saveData: collections were not loaded on this page", notLoaded);
    notifyError(`ระบบป้องกันการบันทึก: หน้านี้ไม่ได้โหลดข้อมูล ${notLoaded.join(", ")} (ข้อมูลจริงไม่ถูกแก้ไข)`);
    return false;
  }

  try {
    const savedCollections = targets.filter((key) => DATA_COLLECTIONS.includes(key));
    // คำขอ: อ่านรหัสรุ่น 1 + เขียน (ปกติรวมเป็น batch เดียว) — ปรับตัวเลขจริงหลังวางแผนการเขียน
    startProgress(activityLabel || "กำลังบันทึก", 2);
    const remote = await readRemoteRevisions();
    const conflictingKeys = targets.filter(
      (key) => remote.revisions[key] && loadedRevisions[key] && remote.revisions[key] !== loadedRevisions[key],
    );
    if (conflictingKeys.length) {
      await handleSaveConflict(conflictingKeys);
      return false;
    }

    // ค่าที่กำลังจะบันทึก (state อาจเปลี่ยนต่อระหว่างรอเซิร์ฟเวอร์ ถ้าผู้ใช้บันทึกรายการถัดไป)
    const savedSnapshot = state;
    const plans = savedCollections.map((collection) => planCollectionWrites(collection, savedSnapshot[collection]));
    const writes = plans.flatMap((plan) => plan.writes);
    if (targets.includes(META_KEY)) {
      const metaData = { importFiles: savedSnapshot.importFiles, settings: savedSnapshot.settings };
      writes.push({ ref: META_DOCUMENT, data: metaData, size: JSON.stringify(metaData).length });
    }
    // ตอนนี้รู้จำนวนคำขอจริงแล้ว: batch = 1 คำขอ
    expectMoreRequests(1);
    const newRevisions = Object.fromEntries(targets.map((key) => [key, createRevision()]));
    try {
      await commitWrites(writes, { ref: REVISIONS_DOCUMENT, data: newRevisions });
    } catch (error) {
      plans.forEach((plan) => plan.onFailure());
      throw error;
    }
    plans.forEach((plan) => plan.onSuccess());
    Object.assign(loadedRevisions, newRevisions);
    rememberConfirmed(targets, savedSnapshot);
    // แจ้งหน้าอื่นที่เปิดอยู่ (แท็บ/หน้าต่างอื่น) ให้ใช้ข้อมูลใหม่ทันที เช่น เพิ่มลูกค้าแล้วตัวเลือกในสมุดรายวันอัปเดตเลย
    broadcastSavedData(targets, savedSnapshot, newRevisions);
    // เขียนแคชในเครื่องเบื้องหลัง ไม่ต้องรอ (ข้อมูลบนเซิร์ฟเวอร์บันทึกเสร็จแล้ว)
    targets.forEach((key) => (key === META_KEY ? cacheMeta() : cacheCollection(key)));

    finishProgress();
    showCompanyName();
    setSyncStatus("บันทึกแล้ว");
    return true;
  } catch (error) {
    console.error(error);
    finishProgress();
    setSyncStatus(`บันทึกไม่สำเร็จ: ${error.message || error}`, true);
    notifyError(isPermissionError(error) ? "ไม่มีสิทธิ์บันทึกข้อมูล" : `บันทึกข้อมูลไม่สำเร็จ: ${error.message || error}`);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* ซิงก์ระหว่างแท็บ/หน้าต่างในเครื่องเดียวกัน                                */
/* ------------------------------------------------------------------ */

/** ช่องสื่อสารระหว่างหน้าของแอปที่เปิดอยู่พร้อมกัน (ไม่มีในเบราว์เซอร์เก่า → ข้าม) */
const syncChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("accounting-data-sync") : null;

/**
 * ส่งข้อมูลที่เพิ่งบันทึกสำเร็จไปให้หน้าอื่น
 * @param {string[]} targets คีย์ที่บันทึก (รวม "meta")
 * @param {AppState} snapshot ค่าที่บันทึก
 * @param {Record<string, string>} revisions รหัสรุ่นใหม่
 */
function broadcastSavedData(targets, snapshot, revisions) {
  if (!syncChannel) return;
  const collections = {};
  targets.forEach((key) => {
    if (key === META_KEY) return;
    const known = serverChunks[key];
    collections[key] = {
      items: snapshot[key],
      chunks: chunkCounts[key] || 0,
      chunkLengths: known ? known.chunks.map((chunk) => chunk.length) : null,
    };
  });
  const meta = targets.includes(META_KEY) ? { settings: snapshot.settings, importFiles: snapshot.importFiles } : null;
  try {
    syncChannel.postMessage({ collections, meta, revisions });
  } catch (error) {
    console.warn("แจ้งหน้าอื่นไม่สำเร็จ", error);
  }
}

/** รับข้อมูลที่หน้าอื่นเพิ่งบันทึก → ใส่ลง state แล้วให้หน้าวาดใหม่ (เฉพาะชุดที่หน้านี้โหลดไว้) */
syncChannel?.addEventListener("message", ({ data }) => {
  if (!data || !isSynced) return;
  // หน้านี้กำลังบันทึกอยู่ → ไม่ทับ (ถ้าชนกัน ระบบตรวจรหัสรุ่นและโหลดข้อมูลล่าสุดให้เอง)
  if (hasPendingSave()) return;
  const keys = Object.keys(data.collections || {}).filter((key) => loadedCollections.has(key));
  if (data.meta) keys.push(META_KEY);
  if (!keys.length) return;

  const nextData = { ...state };
  keys.forEach((key) => {
    if (key === META_KEY) {
      nextData.settings = data.meta.settings;
      nextData.importFiles = data.meta.importFiles;
    } else {
      const entry = data.collections[key];
      nextData[key] = entry.items;
      chunkCounts[key] = entry.chunks;
      rememberServerChunksFromCache(key, entry);
    }
    if (data.revisions && data.revisions[key]) loadedRevisions[key] = data.revisions[key];
  });
  state = normalizeState(nextData);
  rememberConfirmed(keys);
  window.dispatchEvent(new CustomEvent(DATA_REFRESH_EVENT, { detail: { keys } }));
});

/** การบันทึกที่กำลังส่งไปเซิร์ฟเวอร์ */
let activeSave = null;
/** การบันทึกที่รอคิว (รวมทุกคำขอที่เข้ามาระหว่างรอเป็นครั้งเดียว) */
let queuedSave = null;

function startSave(keys) {
  const run = performSave(keys).finally(() => {
    if (activeSave === run) activeSave = null;
  });
  activeSave = run;
  return run;
}

/**
 * บันทึกชุดข้อมูลที่แก้ไขลง Firestore
 * - ทำทีละครั้งตามลำดับ: ถ้ากดบันทึกระหว่างที่ครั้งก่อนยังไม่เสร็จ จะรวมเป็นการบันทึกครั้งถัดไปครั้งเดียว
 *   (ใช้ state ล่าสุด จึงไม่มีการเขียนทับกันเอง)
 * - ถ้าครั้งก่อนล้มเหลวแต่มีครั้งถัดไปในคิว ครั้งถัดไปจะส่งข้อมูลทั้งหมดอีกรอบ (ลองใหม่ให้อัตโนมัติ)
 * - ปฏิเสธการบันทึก ถ้าเครื่องอื่นแก้ชุดข้อมูลเดียวกันหลังจากที่เราโหลดมา (กันการเขียนทับ)
 * @param {string[]} [keys] ชุดข้อมูลที่ต้องการบันทึก เช่น ["entries"], ["settings"]
 *                         ไม่ระบุ = บันทึกทั้งหมด (ใช้ตอนนำเข้า/กู้คืน)
 * @returns {Promise<boolean>} true เมื่อบันทึกสำเร็จ
 */
export function saveData(keys) {
  if (!activeSave) {
    const run = startSave(keys);
    // ล้มเหลว แต่ระหว่างนั้นมีการบันทึกเข้าคิว (ซึ่งรวมข้อมูลนี้อยู่แล้ว) → ใช้ผลของครั้งถัดไป
    return run.then((isSaved) => (isSaved || !queuedSave ? isSaved : queuedSave.promise));
  }
  if (!queuedSave) {
    const queued = { keys: new Set(), isFull: false };
    queued.promise = activeSave.catch(() => false).then(() => {
      queuedSave = null;
      return startSave(queued.isFull ? undefined : [...queued.keys]);
    });
    queuedSave = queued;
  }
  if (keys && keys.length) keys.forEach((key) => queuedSave.keys.add(key));
  else queuedSave.isFull = true;
  return queuedSave.promise;
}

/** กำลังบันทึกอยู่หรือมีคิวรอ (ใช้เตือนก่อนปิดหน้า) */
export function hasPendingSave() {
  return Boolean(activeSave || queuedSave);
}

// ปิด/เปลี่ยนหน้าระหว่างที่ยังส่งข้อมูลไม่เสร็จ → ให้เบราว์เซอร์ถามยืนยันก่อน
window.addEventListener("beforeunload", (event) => {
  if (!hasPendingSave()) return;
  event.preventDefault();
  event.returnValue = "";
});

/**
 * แก้ไข state แล้วบันทึกทันที ถ้าบันทึกไม่สำเร็จจะคืนค่า state เดิมให้อัตโนมัติ
 * ใช้แทนรูปแบบ "สำรอง state → replaceState → saveData → คืนค่าเมื่อผิดพลาด" ที่ต้องเขียนซ้ำทุกหน้า
 *
 * @param {Partial<AppState>} changes ฟิลด์ที่เปลี่ยน เช่น { entries: newEntries }
 * @param {string[]} [keysToSave] ชุดข้อมูลที่ต้องบันทึก (ค่าเริ่มต้น = คีย์ทั้งหมดใน changes)
 * @returns {Promise<boolean>} true เมื่อบันทึกสำเร็จ
 *
 * @example
 * const saved = await commitChanges({ accounts: [...state.accounts, newAccount] });
 * if (saved) notifySuccess("เพิ่มบัญชีเรียบร้อย");
 */
export function commitChanges(changes, keysToSave = Object.keys(changes)) {
  // เก็บเฉพาะ "ค่าเดิมของคีย์ที่เปลี่ยน" ไว้คืนค่า (ไม่ต้องคัดลอกทั้ง state ซึ่งช้ามากเมื่อข้อมูลเยอะ)
  // ปลอดภัยเพราะทุกหน้าสร้างอาร์เรย์ใหม่เสมอ ไม่แก้อาร์เรย์เดิมโดยตรง
  const previousValues = Object.fromEntries(Object.keys(changes).map((key) => [key, state[key]]));
  // state เปลี่ยน "ทันที" ก่อนเริ่มบันทึก → หน้าเว็บวาดผลลัพธ์ได้เลยโดยไม่ต้องรอเซิร์ฟเวอร์ (optimistic update)
  replaceState({ ...state, ...changes });
  return saveData(keysToSave).then((isSaved) => {
    if (!isSaved) {
      // คืนเป็นค่าที่ตรงกับเซิร์ฟเวอร์ล่าสุด (ถ้ามี) — ถูกต้องแม้มีหลายการบันทึกซ้อนกัน
      const rollback = Object.fromEntries(Object.keys(previousValues).map((key) => [
        key, key in confirmedValues ? confirmedValues[key] : previousValues[key],
      ]));
      replaceState({ ...state, ...rollback });
    }
    return isSaved;
  });
}

/**
 * มีเครื่องอื่นแก้ข้อมูลชุดเดียวกัน: แจ้งผู้ใช้ แล้วโหลดข้อมูลล่าสุดจากเซิร์ฟเวอร์
 * @param {string[]} conflictingKeys
 */
async function handleSaveConflict(conflictingKeys) {
  finishProgress();
  setSyncStatus("มีข้อมูลใหม่จากเครื่องอื่น");
  notifyError("ข้อมูลถูกแก้ไขจากเครื่องอื่น ระบบกำลังโหลดข้อมูลล่าสุด กรุณาทำรายการอีกครั้ง");
  const collections = conflictingKeys.filter((key) => key !== META_KEY);
  const cacheEntries = await readCacheEntries([...collections, META_KEY]);
  // ทำเครื่องหมายว่าแคชเก่า เพื่อบังคับให้ดาวน์โหลดใหม่
  conflictingKeys.forEach((key) => {
    if (cacheEntries[key]) cacheEntries[key].revision = "stale";
  });
  // หน่วงไว้ให้หน้าเว็บคืนค่า state เดิมของมันก่อน แล้วค่อยใส่ข้อมูลจากเซิร์ฟเวอร์ทับ
  window.setTimeout(() => {
    pendingSync = syncWithServer(collections, cacheEntries, true);
  }, 0);
}

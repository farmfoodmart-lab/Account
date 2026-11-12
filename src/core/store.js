import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { toast, toastError } from "./ui.js";
import { cacheClear, cacheGetMany, cacheSet } from "./cache.js";
import { toIsoDate } from "./reports.js";

const firebaseConfig = {
  apiKey: "AIzaSyAGZ92GWjcTGUt4m8RxX978iqVgrYbaafs",
  authDomain: "accountai-3e294.firebaseapp.com",
  projectId: "accountai-3e294",
  storageBucket: "accountai-3e294.firebasestorage.app",
  messagingSenderId: "170552461513",
  appId: "1:170552461513:web:a36a202aaae7694f836518",
  measurementId: "G-R2K48SX86X",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const DOC_MAIN = doc(db, "accounting", "main");
const DATA_KEYS = [
  "accounts",
  "entries",
  "customers",
  "receivables",
  "payables",
  "autoDesc",
  "customerNames",
  "customerCosts",
  "incomingDocs",
];
const DATA_REFS = Object.fromEntries(
  DATA_KEYS.map((key) => [key, doc(db, "accounting", key)]),
);
const META_REF = doc(db, "accounting", "meta");
/** Revision stamp per stored document; lets a page skip re-downloading unchanged data. */
const REVS_REF = doc(db, "accounting", "revs");
const CHUNK_SIZE = 700000;
export const AMOUNT_EPSILON = 0.005;

export const TYPES = {
  asset: "สินทรัพย์",
  liability: "หนี้สิน",
  equity: "ทุน",
  revenue: "รายได้",
  expense: "ค่าใช้จ่าย",
};

export const normalDebit = (type) => type === "asset" || type === "expense";

export const defaultState = () => ({
  accounts: [],
  entries: [],
  customers: [],
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
    lockDate: "",
    vatRate: 7,
    accountMap: {},
  },
});

export let state = defaultState();
let ready = false;
let chunkCounts = Object.fromEntries(DATA_KEYS.map((key) => [key, 0]));
let revs = {};
let syncPromise = null;

export function setStatus(text, isError = false) {
  const element = document.getElementById("status");
  if (!element) return;
  element.textContent = text;
  element.title = text;
  element.classList.toggle("error", Boolean(isError));
  element.dataset.state = isError ? "error" : /กำลัง/.test(text) ? "busy" : "ok";
}

const asArray = (value) => (Array.isArray(value) ? value : []);

export function normalizeState(data) {
  const defaults = defaultState().settings;
  const settings = Object.assign({}, defaults, data.settings || {});
  settings.accountMap = Object.assign({}, settings.accountMap || {});
  return {
    accounts: asArray(data.accounts),
    entries: asArray(data.entries).map((entry) => ({
      ...entry,
      lines: asArray(entry.lines),
    })),
    customers: asArray(data.customers),
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

export function replaceState(data) {
  state = normalizeState(data);
}

/* ---------- authentication ---------- */

const USER_MARK = "accounting_user";
const LOGIN_URL = new URL("../pages/login/login.html", import.meta.url).href;
const isLoginPage = () => /\/pages\/login\//.test(location.pathname);

function readMarker() {
  try {
    return localStorage.getItem(USER_MARK) || "";
  } catch {
    return "";
  }
}

function writeMarker(value) {
  try {
    if (value) localStorage.setItem(USER_MARK, value);
    else localStorage.removeItem(USER_MARK);
  } catch {
    /* storage blocked */
  }
}

/** Resolves with the signed-in user (or null) once Firebase Auth has initialised. */
export const authReady = new Promise((resolve) => {
  const stop = onAuthStateChanged(auth, (user) => {
    stop();
    resolve(user);
  });
});

let redirecting = false;
async function goLogin() {
  if (redirecting || isLoginPage()) return;
  redirecting = true;
  writeMarker("");
  await cacheClear();
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`${LOGIN_URL}?next=${next}`);
}

function renderUser(user) {
  const element = document.getElementById("user-email");
  if (element) element.textContent = user ? user.email || "ผู้ใช้" : "";
}

onAuthStateChanged(auth, (user) => {
  renderUser(user);
  if (!user) goLogin();
});

async function rememberUser(user) {
  if (readMarker() !== user.uid) await cacheClear();
  writeMarker(user.uid);
}

export async function signIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  await rememberUser(credential.user);
  return credential.user;
}

export async function register(email, password) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await rememberUser(credential.user);
  return credential.user;
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function logout() {
  writeMarker("");
  await cacheClear();
  await signOut(auth);
  location.replace(LOGIN_URL);
}

window.AppAuth = { logout };

/* ---------- storage: chunked Firestore documents ---------- */

function splitIntoChunks(records) {
  const chunks = [];
  let currentChunk = [];
  let currentChunkSize = 2;
  for (const record of records) {
    const serializedRecord = JSON.stringify(record);
    const additionalSize = serializedRecord.length + (currentChunk.length ? 1 : 0);
    if (currentChunk.length && currentChunkSize + additionalSize > CHUNK_SIZE) {
      chunks.push(currentChunk);
      currentChunk = [record];
      currentChunkSize = 2 + serializedRecord.length;
    } else {
      currentChunk.push(record);
      currentChunkSize += additionalSize;
    }
  }
  chunks.push(currentChunk);
  return chunks.length ? chunks : [[]];
}

async function loadArray(collectionName) {
  const collectionSnapshot = await getDoc(DATA_REFS[collectionName]);
  if (!collectionSnapshot.exists()) return { items: [], chunks: 0, existed: false };
  const collectionData = collectionSnapshot.data() || {};
  if (Array.isArray(collectionData.items)) {
    return { items: collectionData.items, chunks: 0, existed: true };
  }

  const chunkCount = Number(collectionData.chunks) || 0;
  if (chunkCount > 0) {
    const chunkSnapshots = await Promise.all(
      Array.from({ length: chunkCount }, (_, chunkIndex) =>
        getDoc(doc(db, "accounting", `${collectionName}_${chunkIndex}`)),
      ),
    );
    const records = [];
    chunkSnapshots.forEach((chunkSnapshot) => {
      if (!chunkSnapshot.exists()) return;
      const chunkData = chunkSnapshot.data() || {};
      if (Array.isArray(chunkData.items)) records.push(...chunkData.items);
    });
    return { items: records, chunks: chunkCount, existed: true };
  }
  return { items: [], chunks: 0, existed: true };
}

async function saveArray(collectionName, records) {
  const chunks = splitIntoChunks(records);
  const previousChunkCount = chunkCounts[collectionName] || 0;
  const operations = [];

  if (chunks.length <= 1) {
    operations.push(setDoc(DATA_REFS[collectionName], { items: chunks[0] || [] }));
    for (let chunkIndex = 0; chunkIndex < previousChunkCount; chunkIndex += 1) {
      operations.push(deleteDoc(doc(db, "accounting", `${collectionName}_${chunkIndex}`)));
    }
  } else {
    operations.push(setDoc(DATA_REFS[collectionName], { chunks: chunks.length }));
    chunks.forEach((chunkRecords, chunkIndex) => {
      operations.push(setDoc(doc(db, "accounting", `${collectionName}_${chunkIndex}`), { items: chunkRecords }));
    });
    for (let chunkIndex = chunks.length; chunkIndex < previousChunkCount; chunkIndex += 1) {
      operations.push(deleteDoc(doc(db, "accounting", `${collectionName}_${chunkIndex}`)));
    }
  }

  await Promise.all(operations);
  chunkCounts[collectionName] = chunks.length <= 1 ? 0 : chunks.length;
}

const newRev = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function cacheCollection(key) {
  return cacheSet(key, { items: state[key], chunks: chunkCounts[key] || 0, rev: revs[key] || "" });
}

function cacheMeta() {
  return cacheSet("meta", { settings: state.settings, importFiles: state.importFiles, rev: revs.meta || "" });
}

function applyBrand() {
  const brandCompany = document.getElementById("brand-company");
  if (brandCompany && state.settings.company) brandCompany.textContent = state.settings.company;
}

function isPermissionError(error) {
  return error && (error.code === "permission-denied" || /permission/i.test(error.message || ""));
}

/**
 * Bring the requested collections up to date with Firestore. Collections whose
 * cached revision matches the server are not downloaded again.
 * @param {string[]} keys
 * @param {Record<string, any>} cached  cache records already applied to state
 * @param {boolean} background  state was already rendered from cache
 */
async function sync(keys, cached, background) {
  try {
    const user = await authReady;
    if (!user) {
      goLogin();
      return false;
    }
    const revSnapshot = await getDoc(REVS_REF);
    const remoteRevs = revSnapshot.exists() ? revSnapshot.data() || {} : {};
    const stale = (key) => !cached[key] || !remoteRevs[key] || remoteRevs[key] !== cached[key].rev;
    const fetchKeys = keys.filter(stale);
    const fetchMeta = stale("meta");

    const [results, metaSnapshot] = await Promise.all([
      Promise.all(fetchKeys.map((key) => loadArray(key))),
      fetchMeta ? getDoc(META_REF) : Promise.resolve(null),
    ]);

    // Legacy single-document layout: migrate once to the split/chunked layout.
    const nothingSplit = !revSnapshot.exists() && !results.some((result) => result.existed) && !(metaSnapshot && metaSnapshot.exists());
    if (nothingSplit && !background) {
      const mainSnapshot = await getDoc(DOC_MAIN);
      if (mainSnapshot.exists()) {
        state = normalizeState(mainSnapshot.data() || {});
        try {
          await Promise.all([
            ...DATA_KEYS.map((key) => saveArray(key, state[key])),
            setDoc(META_REF, { importFiles: state.importFiles, settings: state.settings }),
          ]);
          toast("ย้ายข้อมูลไปยังโครงสร้างใหม่เรียบร้อย", "info");
        } catch (migrationError) {
          console.warn("migration to split/chunked docs failed", migrationError);
        }
      }
    }

    const changed = [];
    const data = { ...state };
    fetchKeys.forEach((key, index) => {
      data[key] = results[index].items;
      chunkCounts[key] = results[index].chunks;
      changed.push(key);
    });
    // Collections whose cached copy is still current come from the cache.
    let fromCache = false;
    keys.forEach((key) => {
      if (fetchKeys.includes(key) || !cached[key]) return;
      chunkCounts[key] = cached[key].chunks || 0;
      if (!background) {
        data[key] = cached[key].items;
        fromCache = true;
      }
    });
    if (fetchMeta && metaSnapshot) {
      const meta = metaSnapshot.exists() ? metaSnapshot.data() || {} : {};
      if (Object.prototype.hasOwnProperty.call(meta, "importFiles")) data.importFiles = meta.importFiles;
      if (Object.prototype.hasOwnProperty.call(meta, "settings")) data.settings = meta.settings;
      changed.push("meta");
    } else if (!background && cached.meta) {
      data.importFiles = cached.meta.importFiles;
      data.settings = cached.meta.settings;
      fromCache = true;
    }
    if (changed.length || fromCache) state = normalizeState(data);

    // Make sure every store has a revision so later visits can skip downloads.
    const missingRevs = {};
    [...keys, "meta"].forEach((key) => {
      if (!remoteRevs[key]) missingRevs[key] = newRev();
    });
    if (Object.keys(missingRevs).length) {
      try {
        await setDoc(REVS_REF, missingRevs, { merge: true });
        Object.assign(remoteRevs, missingRevs);
      } catch (error) {
        console.warn("cannot stamp revisions", error);
      }
    }
    keys.forEach((key) => { revs[key] = remoteRevs[key] || ""; });
    revs.meta = remoteRevs.meta || "";

    await Promise.all([...keys.map(cacheCollection), cacheMeta()]);
    ready = true;
    applyBrand();
    setStatus("ซิงก์ข้อมูลแล้ว");

    const realChanges = background ? changed.filter((key) => cached[key]) : [];
    if (realChanges.length) {
      window.dispatchEvent(new CustomEvent("app-data-refresh", { detail: { keys: realChanges } }));
      toast("อัปเดตข้อมูลล่าสุดจากเซิร์ฟเวอร์แล้ว");
    }
    return true;
  } catch (error) {
    console.error(error);
    if (isPermissionError(error)) {
      setStatus("ไม่มีสิทธิ์เข้าถึงข้อมูล", true);
      toastError("บัญชีผู้ใช้นี้ไม่มีสิทธิ์เข้าถึงข้อมูล");
      return false;
    }
    setStatus(background ? "ออฟไลน์ · แสดงข้อมูลที่บันทึกไว้ในเครื่อง" : `เชื่อมต่อ Firebase ไม่สำเร็จ: ${error.message || error}`, true);
    if (!background) toastError("เชื่อมต่อ Firebase ไม่สำเร็จ");
    return background;
  }
}

/**
 * Load collections for the current page. When a local copy exists the page
 * renders from it immediately and Firestore is checked in the background;
 * pages subscribe with onDataRefresh() to re-render if newer data arrives.
 */
export async function load(collectionNames = DATA_KEYS) {
  const keys = [...new Set(collectionNames)];
  const unknown = keys.filter((key) => !DATA_KEYS.includes(key));
  if (unknown.length) throw new Error(`ไม่รู้จักชุดข้อมูล: ${unknown.join(", ")}`);

  if (!readMarker()) {
    const user = await authReady;
    if (!user) {
      goLogin();
      return false;
    }
    await rememberUser(user);
  }

  const cached = await cacheGetMany([...keys, "meta"]);
  const complete = cached.meta && keys.every((key) => cached[key]);
  if (complete) {
    const data = { ...state, settings: cached.meta.settings, importFiles: cached.meta.importFiles };
    keys.forEach((key) => {
      data[key] = cached[key].items;
      chunkCounts[key] = cached[key].chunks || 0;
      revs[key] = cached[key].rev;
    });
    revs.meta = cached.meta.rev;
    state = normalizeState(data);
    applyBrand();
    setStatus("กำลังซิงก์ข้อมูล...");
    syncPromise = sync(keys, cached, true);
    return true;
  }

  setStatus("กำลังโหลดข้อมูลจาก Firebase...");
  syncPromise = sync(keys, cached, false);
  return syncPromise;
}

/** Re-render hook for when background sync delivers newer data. */
export function onDataRefresh(callback) {
  window.addEventListener("app-data-refresh", (event) => callback(event.detail.keys));
}

const KEY_TO_STORE = {
  accounts: "accounts",
  entries: "entries",
  customers: "customers",
  receivables: "receivables",
  payables: "payables",
  autoDesc: "autoDesc",
  customerNames: "customerNames",
  customerCosts: "customerCosts",
  incomingDocs: "incomingDocs",
  importFiles: "meta",
  settings: "meta",
};

export async function save(dataKeys) {
  if (syncPromise) await syncPromise;
  if (!ready) {
    toastError("ยังเชื่อมต่อข้อมูลไม่สำเร็จ บันทึกไม่ได้");
    return false;
  }
  const targets = [...new Set(
    (dataKeys && dataKeys.length ? dataKeys : [...DATA_KEYS, "meta"]).map((dataKey) => KEY_TO_STORE[dataKey] || dataKey),
  )];
  try {
    setStatus("กำลังบันทึก...");
    // Refuse to overwrite data another device changed after we loaded it.
    const revSnapshot = await getDoc(REVS_REF);
    const remoteRevs = revSnapshot.exists() ? revSnapshot.data() || {} : {};
    const conflicts = targets.filter((target) => remoteRevs[target] && revs[target] && remoteRevs[target] !== revs[target]);
    if (conflicts.length) {
      setStatus("มีข้อมูลใหม่จากเครื่องอื่น");
      toastError("ข้อมูลถูกแก้ไขจากเครื่องอื่น ระบบกำลังโหลดข้อมูลล่าสุด กรุณาทำรายการอีกครั้ง");
      const conflictKeys = conflicts.filter((target) => target !== "meta");
      const cachedNow = await cacheGetMany([...conflictKeys, "meta"]);
      conflicts.forEach((target) => { if (cachedNow[target]) cachedNow[target].rev = "stale"; });
      // Run after the caller restores its previous state, then apply server data.
      window.setTimeout(() => { syncPromise = sync(conflictKeys, cachedNow, true); }, 0);
      return false;
    }

    const operations = [];
    targets.forEach((target) => {
      if (DATA_KEYS.includes(target)) operations.push(saveArray(target, state[target]));
    });
    if (targets.includes("meta")) {
      operations.push(setDoc(META_REF, { importFiles: state.importFiles, settings: state.settings }));
    }
    await Promise.all(operations);

    const stamped = Object.fromEntries(targets.map((target) => [target, newRev()]));
    await setDoc(REVS_REF, stamped, { merge: true });
    Object.assign(revs, stamped);
    await Promise.all(targets.map((target) => (target === "meta" ? cacheMeta() : cacheCollection(target))));
    applyBrand();
    setStatus("บันทึกแล้ว");
    return true;
  } catch (error) {
    console.error(error);
    setStatus(`บันทึกไม่สำเร็จ: ${error.message || error}`, true);
    toastError(isPermissionError(error) ? "ไม่มีสิทธิ์บันทึกข้อมูล" : `บันทึกข้อมูลไม่สำเร็จ: ${error.message || error}`);
    return false;
  }
}

/* ---------- period lock ---------- */

/** Entries dated on or before settings.lockDate belong to a closed period. */
export function isLocked(date) {
  const lock = state.settings.lockDate;
  const iso = toIsoDate(date);
  return Boolean(lock && iso && iso <= lock);
}

export function lockMessage() {
  return `งวดบัญชีถึงวันที่ ${fmtDateDMY(state.settings.lockDate)} ถูกปิดแล้ว แก้ไขหรือเพิ่มรายการในช่วงนี้ไม่ได้ (ปลดล็อกได้ที่หน้าการตั้งค่า)`;
}

/* ---------- default accounts used for automatic postings ---------- */

export const ACCOUNT_ROLES = {
  cash: { label: "เงินสด / เงินฝาก (รับ-จ่ายเงิน)", type: "asset", codes: ["1101", "1102"], names: ["เงินสด", "เงินฝาก"] },
  receivable: { label: "ลูกหนี้การค้า", type: "asset", codes: ["1103"], names: ["ลูกหนี้"] },
  payable: { label: "เจ้าหนี้การค้า", type: "liability", codes: ["2101"], names: ["เจ้าหนี้"] },
  revenue: { label: "รายได้ (ค่าเริ่มต้นเมื่อตั้งลูกหนี้)", type: "revenue", codes: ["4101"], names: ["รายได้"] },
  expense: { label: "ค่าใช้จ่าย/ซื้อ (ค่าเริ่มต้นเมื่อตั้งเจ้าหนี้)", type: "expense", codes: ["5101", "5206"], names: ["ต้นทุน", "ค่าใช้จ่าย"] },
  vatOutput: { label: "ภาษีขาย", type: "liability", codes: ["2103"], names: ["ภาษีขาย"] },
  vatInput: { label: "ภาษีซื้อ", type: "asset", codes: ["1107"], names: ["ภาษีซื้อ"] },
  retained: { label: "กำไรสะสม (ใช้ตอนปิดบัญชี)", type: "equity", codes: ["3201"], names: ["กำไรสะสม"] },
};

/** Account configured for a posting role, falling back to the standard chart codes/names. */
export function roleAccount(role) {
  const config = ACCOUNT_ROLES[role];
  const mapped = state.settings.accountMap && state.settings.accountMap[role];
  if (mapped) {
    const account = state.accounts.find((item) => item.id === mapped);
    if (account) return account;
  }
  if (!config) return null;
  for (const code of config.codes) {
    const account = state.accounts.find((item) => String(item.code) === code && item.type === config.type);
    if (account) return account;
  }
  for (const name of config.names) {
    const account = state.accounts.find((item) => item.type === config.type && String(item.name || "").includes(name));
    if (account) return account;
  }
  return null;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function fmt(n) {
  return Number(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtInt(n) {
  return Number(n || 0).toLocaleString("th-TH");
}

export function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtDateDMY(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && typeof XLSX !== "undefined" && XLSX.SSF) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return [parsed.d, parsed.m, parsed.y]
        .map((part) => String(part).padStart(2, "0"))
        .join("/");
    }
  }
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[3].padStart(2, "0")}/${iso[2].padStart(2, "0")}/${iso[1]}`;
  const dmy = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) return `${dmy[1].padStart(2, "0")}/${dmy[2].padStart(2, "0")}/${dmy[3]}`;
  return text;
}

export function getAccount(id) {
  return state.accounts.find((account) => account.id === id);
}

export function getCustomer(id) {
  return state.customers.find((customer) => customer.id === id);
}

export function customerLabel(customer) {
  if (!customer) return "";
  return `${customer.code ? `${customer.code} - ` : ""}${customer.name || ""}`.trim();
}

export function accountBalance(account) {
  let debit = 0;
  let credit = 0;
  state.entries.forEach((entry) => {
    entry.lines.forEach((line) => {
      if (line.accountId !== account.id) return;
      debit += Number(line.debit) || 0;
      credit += Number(line.credit) || 0;
    });
  });
  const net = normalDebit(account.type) ? debit - credit : credit - debit;
  return { debit, credit, net };
}

export function entryTotal(entry) {
  return entry.lines.reduce((total, line) => total + (Number(line.debit) || 0), 0);
}

export function balanceColumns(account, net) {
  const debitSide = normalDebit(account.type) ? net : -net;
  return {
    debit: debitSide > AMOUNT_EPSILON ? debitSide : 0,
    credit: debitSide < -AMOUNT_EPSILON ? -debitSide : 0,
  };
}

/* ---------- accounting helpers shared by the redesigned pages ---------- */

export const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];

/** Kinds of journal entry. Adjusting entries feed the worksheet's adjustment
 *  columns; closing entries are excluded from the income statement. */
export const ENTRY_KINDS = {
  general: "ทั่วไป",
  adjusting: "ปรับปรุง",
  closing: "ปิดบัญชี",
};

export function entryKind(entry) {
  return entry && ENTRY_KINDS[entry.kind] ? entry.kind : "general";
}

export function compareAccounts(left, right) {
  const leftType = TYPE_ORDER.indexOf(left.type);
  const rightType = TYPE_ORDER.indexOf(right.type);
  const typeDiff = (leftType < 0 ? 99 : leftType) - (rightType < 0 ? 99 : rightType);
  if (typeDiff) return typeDiff;
  return String(left.code || "").localeCompare(String(right.code || ""), "th-TH", { numeric: true });
}

export function sortedAccounts() {
  return state.accounts.slice().sort(compareAccounts);
}

export function accountLabel(account) {
  if (!account) return "(บัญชีถูกลบ)";
  return `${account.code || ""} ${account.name || ""}`.trim();
}

/** <option> list grouped by account type (optgroup), for any account picker. */
export function accountOptionsHtml(selectedId = "", placeholder = "-- เลือกบัญชี --") {
  const accounts = sortedAccounts();
  const groups = TYPE_ORDER.map((type) => ({ type, items: accounts.filter((account) => account.type === type) }));
  const others = accounts.filter((account) => !TYPE_ORDER.includes(account.type));
  if (others.length) groups.push({ type: "other", items: others });
  return `<option value="">${esc(placeholder)}</option>` + groups
    .filter((group) => group.items.length)
    .map((group) => `<optgroup label="${esc(TYPES[group.type] || "อื่น ๆ")}">${group.items
      .map((account) => `<option value="${esc(account.id)}"${account.id === selectedId ? " selected" : ""}>${esc(account.code)} · ${esc(account.name)}</option>`)
      .join("")}</optgroup>`)
    .join("");
}

/** Accounting style: negatives in parentheses, zero as a dash. */
export function fmtAcc(n) {
  const value = Number(n || 0);
  if (Math.abs(value) < AMOUNT_EPSILON) return "-";
  return value < 0 ? `(${fmt(-value)})` : fmt(value);
}

/** Next journal voucher number for the month of `isoDate`: JV-YYYYMM-0001. */
export function nextDocNo(isoDate, ignoreEntryId = "") {
  return nextSeqNo(state.entries, "JV", isoDate, ignoreEntryId);
}

/**
 * Next running number PREFIX-YYYYMM-0001 for the month of `date`, unique within `records`.
 * Pass `reserved` (a Set) when numbering many new records in one go (imports).
 */
export function nextSeqNo(records, code, date, ignoreId = "", reserved = null) {
  const iso = toIsoDate(date) || new Date().toISOString().slice(0, 10);
  const prefix = `${code}-${iso.slice(0, 7).replace("-", "")}-`;
  let max = 0;
  const consider = (docNo) => {
    if (!docNo || !String(docNo).startsWith(prefix)) return;
    const seq = parseInt(String(docNo).slice(prefix.length), 10);
    if (seq > max) max = seq;
  };
  records.forEach((record) => {
    if (record.id !== ignoreId) consider(record.docNo);
  });
  if (reserved) reserved.forEach(consider);
  const docNo = `${prefix}${String(max + 1).padStart(4, "0")}`;
  if (reserved) reserved.add(docNo);
  return docNo;
}

export function typeBadge(type) {
  return `<span class="badge type-${esc(type)}">${esc(TYPES[type] || type || "อื่น ๆ")}</span>`;
}

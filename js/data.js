import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { toast, toastError } from "./ui.js";

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
const DOC_MAIN = doc(db, "accounting", "main");
const DATA_KEYS = [
  "accounts",
  "entries",
  "customers",
  "receivables",
  "autoDesc",
  "customerNames",
  "customerCosts",
  "incomingDocs",
];
const DATA_REFS = Object.fromEntries(
  DATA_KEYS.map((key) => [key, doc(db, "accounting", key)]),
);
const META_REF = doc(db, "accounting", "meta");
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
  autoDesc: [],
  customerNames: [],
  customerCosts: [],
  incomingDocs: [],
  importFiles: [],
  settings: {
    company: "",
    periodStart: "",
    periodEnd: "",
    currency: "THB",
    note: "",
  },
});

export let state = defaultState();
let ready = false;
let chunkCounts = Object.fromEntries(DATA_KEYS.map((key) => [key, 0]));

export function setStatus(text, isError = false) {
  const element = document.getElementById("status");
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("error", Boolean(isError));
}

const asArray = (value) => (Array.isArray(value) ? value : []);

export function normalizeState(data) {
  return {
    accounts: asArray(data.accounts),
    entries: asArray(data.entries).map((entry) => ({
      ...entry,
      lines: asArray(entry.lines),
    })),
    customers: asArray(data.customers),
    receivables: asArray(data.receivables),
    autoDesc: asArray(data.autoDesc),
    customerNames: asArray(data.customerNames),
    customerCosts: asArray(data.customerCosts),
    incomingDocs: asArray(data.incomingDocs),
    importFiles: asArray(data.importFiles),
    settings: Object.assign(defaultState().settings, data.settings || {}),
  };
}

export function replaceState(data) {
  state = normalizeState(data);
}

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

export async function load(collectionNames = DATA_KEYS) {
  try {
    setStatus("กำลังโหลดข้อมูลจาก Firebase...");
    const requestedCollections = [...new Set(collectionNames)];
    const unknownCollections = requestedCollections.filter(
      (collectionName) => !DATA_KEYS.includes(collectionName),
    );
    if (unknownCollections.length) {
      throw new Error(`ไม่รู้จักชุดข้อมูล: ${unknownCollections.join(", ")}`);
    }

    const collectionResults = await Promise.all([
      ...requestedCollections.map((collectionName) => loadArray(collectionName)),
      getDoc(META_REF),
      getDoc(DOC_MAIN),
    ]);

    const metaSnapshot = collectionResults[requestedCollections.length];
    const mainSnapshot = collectionResults[requestedCollections.length + 1];
    const hasSplit =
      collectionResults.slice(0, requestedCollections.length).some((result) => result.existed) ||
      metaSnapshot.exists();

    if (hasSplit) {
      const meta = metaSnapshot.exists() ? metaSnapshot.data() || {} : {};
      const data = { ...state };
      requestedCollections.forEach((collectionName, resultIndex) => {
        data[collectionName] = collectionResults[resultIndex].items;
        chunkCounts[collectionName] = collectionResults[resultIndex].chunks;
      });
      if (Object.prototype.hasOwnProperty.call(meta, "importFiles")) {
        data.importFiles = meta.importFiles;
      }
      if (Object.prototype.hasOwnProperty.call(meta, "settings")) {
        data.settings = meta.settings;
      }
      state = normalizeState(data);
    } else if (mainSnapshot.exists()) {
      state = normalizeState(mainSnapshot.data() || {});
      try {
        await Promise.all([
          ...DATA_KEYS.map((key) => saveArray(key, state[key])),
          setDoc(META_REF, {
            importFiles: state.importFiles,
            settings: state.settings,
          }),
        ]);
        toast("ย้ายข้อมูลไปยังโครงสร้างใหม่เรียบร้อย", "info");
      } catch (migrationError) {
        console.warn("migration to split/chunked docs failed", migrationError);
      }
    } else {
      state = defaultState();
      chunkCounts = Object.fromEntries(DATA_KEYS.map((key) => [key, 0]));
    }

    ready = true;
    setStatus("เชื่อมต่อ Firebase แล้ว");
    return true;
  } catch (error) {
    console.error(error);
    setStatus(`เชื่อมต่อ Firebase ไม่สำเร็จ: ${error.message || error}`, true);
    toastError("เชื่อมต่อ Firebase ไม่สำเร็จ");
    return false;
  }
}

const KEY_TO_STORE = {
  accounts: "accounts",
  entries: "entries",
  customers: "customers",
  receivables: "receivables",
  autoDesc: "autoDesc",
  customerNames: "customerNames",
  customerCosts: "customerCosts",
  incomingDocs: "incomingDocs",
  importFiles: "meta",
  settings: "meta",
};

export async function save(dataKeys) {
  if (!ready) {
    toastError("ยังเชื่อมต่อข้อมูลไม่สำเร็จ บันทึกไม่ได้");
    return false;
  }
  try {
    setStatus("กำลังบันทึก...");
    const storageTargets = new Set(
      (dataKeys && dataKeys.length ? dataKeys : [...DATA_KEYS, "meta"]).map(
        (dataKey) => KEY_TO_STORE[dataKey] || dataKey,
      ),
    );
    const operations = [];
    DATA_KEYS.forEach((collectionName) => {
      if (storageTargets.has(collectionName)) {
        operations.push(saveArray(collectionName, state[collectionName]));
      }
    });
    if (storageTargets.has("meta")) {
      operations.push(
        setDoc(META_REF, {
          importFiles: state.importFiles,
          settings: state.settings,
        }),
      );
    }
    await Promise.all(operations);
    setStatus("บันทึกแล้ว");
    return true;
  } catch (error) {
    console.error(error);
    setStatus(`บันทึกไม่สำเร็จ: ${error.message || error}`, true);
    toastError(`บันทึกข้อมูลไม่สำเร็จ: ${error.message || error}`);
    return false;
  }
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

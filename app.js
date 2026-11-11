import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  toast,
  toastSuccess,
  toastError,
  confirmAction,
  downloadCsvFile,
  downloadJson,
  todayIso,
  fileStamp,
} from "./js/ui.js";
import { toCsv } from "./js/csv.js";
import {
  collectTotals,
  buildTrialBalance,
  buildIncomeStatement,
  buildBalanceSheet,
  monthlySummary,
  toIsoDate,
  BALANCE_EPSILON,
} from "./js/reports.js";

const firebaseConfig = {
  apiKey: "AIzaSyAGZ92GWjcTGUt4m8RxX978iqVgrYbaafs",
  authDomain: "accountai-3e294.firebaseapp.com",
  projectId: "accountai-3e294",
  storageBucket: "accountai-3e294.firebasestorage.app",
  messagingSenderId: "170552461513",
  appId: "1:170552461513:web:a36a202aaae7694f836518",
  measurementId: "G-R2K48SX86X",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
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
  DATA_KEYS.map((k) => [k, doc(db, "accounting", k)]),
);
const META_REF = doc(db, "accounting", "meta");
const CHUNK_SIZE = 700000;
const AMOUNT_EPSILON = 0.005;

const TYPES = {
  asset: "สินทรัพย์",
  liability: "หนี้สิน",
  equity: "ทุน",
  revenue: "รายได้",
  expense: "ค่าใช้จ่าย",
};
const normalDebit = (type) => type === "asset" || type === "expense";

const defaultState = () => ({
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

let state = defaultState();
let ready = false;
let chunkCounts = Object.fromEntries(DATA_KEYS.map((k) => [k, 0]));

function setStatus(text, isError = false) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}

const arr = (value) => (Array.isArray(value) ? value : []);

function normalizeState(data) {
  return {
    accounts: arr(data.accounts),
    entries: arr(data.entries).map((entry) => ({
      ...entry,
      lines: arr(entry.lines),
    })),
    customers: arr(data.customers),
    receivables: arr(data.receivables),
    autoDesc: arr(data.autoDesc),
    customerNames: arr(data.customerNames),
    customerCosts: arr(data.customerCosts),
    incomingDocs: arr(data.incomingDocs),
    importFiles: arr(data.importFiles),
    settings: Object.assign(defaultState().settings, data.settings || {}),
  };
}

function splitBySize(items) {
  const chunks = [];
  let current = [];
  let size = 2;
  for (const item of items) {
    const text = JSON.stringify(item);
    const add = text.length + (current.length ? 1 : 0);
    if (current.length && size + add > CHUNK_SIZE) {
      chunks.push(current);
      current = [item];
      size = 2 + text.length;
    } else {
      current.push(item);
      size += add;
    }
  }
  chunks.push(current);
  return chunks.length ? chunks : [[]];
}

async function loadArray(key) {
  const snap = await getDoc(DATA_REFS[key]);
  if (!snap.exists()) return { items: [], chunks: 0, existed: false };
  const data = snap.data() || {};
  if (Array.isArray(data.items))
    return { items: data.items, chunks: 0, existed: true };

  const n = Number(data.chunks) || 0;
  if (n > 0) {
    const parts = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        getDoc(doc(db, "accounting", `${key}_${i}`)),
      ),
    );
    const items = [];
    parts.forEach((part) => {
      if (!part.exists()) return;
      const payload = part.data() || {};
      if (Array.isArray(payload.items)) items.push(...payload.items);
    });
    return { items, chunks: n, existed: true };
  }
  return { items: [], chunks: 0, existed: true };
}

async function saveArray(key, items) {
  const chunks = splitBySize(items);
  const previous = chunkCounts[key] || 0;
  const ops = [];

  if (chunks.length <= 1) {
    ops.push(setDoc(DATA_REFS[key], { items: chunks[0] || [] }));
    for (let i = 0; i < previous; i += 1) {
      ops.push(deleteDoc(doc(db, "accounting", `${key}_${i}`)));
    }
  } else {
    ops.push(setDoc(DATA_REFS[key], { chunks: chunks.length }));
    chunks.forEach((chunk, i) => {
      ops.push(setDoc(doc(db, "accounting", `${key}_${i}`), { items: chunk }));
    });
    for (let i = chunks.length; i < previous; i += 1) {
      ops.push(deleteDoc(doc(db, "accounting", `${key}_${i}`)));
    }
  }

  await Promise.all(ops);
  chunkCounts[key] = chunks.length <= 1 ? 0 : chunks.length;
}

async function load() {
  try {
    setStatus("กำลังโหลดข้อมูลจาก Firebase...");
    const results = await Promise.all([
      ...DATA_KEYS.map((key) => loadArray(key)),
      getDoc(META_REF),
      getDoc(DOC_MAIN),
    ]);

    const metaSnap = results[DATA_KEYS.length];
    const mainSnap = results[DATA_KEYS.length + 1];
    const hasSplit =
      results.slice(0, DATA_KEYS.length).some((r) => r.existed) ||
      metaSnap.exists();

    if (hasSplit) {
      const meta = metaSnap.exists() ? metaSnap.data() || {} : {};
      const data = {};
      DATA_KEYS.forEach((key, i) => {
        data[key] = results[i].items;
        chunkCounts[key] = results[i].chunks;
      });
      data.importFiles = meta.importFiles;
      data.settings = meta.settings;
      state = normalizeState(data);
    } else if (mainSnap.exists()) {
      state = normalizeState(mainSnap.data() || {});
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
      chunkCounts = Object.fromEntries(DATA_KEYS.map((k) => [k, 0]));
    }

    ready = true;
    setStatus("เชื่อมต่อ Firebase แล้ว");
  } catch (error) {
    console.error(error);
    setStatus(
      "เชื่อมต่อ Firebase ไม่สำเร็จ: " + (error.message || error),
      true,
    );
    toastError("เชื่อมต่อ Firebase ไม่สำเร็จ");
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

async function save(keys) {
  if (!ready) {
    toastError("ยังเชื่อมต่อข้อมูลไม่สำเร็จ บันทึกไม่ได้");
    return false;
  }
  try {
    setStatus("กำลังบันทึก...");
    const targets = new Set(
      (keys && keys.length ? keys : [...DATA_KEYS, "meta"]).map(
        (key) => KEY_TO_STORE[key] || key,
      ),
    );
    const ops = [];
    DATA_KEYS.forEach((key) => {
      if (targets.has(key)) ops.push(saveArray(key, state[key]));
    });
    if (targets.has("meta")) {
      ops.push(
        setDoc(META_REF, {
          importFiles: state.importFiles,
          settings: state.settings,
        }),
      );
    }
    await Promise.all(ops);
    setStatus("บันทึกแล้ว");
    return true;
  } catch (error) {
    console.error(error);
    setStatus("บันทึกไม่สำเร็จ: " + (error.message || error), true);
    toastError("บันทึกข้อมูลไม่สำเร็จ: " + (error.message || error));
    return false;
  }
}
/* ------------------------------------------------------------------ */
/* Small shared helpers                                               */
/* ------------------------------------------------------------------ */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmt(n) {
  return Number(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtInt(n) {
  return Number(n || 0).toLocaleString("th-TH");
}

const AMP = String.fromCharCode(38);

function esc(value) {
  return String(value == null ? "" : value)
    .split(AMP)
    .join(AMP + "amp;")
    .split("<")
    .join(AMP + "lt;")
    .split(">")
    .join(AMP + "gt;")
    .split('"')
    .join(AMP + "quot;")
    .split("'")
    .join(AMP + "#39;");
}

/** Display an ISO (or legacy DMY) date as DD/MM/YYYY. */
function fmtDateDMY(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    const parsed = XLSX.SSF ? XLSX.SSF.parse_date_code(value) : null;
    if (parsed) {
      return [parsed.d, parsed.m, parsed.y].map((part) => String(part).padStart(2, "0")).join("/");
    }
  }
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[3].padStart(2, "0")}/${iso[2].padStart(2, "0")}/${iso[1]}`;
  const dmy = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) return `${dmy[1].padStart(2, "0")}/${dmy[2].padStart(2, "0")}/${dmy[3]}`;
  return text;
}

function getAccount(id) {
  return state.accounts.find((account) => account.id === id);
}

function getCustomer(id) {
  return state.customers.find((customer) => customer.id === id);
}

function customerLabel(customer) {
  if (!customer) return "";
  return `${customer.code ? customer.code + " - " : ""}${customer.name || ""}`.trim();
}

function accountBalance(account) {
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

function entryTotal(entry) {
  return entry.lines.reduce((total, line) => total + (Number(line.debit) || 0), 0);
}

function balanceColumns(account, net) {
  const debitSide = normalDebit(account.type) ? net : -net;
  return {
    debit: debitSide > AMOUNT_EPSILON ? debitSide : 0,
    credit: debitSide < -AMOUNT_EPSILON ? -debitSide : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Tab navigation                                                     */
/* ------------------------------------------------------------------ */

const TAB_RENDERERS = {
  dashboard: () => renderDashboard(),
  accounts: () => renderAccounts(),
  journal: () => renderJournal(),
  ledger: () => renderLedgerSelect(),
  trial: () => renderTrial(),
  worksheet: () => renderWorksheet(),
  reports: () => renderReports(),
  customers: () => {
    renderCustomers();
    renderCustomerNames();
    renderImportFiles("customer_names");
  },
  "customer-costs": () => {
    renderCustomerCosts();
    renderImportFiles("customer_costs");
  },
  "incoming-docs": () => {
    renderIncomingDocs();
    renderImportFiles("incoming_docs");
  },
  receivables: () => {
    renderCustomerOptions();
    renderReceivables();
  },
  autodesc: () => renderAutoDesc(),
  import: () => renderImportFiles(),
  settings: () => renderSettings(),
};

function activateTab(tabId) {
  const button = document.querySelector(`#main-nav button[data-tab="${tabId}"]`);
  if (!button) return;

  document.querySelectorAll("#main-nav button").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((section) => section.classList.remove("active"));
  button.classList.add("active");

  const section = document.getElementById(tabId);
  if (section) section.classList.add("active");

  try {
    localStorage.setItem("active_tab", tabId);
  } catch (error) {
    console.warn("cannot persist active tab", error);
  }

  const render = TAB_RENDERERS[tabId];
  if (render) render();
}

document.querySelectorAll("#main-nav button").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

/* ------------------------------------------------------------------ */
/* Chart of accounts                                                  */
/* ------------------------------------------------------------------ */

const accForm = document.getElementById("account-form");
const accSubmit = document.getElementById("acc-submit");
const accCancel = document.getElementById("acc-cancel");
let editingAccountId = null;

function resetAccountForm() {
  editingAccountId = null;
  accForm.reset();
  accSubmit.textContent = "เพิ่มบัญชี";
  accCancel.hidden = true;
}

accCancel.addEventListener("click", () => {
  resetAccountForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

accForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = document.getElementById("acc-code").value.trim();
  const name = document.getElementById("acc-name").value.trim();
  const type = document.getElementById("acc-type").value;
  if (!code || !name || !type) return;

  if (state.accounts.some((account) => account.code === code && account.id !== editingAccountId)) {
    toastError(`รหัสบัญชี ${code} มีอยู่แล้ว`);
    return;
  }

  const isEdit = !!editingAccountId;
  const previous = JSON.stringify(state);

  if (isEdit) {
    const account = state.accounts.find((item) => item.id === editingAccountId);
    if (!account) {
      resetAccountForm();
      return;
    }
    Object.assign(account, { code, name, type });
  } else {
    state.accounts.push({ id: uid(), code, name, type });
  }
  state.accounts.sort((a, b) => a.code.localeCompare(b.code));

  if (!(await save(["accounts"]))) {
    state = JSON.parse(previous);
    return;
  }

  resetAccountForm();
  renderAccounts();
  refreshAccountSelects();
  renderJournal();
  renderTrial();
  toastSuccess(isEdit ? "แก้ไขหมวดหมู่บัญชีเรียบร้อย" : "เพิ่มหมวดหมู่บัญชีเรียบร้อย");
});

function renderAccounts() {
  const tbody = document.querySelector("#accounts-table tbody");
  if (!tbody) return;
  if (!state.accounts.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">ยังไม่มีบัญชี</td></tr>';
    return;
  }

  tbody.innerHTML = state.accounts
    .map(
      (account) => `<tr>
        <td>${esc(account.code)}</td>
        <td>${esc(account.name)}</td>
        <td>${TYPES[account.type] || esc(account.type)}</td>
        <td class="actions-cell">
          <button class="small secondary" data-edit-acc="${account.id}">แก้ไข</button>
          <button class="small danger" data-del-acc="${account.id}">ลบ</button>
        </td>
      </tr>`,
    )
    .join("");

  tbody.querySelectorAll("[data-edit-acc]").forEach((button) => {
    button.addEventListener("click", () => {
      const account = state.accounts.find((item) => item.id === button.dataset.editAcc);
      if (!account) return;
      editingAccountId = account.id;
      document.getElementById("acc-code").value = account.code;
      document.getElementById("acc-name").value = account.name;
      document.getElementById("acc-type").value = account.type;
      accSubmit.textContent = "บันทึกการแก้ไข";
      accCancel.hidden = false;
      document.getElementById("acc-code").focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  tbody.querySelectorAll("[data-del-acc]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.delAcc;
      const used = state.entries.some((entry) => entry.lines.some((line) => line.accountId === id));
      if (used) {
        toastError("บัญชีนี้ถูกใช้ในรายการแล้ว ลบไม่ได้");
        return;
      }
      if (!(await confirmAction("ยืนยันการลบหมวดหมู่บัญชีนี้?"))) return;

      const previous = JSON.stringify(state);
      state.accounts = state.accounts.filter((account) => account.id !== id);
      if (editingAccountId === id) resetAccountForm();

      if (!(await save(["accounts"]))) {
        state = JSON.parse(previous);
        renderAccounts();
        return;
      }
      renderAccounts();
      refreshAccountSelects();
      renderAutoDesc();
      toastSuccess("ลบหมวดหมู่บัญชีเรียบร้อย");
    });
  });
}

function accountOptions(selectedId) {
  return (
    '<option value="">-- เลือกบัญชี --</option>' +
    state.accounts
      .map(
        (account) =>
          `<option value="${account.id}" ${account.id === selectedId ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`,
      )
      .join("")
  );
}
/* ------------------------------------------------------------------ */
/* Journal entries                                                    */
/* ------------------------------------------------------------------ */

const linesEl = document.getElementById("je-lines");
const jeSubmit = document.getElementById("je-submit");
const jeCancel = document.getElementById("je-cancel");
const jeForm = document.getElementById("journal-form");
const jeError = document.getElementById("je-error");
let editingEntryId = null;

const journalFilter = { from: "", to: "", text: "" };

function resetJournalForm() {
  editingEntryId = null;
  document.getElementById("je-date").value = todayIso();
  document.getElementById("je-desc").value = "";
  const customerSelect = document.getElementById("je-customer");
  if (customerSelect) customerSelect.value = "";
  jeError.textContent = "";
  jeSubmit.textContent = "บันทึก";
  jeCancel.hidden = true;
  resetJournalLines();
}

function customerOptionGroups() {
  let html = "";
  (state.customers || []).forEach((customer) => {
    const label = customerLabel(customer);
    if (label) html += `<option value="id:${esc(customer.id)}">${esc(label)}</option>`;
  });
  (state.customerNames || []).forEach((row) => {
    const name = (row.name || "").trim();
    if (!name) return;
    const duplicate = (state.customers || []).some((customer) => (customer.name || "").trim() === name);
    if (duplicate) return;
    html += `<option value="name:${esc(name)}">${esc(name)}</option>`;
  });
  return html;
}

function renderJournalCustomerOptions() {
  const select = document.getElementById("je-customer");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">-- ไม่ระบุ --</option>' + customerOptionGroups();
  if (current) select.value = current;
}

function renderAutoDescCustomerOptions() {
  const select = document.getElementById("ad-customer");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">-- เลือกลูกค้า --</option>' + customerOptionGroups();
  if (current) select.value = current;
}

function addLine(data = {}) {
  const row = document.createElement("div");
  row.className = "je-line";
  row.innerHTML = `
    <select class="je-account" required>${accountOptions(data.accountId)}</select>
    <input type="number" class="je-debit" placeholder="เดบิต" min="0" step="0.01" value="${data.debit || ""}">
    <input type="number" class="je-credit" placeholder="เครดิต" min="0" step="0.01" value="${data.credit || ""}">
    <button type="button" class="small danger je-remove" title="ลบบรรทัด">&times;</button>`;

  row.querySelector(".je-remove").addEventListener("click", () => {
    if (linesEl.children.length > 2) {
      row.remove();
      updateTotals();
    } else {
      toastError("ต้องมีอย่างน้อย 2 บรรทัด");
    }
  });
  row.querySelectorAll("input").forEach((input) => input.addEventListener("input", updateTotals));
  linesEl.appendChild(row);
}

function resetJournalLines(lines) {
  linesEl.innerHTML = "";
  if (Array.isArray(lines) && lines.length) {
    lines.forEach((line) => addLine(line));
    if (lines.length < 2) addLine();
  } else {
    addLine();
    addLine();
  }
  updateTotals();
}

function updateTotals() {
  let debit = 0;
  let credit = 0;
  linesEl.querySelectorAll(".je-line").forEach((row) => {
    debit += parseFloat(row.querySelector(".je-debit").value) || 0;
    credit += parseFloat(row.querySelector(".je-credit").value) || 0;
  });

  const debitEl = document.getElementById("total-debit");
  const creditEl = document.getElementById("total-credit");
  debitEl.textContent = fmt(debit);
  creditEl.textContent = fmt(credit);

  const ok = Math.abs(debit - credit) < AMOUNT_EPSILON && debit > 0;
  debitEl.className = ok ? "balanced" : "unbalanced";
  creditEl.className = ok ? "balanced" : "unbalanced";
  return { debit, credit, ok };
}

document.getElementById("add-line").addEventListener("click", () => addLine());

function refreshAccountSelects() {
  linesEl.querySelectorAll(".je-account").forEach((select) => {
    const current = select.value;
    select.innerHTML = accountOptions(current);
  });
  renderLedgerSelect();
}

function resolveAdCustomer(rawValue) {
  const value = rawValue || "";
  if (value.startsWith("id:")) {
    const customerId = value.slice(3);
    const customer = (state.customers || []).find((item) => item.id === customerId);
    return { customerId, customerName: customer ? customerLabel(customer) : "" };
  }
  if (value.startsWith("name:")) {
    return { customerId: "", customerName: value.slice(5) };
  }
  return { customerId: "", customerName: "" };
}

function applyAutoDescForCustomer(rawValue) {
  if (!rawValue) return;
  const { customerId, customerName } = resolveAdCustomer(rawValue);
  const rule = (state.autoDesc || []).find(
    (item) =>
      (customerId && item.customerId === customerId) ||
      (customerName && item.customerName === customerName),
  );
  if (!rule) return;

  document.getElementById("je-desc").value = rule.text || "";
  const rows = linesEl.querySelectorAll(".je-line");
  if (rows[0] && rule.debitAccountId) rows[0].querySelector(".je-account").value = rule.debitAccountId;
  if (rows[1] && rule.creditAccountId) rows[1].querySelector(".je-account").value = rule.creditAccountId;
  toast("เติมข้อมูลจากคำอธิบายอัตโนมัติแล้ว");
}

jeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  jeError.textContent = "";

  const date = document.getElementById("je-date").value;
  const desc = document.getElementById("je-desc").value.trim();
  const customerValue = document.getElementById("je-customer").value;

  const { ok } = updateTotals();
  if (!ok) {
    jeError.textContent = "ยอดเดบิตและเครดิตต้องเท่ากันและมากกว่า 0";
    return;
  }

  const lines = [];
  for (const row of linesEl.querySelectorAll(".je-line")) {
    const accountId = row.querySelector(".je-account").value;
    const debit = parseFloat(row.querySelector(".je-debit").value) || 0;
    const credit = parseFloat(row.querySelector(".je-credit").value) || 0;
    if (!accountId || (debit === 0 && credit === 0)) continue;
    if (debit > 0 && credit > 0) {
      jeError.textContent = "แต่ละบรรทัดใส่ได้เฉพาะเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง";
      return;
    }
    lines.push({ accountId, debit, credit });
  }

  if (lines.length < 2) {
    jeError.textContent = "ต้องมีอย่างน้อย 2 บรรทัด";
    return;
  }

  const { customerId, customerName } = resolveAdCustomer(customerValue);
  const isEdit = !!editingEntryId;
  const previous = JSON.stringify(state);
  const payload = { date, desc, lines };
  if (customerId) payload.customerId = customerId;
  if (customerName) payload.customerName = customerName;

  if (isEdit) {
    const entry = state.entries.find((item) => item.id === editingEntryId);
    if (!entry) {
      resetJournalForm();
      return;
    }
    delete entry.customerId;
    delete entry.customerName;
    Object.assign(entry, payload);
  } else {
    state.entries.push({ id: uid(), ...payload });
  }

  state.entries.sort(
    (a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id),
  );

  if (!(await save(["entries"]))) {
    state = JSON.parse(previous);
    return;
  }

  resetJournalForm();
  renderJournal();
  renderTrial();
  renderDashboard();
  toastSuccess(isEdit ? "แก้ไขรายการบันทึกเรียบร้อย" : "บันทึกรายการเรียบร้อย");
});

jeCancel.addEventListener("click", () => {
  resetJournalForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

function entryMatchesFilter(entry) {
  if (journalFilter.from || journalFilter.to) {
    const iso = toIsoDate(entry.date);
    if (!iso) return false;
    if (journalFilter.from && iso < journalFilter.from) return false;
    if (journalFilter.to && iso > journalFilter.to) return false;
  }

  if (!journalFilter.text) return true;
  const needle = journalFilter.text.toLowerCase();
  const haystack = [
    entry.desc,
    entry.customerName,
    ...entry.lines.map((line) => {
      const account = getAccount(line.accountId);
      return account ? `${account.code} ${account.name}` : "";
    }),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function visibleEntries() {
  return state.entries.filter(entryMatchesFilter);
}

function renderJournal() {
  const list = document.getElementById("journal-list");
  const summary = document.getElementById("je-filter-summary");
  if (!list) return;

  const entries = visibleEntries();
  const totalDebit = entries.reduce((total, entry) => total + entryTotal(entry), 0);
  const filtered = journalFilter.from || journalFilter.to || journalFilter.text;

  if (summary) {
    summary.textContent = filtered
      ? `แสดง ${fmtInt(entries.length)} จาก ${fmtInt(state.entries.length)} รายการ · ยอดรวม ${fmt(totalDebit)}`
      : `ทั้งหมด ${fmtInt(entries.length)} รายการ · ยอดรวม ${fmt(totalDebit)}`;
  }

  if (!state.entries.length) {
    list.innerHTML = '<p class="empty-state">ยังไม่มีรายการบันทึก</p>';
    return;
  }
  if (!entries.length) {
    list.innerHTML = '<p class="empty-state">ไม่มีรายการที่ตรงกับตัวกรอง</p>';
    return;
  }

  list.innerHTML = entries
    .slice()
    .reverse()
    .map((entry) => {
      const dateText = fmtDateDMY(entry.date);
      const customer = entry.customerName ? ` · ${esc(entry.customerName)}` : "";
      const rows = entry.lines
        .map(
          (line, index) => {
            const account = getAccount(line.accountId);
            return `<tr>
              <td>${index === 0 ? dateText : ""}</td>
              <td>${account ? `${esc(account.code)} ${esc(account.name)}` : '<span class="unbalanced">(บัญชีถูกลบ)</span>'}</td>
              <td class="right">${line.debit ? fmt(line.debit) : ""}</td>
              <td class="right">${line.credit ? fmt(line.credit) : ""}</td>
            </tr>`;
          },
        )
        .join("");

      return `<div class="entry">
        <div class="entry-header">
          <div class="entry-title">
            <span>${dateText || "ไม่ระบุวันที่"}${customer}</span>
            <span class="entry-meta">${esc(entry.desc || "(ไม่มีคำอธิบาย)")}</span>
          </div>
          <div class="actions-cell">
            <button class="small secondary" data-edit-entry="${entry.id}">แก้ไข</button>
            <button class="small danger" data-del-entry="${entry.id}">ลบ</button>
          </div>
        </div>
        <table>
          <thead><tr><th>วันที่</th><th>บัญชี</th><th class="right">เดบิต</th><th class="right">เครดิต</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="entry-footer">
          <span class="entry-desc">${entry.lines.length} บรรทัด${entry.customerId ? " · มีข้อมูลลูกค้า" : ""}</span>
          <span class="entry-total">ยอดรวม ${fmt(entryTotal(entry))}</span>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-edit-entry]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.entries.find((item) => item.id === button.dataset.editEntry);
      if (!entry) return;
      editingEntryId = entry.id;
      document.getElementById("je-date").value = toIsoDate(entry.date) || entry.date || "";
      document.getElementById("je-desc").value = entry.desc || "";
      renderJournalCustomerOptions();
      const customerSelect = document.getElementById("je-customer");
      if (entry.customerId) customerSelect.value = `id:${entry.customerId}`;
      else if (entry.customerName) customerSelect.value = `name:${entry.customerName}`;
      else customerSelect.value = "";
      resetJournalLines(entry.lines);
      jeSubmit.textContent = "บันทึกการแก้ไข";
      jeCancel.hidden = false;
      jeForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  list.querySelectorAll("[data-del-entry]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบรายการบันทึกนี้?"))) return;
      const id = button.dataset.delEntry;
      const previous = JSON.stringify(state);
      state.entries = state.entries.filter((entry) => entry.id !== id);
      if (editingEntryId === id) resetJournalForm();

      if (!(await save(["entries"]))) {
        state = JSON.parse(previous);
        renderJournal();
        return;
      }
      renderJournal();
      renderTrial();
      renderDashboard();
      toastSuccess("ลบรายการบันทึกเรียบร้อย");
    });
  });
}

function bindJournalFilters() {
  const fromEl = document.getElementById("je-filter-from");
  const toEl = document.getElementById("je-filter-to");
  const textEl = document.getElementById("je-filter-text");
  if (!fromEl) return;

  const apply = () => {
    journalFilter.from = fromEl.value;
    journalFilter.to = toEl.value;
    journalFilter.text = textEl.value.trim();
    renderJournal();
  };

  fromEl.addEventListener("change", apply);
  toEl.addEventListener("change", apply);
  textEl.addEventListener("input", apply);

  document.getElementById("je-filter-clear").addEventListener("click", () => {
    fromEl.value = "";
    toEl.value = "";
    textEl.value = "";
    apply();
  });

  document.getElementById("je-export").addEventListener("click", () => {
    const entries = visibleEntries();
    if (!entries.length) {
      toastError("ไม่มีรายการให้ส่งออก");
      return;
    }
    const rows = [];
    entries.forEach((entry) => {
      entry.lines.forEach((line) => {
        const account = getAccount(line.accountId);
        rows.push([
          fmtDateDMY(entry.date),
          entry.desc || "",
          entry.customerName || "",
          account ? account.code : "",
          account ? account.name : "(บัญชีถูกลบ)",
          Number(line.debit) || 0,
          Number(line.credit) || 0,
        ]);
      });
    });
    downloadCsvFile(
      `journal-${fileStamp()}.csv`,
      toCsv(["วันที่", "คำอธิบาย", "ลูกค้า", "รหัสบัญชี", "ชื่อบัญชี", "เดบิต", "เครดิต"], rows),
    );
    toastSuccess(`ส่งออก ${fmtInt(entries.length)} รายการ`);
  });
}
/* ------------------------------------------------------------------ */
/* General ledger                                                     */
/* ------------------------------------------------------------------ */

function renderLedgerSelect() {
  const typeSelect = document.getElementById("ledger-type");
  const accountSelect = document.getElementById("ledger-account");
  if (!typeSelect || !accountSelect) return;

  const currentType = typeSelect.value;
  const currentAccount = accountSelect.value;
  const groups = getLedgerGroups(state.accounts);
  typeSelect.innerHTML =
    '<option value="">ทุกหมวด</option>' +
    groups
      .map((group) => `<option value="${esc(group.type)}">${esc(group.label)}</option>`)
      .join("");
  typeSelect.value = groups.some((group) => group.type === currentType) ? currentType : "";

  const availableGroups = typeSelect.value
    ? groups.filter((group) => group.type === typeSelect.value)
    : groups;
  const availableAccounts = availableGroups.flatMap((group) => group.accounts);
  accountSelect.innerHTML =
    `<option value="">${typeSelect.value ? "ทุกบัญชีในหมวดนี้" : "ทุกบัญชี"}</option>` +
    availableGroups
      .map(
        (group) => `<optgroup label="${esc(group.label)}">${group.accounts
          .map(
            (account) =>
              `<option value="${esc(account.id)}">${esc(account.code)} - ${esc(account.name)}</option>`,
          )
          .join("")}</optgroup>`,
      )
      .join("");
  accountSelect.value = availableAccounts.some((account) => account.id === currentAccount)
    ? currentAccount
    : "";
  renderLedger();
}

document.getElementById("ledger-type").addEventListener("change", renderLedgerSelect);
document.getElementById("ledger-account").addEventListener("change", renderLedger);

function getLedgerGroups(accounts) {
  const knownTypes = Object.keys(TYPES);
  const additionalTypes = [...new Set(accounts.map((account) => account.type || "other"))].filter(
    (type) => !knownTypes.includes(type),
  );
  const types = [...knownTypes, ...additionalTypes];

  return types
    .map((type) => ({
      type,
      label: TYPES[type] || (type === "other" ? "อื่น ๆ" : type),
      accounts: accounts
        .filter((account) => (account.type || "other") === type)
        .sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "th-TH", { numeric: true })),
    }))
    .filter((group) => group.accounts.length);
}

function renderLedgerAccount(account) {
  const entries = state.entries
    .filter((entry) => entry.lines.some((line) => line.accountId === account.id))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = [];

  entries.forEach((entry) => {
    entry.lines.forEach((line) => {
      if (line.accountId !== account.id) return;
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      running += normalDebit(account.type) ? debit - credit : credit - debit;
      totalDebit += debit;
      totalCredit += credit;
      rows.push(`<tr>
        <td>${esc(fmtDateDMY(entry.date))}</td>
        <td>${esc(entry.desc || "")}</td>
        <td class="right">${debit ? fmt(debit) : ""}</td>
        <td class="right">${credit ? fmt(credit) : ""}</td>
        <td class="right">${fmt(running)}</td>
      </tr>`);
    });
  });

  const details = entries.length
    ? `<div class="table-wrap ledger-table-wrap"><table>
        <thead><tr><th>วันที่</th><th>รายละเอียด</th><th class="right">เดบิต</th><th class="right">เครดิต</th><th class="right">คงเหลือ</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
        <tfoot><tr><th colspan="2">รวม</th><th class="right">${fmt(totalDebit)}</th><th class="right">${fmt(totalCredit)}</th><th class="right">${fmt(running)}</th></tr></tfoot>
      </table></div>`
    : '<p class="ledger-empty muted">ไม่มีการเคลื่อนไหวในบัญชีนี้</p>';

  return `<article class="ledger-account card">
    <div class="ledger-account-head">
      <h4>${esc(account.code)} - ${esc(account.name)}</h4>
      <span class="ledger-balance">คงเหลือ ${fmt(running)}</span>
    </div>
    <div class="ledger-detail">
      <span class="ledger-detail-label">รายละเอียด</span>
      ${details}
    </div>
  </article>`;
}

function renderLedger() {
  const type = document.getElementById("ledger-type").value;
  const accountId = document.getElementById("ledger-account").value;
  const view = document.getElementById("ledger-view");
  if (!view) return;

  const accounts = state.accounts.filter(
    (account) =>
      (!type || (account.type || "other") === type) &&
      (!accountId || account.id === accountId),
  );
  if (!accounts.length) {
    view.innerHTML = state.accounts.length
      ? '<p class="empty-state">ไม่พบบัญชีในตัวกรองนี้</p>'
      : '<p class="empty-state">ยังไม่มีหมวดหมู่บัญชี</p>';
    return;
  }

  const groups = getLedgerGroups(accounts);
  view.innerHTML = groups
    .map(
      (group) => `<section class="ledger-group">
        <div class="ledger-group-head">
          <h3>${esc(group.label)}</h3>
          <span>${fmtInt(group.accounts.length)} บัญชี</span>
        </div>
        <div class="ledger-group-accounts">${group.accounts.map(renderLedgerAccount).join("")}</div>
      </section>`,
    )
    .join("");
}

/* ------------------------------------------------------------------ */
/* Trial balance                                                      */
/* ------------------------------------------------------------------ */

function renderTrial() {
  const view = document.getElementById("trial-view");
  if (!view) return;

  if (!state.accounts.length) {
    view.innerHTML = '<p class="empty-state">ยังไม่มีหมวดหมู่บัญชี</p>';
    return;
  }

  const totals = collectTotals(state.entries);
  const { rows, totalDebit, totalCredit, isBalanced } = buildTrialBalance(state.accounts, totals);

  const body = rows.length
    ? rows
        .map(
          (row) => `<tr>
            <td>${esc(row.account.code)}</td>
            <td>${esc(row.account.name)}</td>
            <td class="right">${row.balanceDebit ? fmt(row.balanceDebit) : ""}</td>
            <td class="right">${row.balanceCredit ? fmt(row.balanceCredit) : ""}</td>
          </tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="muted">ยังไม่มียอดคงเหลือ</td></tr>';

  const statusClass = isBalanced ? "balanced" : "unbalanced";
  view.innerHTML = `<table>
    <thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th class="right">เดบิต</th><th class="right">เครดิต</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <th colspan="2">รวม</th>
      <th class="right ${statusClass}">${fmt(totalDebit)}</th>
      <th class="right ${statusClass}">${fmt(totalCredit)}</th>
    </tr></tfoot>
  </table>
  <p style="margin-top:10px" class="${statusClass}">${isBalanced ? "งบทดลองดุล" : "งบทดลองไม่ดุล — ตรวจสอบรายการที่บันทึก"}</p>`;
}

/* ------------------------------------------------------------------ */
/* Worksheet                                                          */
/* ------------------------------------------------------------------ */

function renderWorksheet() {
  const view = document.getElementById("worksheet-view");
  if (!view) return;

  if (!state.accounts.length) {
    view.innerHTML = '<p class="empty-state">ยังไม่มีหมวดหมู่บัญชี</p>';
    return;
  }

  let totalTrialDebit = 0;
  let totalTrialCredit = 0;
  let totalIncomeDebit = 0;
  let totalIncomeCredit = 0;
  let totalBalanceDebit = 0;
  let totalBalanceCredit = 0;

  const rows = [];
  state.accounts.forEach((account) => {
    const { debit, credit, net } = accountBalance(account);
    const columns = balanceColumns(account, net);
    if (!columns.debit && !columns.credit && !debit && !credit) return;

    totalTrialDebit += columns.debit;
    totalTrialCredit += columns.credit;

    const isIncome = account.type === "revenue" || account.type === "expense";
    const incomeDebit = isIncome ? columns.debit : 0;
    const incomeCredit = isIncome ? columns.credit : 0;
    const balanceDebit = isIncome ? 0 : columns.debit;
    const balanceCredit = isIncome ? 0 : columns.credit;

    totalIncomeDebit += incomeDebit;
    totalIncomeCredit += incomeCredit;
    totalBalanceDebit += balanceDebit;
    totalBalanceCredit += balanceCredit;

    rows.push(`<tr>
      <td>${esc(account.code)}</td>
      <td>${esc(account.name)}</td>
      <td class="right">${columns.debit ? fmt(columns.debit) : ""}</td>
      <td class="right">${columns.credit ? fmt(columns.credit) : ""}</td>
      <td class="right"></td>
      <td class="right"></td>
      <td class="right">${columns.debit ? fmt(columns.debit) : ""}</td>
      <td class="right">${columns.credit ? fmt(columns.credit) : ""}</td>
      <td class="right">${incomeDebit ? fmt(incomeDebit) : ""}</td>
      <td class="right">${incomeCredit ? fmt(incomeCredit) : ""}</td>
      <td class="right">${balanceDebit ? fmt(balanceDebit) : ""}</td>
      <td class="right">${balanceCredit ? fmt(balanceCredit) : ""}</td>
    </tr>`);
  });

  const profit = totalIncomeCredit - totalIncomeDebit;
  const incomeDebitTotal = totalIncomeDebit + Math.max(0, profit);
  const incomeCreditTotal = totalIncomeCredit + Math.max(0, -profit);
  const balanceDebitTotal = totalBalanceDebit + Math.max(0, -profit);
  const balanceCreditTotal = totalBalanceCredit + Math.max(0, profit);

  view.innerHTML = `<div class="table-wrap"><table>
    <thead>
      <tr><th rowspan="2">รหัส</th><th rowspan="2">ชื่อบัญชี</th><th colspan="2">งบทดลอง</th><th colspan="2">ปรับปรุง</th><th colspan="2">หลังปรับปรุง</th><th colspan="2">งบกำไรขาดทุน</th><th colspan="2">งบดุล</th></tr>
      <tr><th class="right">Dr</th><th class="right">Cr</th><th class="right">Dr</th><th class="right">Cr</th><th class="right">Dr</th><th class="right">Cr</th><th class="right">Dr</th><th class="right">Cr</th><th class="right">Dr</th><th class="right">Cr</th></tr>
    </thead>
    <tbody>${rows.join("") || '<tr><td colspan="12" class="muted">ยังไม่มียอดคงเหลือ</td></tr>'}</tbody>
    <tfoot>
      <tr><th colspan="2">รวม</th><th class="right">${fmt(totalTrialDebit)}</th><th class="right">${fmt(totalTrialCredit)}</th><th class="right">-</th><th class="right">-</th><th class="right">${fmt(totalTrialDebit)}</th><th class="right">${fmt(totalTrialCredit)}</th><th class="right">${fmt(totalIncomeDebit)}</th><th class="right">${fmt(totalIncomeCredit)}</th><th class="right">${fmt(totalBalanceDebit)}</th><th class="right">${fmt(totalBalanceCredit)}</th></tr>
      <tr><th colspan="8">กำไร (ขาดทุน) สุทธิ</th><th class="right">${profit >= 0 ? fmt(profit) : ""}</th><th class="right">${profit < 0 ? fmt(-profit) : ""}</th><th class="right">${profit < 0 ? fmt(-profit) : ""}</th><th class="right">${profit >= 0 ? fmt(profit) : ""}</th></tr>
      <tr><th colspan="8">รวมหลังปิดบัญชี</th><th class="right">${fmt(incomeDebitTotal)}</th><th class="right">${fmt(incomeCreditTotal)}</th><th class="right">${fmt(balanceDebitTotal)}</th><th class="right">${fmt(balanceCreditTotal)}</th></tr>
    </tfoot>
  </table></div>`;
}

/* ------------------------------------------------------------------ */
/* Financial reports                                                  */
/* ------------------------------------------------------------------ */

const reportRange = { from: "", to: "" };

function reportPeriodLabel() {
  if (!reportRange.from && !reportRange.to) return "ทั้งงวด";
  const from = reportRange.from ? fmtDateDMY(reportRange.from) : "เริ่มต้น";
  const to = reportRange.to ? fmtDateDMY(reportRange.to) : "ปัจจุบัน";
  return `${from} - ${to}`;
}

function moneyRow(label, amount, extraClass = "") {
  return `<tr class="${extraClass}"><td>${label}</td><td class="right">${fmt(amount)}</td></tr>`;
}

function reportGroup(rows) {
  return rows
    .filter((row) => Math.abs(row.amount) > AMOUNT_EPSILON)
    .map((row) => `<tr><td>${esc(row.account.code)} ${esc(row.account.name)}</td><td class="right">${fmt(row.amount)}</td></tr>`)
    .join("");
}

function renderReports() {
  const view = document.getElementById("reports-view");
  if (!view) return;

  if (!state.accounts.length) {
    view.innerHTML = '<p class="empty-state">ยังไม่มีหมวดหมู่บัญชีให้สร้างรายงาน</p>';
    return;
  }

  const totals = collectTotals(state.entries, reportRange);
  const income = buildIncomeStatement(state.accounts, totals);
  const balance = buildBalanceSheet(state.accounts, totals, income.profit);
  const company = state.settings.company || "กิจการของฉัน";
  const hasMovement = income.revenue.length || income.expense.length || balance.assets.length || balance.liabilities.length || balance.equity.length;

  if (!hasMovement) {
    view.innerHTML = '<p class="empty-state">ไม่มีการเคลื่อนไหวในช่วงเวลาที่เลือก</p>';
    return;
  }

  const incomeBody =
    (income.revenue.length ? `<tr class="group-row"><td colspan="2">รายได้</td></tr>${reportGroup(income.revenue)}` : "") +
    `<tr class="total-row"><td>รายได้รวม</td><td class="right">${fmt(income.totalRevenue)}</td></tr>` +
    (income.expense.length ? `<tr class="group-row"><td colspan="2">ค่าใช้จ่าย</td></tr>${reportGroup(income.expense)}` : "") +
    `<tr class="total-row"><td>ค่าใช้จ่ายรวม</td><td class="right">${fmt(income.totalExpense)}</td></tr>` +
    moneyRow(income.profit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ", Math.abs(income.profit), "grand-total");

  const balanceBody =
    (balance.assets.length ? `<tr class="group-row"><td colspan="2">สินทรัพย์</td></tr>${reportGroup(balance.assets)}` : "") +
    `<tr class="total-row"><td>สินทรัพย์รวม</td><td class="right">${fmt(balance.totalAssets)}</td></tr>` +
    (balance.liabilities.length ? `<tr class="group-row"><td colspan="2">หนี้สิน</td></tr>${reportGroup(balance.liabilities)}` : "") +
    `<tr class="total-row"><td>หนี้สินรวม</td><td class="right">${fmt(balance.totalLiabilities)}</td></tr>` +
    (balance.equity.length ? `<tr class="group-row"><td colspan="2">ทุน</td></tr>${reportGroup(balance.equity)}` : "") +
    moneyRow("กำไร (ขาดทุน) งวดนี้", balance.profit) +
    `<tr class="total-row"><td>ส่วนของเจ้าของรวม</td><td class="right">${fmt(balance.totalEquity)}</td></tr>` +
    `<tr class="grand-total"><td>หนี้สิน + ส่วนของเจ้าของ</td><td class="right">${fmt(balance.totalLiabilitiesAndEquity)}</td></tr>`;

  const balanceNote = balance.isBalanced
    ? '<p class="hint balanced">งบดุลสมดุล</p>'
    : `<p class="hint unbalanced">งบดุลไม่สมดุล ต่างกัน ${fmt(Math.abs(balance.totalAssets - balance.totalLiabilitiesAndEquity))}</p>`;

  view.innerHTML = `<div class="report-grid">
    <div class="report">
      <div class="report-head">
        <h3>งบกำไรขาดทุน</h3>
        <div class="muted">${esc(company)} · ${reportPeriodLabel()}</div>
      </div>
      <table><thead><tr><th>รายการ</th><th class="right">จำนวน (${esc(state.settings.currency || "THB")})</th></tr></thead>
      <tbody>${incomeBody}</tbody></table>
      <p class="hint">คำนวณจากรายการบันทึกที่อยู่ในช่วงเวลาที่เลือก</p>
    </div>
    <div class="report">
      <div class="report-head">
        <h3>งบดุล</h3>
        <div class="muted">${esc(company)} · ${reportPeriodLabel()}</div>
      </div>
      <table><thead><tr><th>รายการ</th><th class="right">จำนวน (${esc(state.settings.currency || "THB")})</th></tr></thead>
      <tbody>${balanceBody}</tbody></table>
      ${balanceNote}
    </div>
  </div>`;
}

function bindReportControls() {
  const fromEl = document.getElementById("rp-from");
  const toEl = document.getElementById("rp-to");
  const applyButton = document.getElementById("rp-apply");
  const clearButton = document.getElementById("rp-clear");
  const exportButton = document.getElementById("rp-export");
  if (!fromEl || !toEl) return;

  const apply = () => {
    if (fromEl.value && toEl.value && fromEl.value > toEl.value) {
      toastError("วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด");
      return;
    }
    reportRange.from = fromEl.value;
    reportRange.to = toEl.value;
    renderReports();
  };

  applyButton.addEventListener("click", apply);
  clearButton.addEventListener("click", () => {
    fromEl.value = "";
    toEl.value = "";
    reportRange.from = "";
    reportRange.to = "";
    renderReports();
  });

  exportButton.addEventListener("click", () => {
    const totals = collectTotals(state.entries, reportRange);
    const income = buildIncomeStatement(state.accounts, totals);
    const balance = buildBalanceSheet(state.accounts, totals, income.profit);
    const rows = [["งบกำไรขาดทุน", ""]];
    income.revenue.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
    rows.push(["รายได้รวม", income.totalRevenue]);
    income.expense.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
    rows.push(["ค่าใช้จ่ายรวม", income.totalExpense]);
    rows.push([income.profit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ", income.profit]);
    rows.push(["", ""]);
    rows.push(["งบดุล", ""]);
    balance.assets.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
    rows.push(["สินทรัพย์รวม", balance.totalAssets]);
    balance.liabilities.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
    rows.push(["หนี้สินรวม", balance.totalLiabilities]);
    balance.equity.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
    rows.push(["กำไร (ขาดทุน) งวดนี้", balance.profit]);
    rows.push(["ส่วนของเจ้าของรวม", balance.totalEquity]);
    rows.push(["หนี้สิน + ส่วนของเจ้าของ", balance.totalLiabilitiesAndEquity]);

    downloadCsvFile(`reports-${fileStamp()}.csv`, toCsv(["รายการ", "จำนวน"], rows));
    toastSuccess("ส่งออกรายงานเรียบร้อย");
  });
}
/* ------------------------------------------------------------------ */
/* Dashboard                                                          */
/* ------------------------------------------------------------------ */

function renderChart(accounts, entries) {
  const buckets = monthlySummary(accounts, entries, 6);
  const peak = Math.max(
    1,
    ...buckets.map((bucket) => Math.max(bucket.revenue, bucket.expense)),
  );

  const columns = buckets
    .map((bucket) => {
      const revenueHeight = Math.round((Math.max(0, bucket.revenue) / peak) * 100);
      const expenseHeight = Math.round((Math.max(0, bucket.expense) / peak) * 100);
      return `<div class="chart-col" title="${esc(bucket.fullLabel)}: รายได้ ${fmt(bucket.revenue)} / ค่าใช้จ่าย ${fmt(bucket.expense)}">
        <div class="chart-bars">
          <div class="chart-bar revenue" style="height:${revenueHeight}%"></div>
          <div class="chart-bar expense" style="height:${expenseHeight}%"></div>
        </div>
        <div class="chart-label">${esc(bucket.label)}</div>
      </div>`;
    })
    .join("");

  return `<div class="chart">${columns}</div>
    <div class="chart-legend">
      <span><span class="legend-dot" style="background:var(--accent)"></span>รายได้</span>
      <span><span class="legend-dot" style="background:#c7d2fe"></span>ค่าใช้จ่าย</span>
    </div>`;
}

function renderDashboard() {
  const view = document.getElementById("dashboard-view");
  if (!view) return;

  const totals = { revenue: 0, expense: 0, asset: 0, liability: 0, equity: 0 };
  state.accounts.forEach((account) => {
    const { net } = accountBalance(account);
    if (account.type in totals) totals[account.type] += net;
  });

  const profit = totals.revenue - totals.expense;
  const receivables = state.receivables || [];
  const outstanding = receivables.reduce(
    (total, row) => total + Math.max(0, (Number(row.amount) || 0) - (Number(row.paid) || 0)),
    0,
  );
  const today = todayIso();
  const overdue = receivables.filter((row) => {
    const remaining = (Number(row.amount) || 0) - (Number(row.paid) || 0);
    return remaining > AMOUNT_EPSILON && row.due && row.due < today;
  }).length;

  const company = state.settings.company || "ยังไม่ได้ตั้งชื่อกิจการ";
  const recent = state.entries.slice(-5).reverse();

  view.innerHTML = `
    <div class="cards">
      <div class="stat"><div class="muted">รายได้รวม</div><div class="stat-value">${fmt(totals.revenue)}</div></div>
      <div class="stat"><div class="muted">ค่าใช้จ่ายรวม</div><div class="stat-value">${fmt(totals.expense)}</div></div>
      <div class="stat"><div class="muted">กำไร (ขาดทุน) สุทธิ</div><div class="stat-value ${profit >= 0 ? "balanced" : "unbalanced"}">${fmt(profit)}</div></div>
      <div class="stat"><div class="muted">ลูกหนี้คงค้าง</div><div class="stat-value">${fmt(outstanding)}</div></div>
    </div>
    <div class="cards" style="margin-top:12px">
      <div class="stat"><div class="muted">สินทรัพย์</div><div class="stat-value">${fmt(totals.asset)}</div></div>
      <div class="stat"><div class="muted">หนี้สิน</div><div class="stat-value">${fmt(totals.liability)}</div></div>
      <div class="stat"><div class="muted">ส่วนของเจ้าของ</div><div class="stat-value">${fmt(totals.equity)}</div></div>
      <div class="stat"><div class="muted">รายการ / ลูกค้า</div><div class="stat-value">${fmtInt(state.entries.length)} / ${fmtInt(state.customers.length)}</div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3 style="margin-top:0">รายได้และค่าใช้จ่าย 6 เดือนล่าสุด</h3>
      ${renderChart(state.accounts, state.entries)}
    </div>

    <div class="card">
      <h3 style="margin-top:0">ภาพรวม</h3>
      <p><strong>กิจการ:</strong> ${esc(company)}</p>
      <p class="muted">หมวดหมู่บัญชี ${fmtInt(state.accounts.length)} บัญชี · รายการบันทึก ${fmtInt(state.entries.length)} รายการ · ลูกหนี้ค้างชำระ ${fmtInt(receivables.filter((row) => (Number(row.amount) || 0) - (Number(row.paid) || 0) > AMOUNT_EPSILON).length)} รายการ${overdue ? ` (เกินกำหนด ${fmtInt(overdue)})` : ""}</p>
      <p class="muted">รายชื่อลูกค้า(ไฟล์) ${fmtInt(state.customerNames.length)} ราย · ต้นทุน/ขาย ${fmtInt(state.customerCosts.length)} รายการ · เอกสารรับเข้า ${fmtInt(state.incomingDocs.length)} รายการ</p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">รายการล่าสุด</h3>
      ${
        recent.length
          ? `<table><thead><tr><th>วันที่</th><th>รายละเอียด</th><th class="right">จำนวน</th></tr></thead><tbody>${recent
              .map(
                (entry) => `<tr>
                  <td>${esc(fmtDateDMY(entry.date))}</td>
                  <td>${esc(entry.desc || "(ไม่มีคำอธิบาย)")}</td>
                  <td class="right">${fmt(entryTotal(entry))}</td>
                </tr>`,
              )
              .join("")}</tbody></table>`
          : '<p class="muted">ยังไม่มีรายการบันทึก</p>'
      }
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Customers                                                          */
/* ------------------------------------------------------------------ */

const custForm = document.getElementById("customer-form");
const custSubmit = document.getElementById("cust-submit");
const custCancel = document.getElementById("cust-cancel");
let editingCustomerId = null;

function resetCustomerForm() {
  editingCustomerId = null;
  custForm.reset();
  custSubmit.textContent = "เพิ่มลูกค้า";
  custCancel.hidden = true;
}

custCancel.addEventListener("click", () => {
  resetCustomerForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

custForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = document.getElementById("cust-code").value.trim();
  const name = document.getElementById("cust-name").value.trim();
  const phone = document.getElementById("cust-phone").value.trim();
  const tax = document.getElementById("cust-tax").value.trim();
  const address = document.getElementById("cust-address").value.trim();
  if (!code || !name) return;

  if (state.customers.some((customer) => customer.code === code && customer.id !== editingCustomerId)) {
    toastError(`รหัสลูกค้า ${code} มีอยู่แล้ว`);
    return;
  }

  const isEdit = !!editingCustomerId;
  const previous = JSON.stringify(state);

  if (isEdit) {
    const customer = state.customers.find((item) => item.id === editingCustomerId);
    if (!customer) {
      resetCustomerForm();
      return;
    }
    Object.assign(customer, { code, name, phone, tax, address });
  } else {
    state.customers.push({ id: uid(), code, name, phone, tax, address });
  }
  state.customers.sort((a, b) => (a.code || "").localeCompare(b.code || ""));

  if (!(await save(["customers"]))) {
    state = JSON.parse(previous);
    return;
  }

  resetCustomerForm();
  renderCustomers();
  renderCustomerOptions();
  renderJournalCustomerOptions();
  renderAutoDescCustomerOptions();
  toastSuccess(isEdit ? "แก้ไขข้อมูลลูกค้าเรียบร้อย" : "เพิ่มลูกค้าเรียบร้อย");
});

function renderCustomers() {
  const tbody = document.querySelector("#customers-table tbody");
  if (!tbody) return;
  if (!state.customers.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">ยังไม่มีลูกค้า</td></tr>';
    return;
  }

  tbody.innerHTML = state.customers
    .map(
      (customer) => `<tr>
        <td>${esc(customer.code)}</td>
        <td>${esc(customer.name)}</td>
        <td>${esc(customer.phone)}</td>
        <td>${esc(customer.tax)}</td>
        <td>${esc(customer.address)}</td>
        <td class="actions-cell">
          <button class="small secondary" data-edit-cust="${customer.id}">แก้ไข</button>
          <button class="small danger" data-del-cust="${customer.id}">ลบ</button>
        </td>
      </tr>`,
    )
    .join("");

  tbody.querySelectorAll("[data-edit-cust]").forEach((button) => {
    button.addEventListener("click", () => {
      const customer = state.customers.find((item) => item.id === button.dataset.editCust);
      if (!customer) return;
      editingCustomerId = customer.id;
      document.getElementById("cust-code").value = customer.code || "";
      document.getElementById("cust-name").value = customer.name || "";
      document.getElementById("cust-phone").value = customer.phone || "";
      document.getElementById("cust-tax").value = customer.tax || "";
      document.getElementById("cust-address").value = customer.address || "";
      custSubmit.textContent = "บันทึกการแก้ไข";
      custCancel.hidden = false;
      document.getElementById("cust-code").focus();
    });
  });

  tbody.querySelectorAll("[data-del-cust]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.delCust;
      if (state.receivables.some((row) => row.customerId === id)) {
        toastError("ลูกค้ารายนี้มีรายการลูกหนี้อยู่ ลบไม่ได้");
        return;
      }
      if (!(await confirmAction("ยืนยันการลบลูกค้านี้?"))) return;

      const previous = JSON.stringify(state);
      state.customers = state.customers.filter((customer) => customer.id !== id);
      if (editingCustomerId === id) resetCustomerForm();

      if (!(await save(["customers"]))) {
        state = JSON.parse(previous);
        renderCustomers();
        return;
      }
      renderCustomers();
      renderCustomerOptions();
      renderJournalCustomerOptions();
      renderAutoDescCustomerOptions();
      toastSuccess("ลบลูกค้าเรียบร้อย");
    });
  });
}

function renderCustomerOptions() {
  const select = document.getElementById("ar-customer");
  if (!select) return;
  const current = select.value;
  select.innerHTML =
    '<option value="">-- เลือกลูกค้า --</option>' +
    state.customers
      .map((customer) => `<option value="${customer.id}">${esc(customerLabel(customer))}</option>`)
      .join("");
  if (current) select.value = current;
}

/* ------------------------------------------------------------------ */
/* Customer names imported from files                                 */
/* ------------------------------------------------------------------ */

const cnameForm = document.getElementById("cname-form");
const cnameSubmit = document.getElementById("cname-submit");
const cnameCancel = document.getElementById("cname-cancel");
let editingCNameIndex = null;

function resetCNameForm() {
  editingCNameIndex = null;
  if (cnameForm) cnameForm.reset();
  if (cnameSubmit) cnameSubmit.textContent = "เพิ่มชื่อ";
  if (cnameCancel) cnameCancel.hidden = true;
}

if (cnameForm) {
  cnameCancel.addEventListener("click", () => {
    resetCNameForm();
    toast("ยกเลิกการแก้ไขแล้ว");
  });

  cnameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("cname-input").value.trim();
    if (!name) return;

    const isEdit = editingCNameIndex != null && !!state.customerNames[editingCNameIndex];
    const previous = JSON.stringify(state);

    if (isEdit) {
      state.customerNames[editingCNameIndex].name = name;
    } else {
      state.customerNames.push({ name, fileId: null });
    }

    if (!(await save(["customerNames"]))) {
      state = JSON.parse(previous);
      return;
    }
    resetCNameForm();
    renderCustomerNames();
    renderJournalCustomerOptions();
    renderAutoDescCustomerOptions();
    toastSuccess(isEdit ? "แก้ไขรายชื่อลูกค้าเรียบร้อย" : "เพิ่มรายชื่อลูกค้าเรียบร้อย");
  });
}

function renderCustomerNames() {
  const tbody = document.querySelector("#customer-names-table tbody");
  if (!tbody) return;
  if (!state.customerNames.length) {
    tbody.innerHTML = '<tr><td colspan="2" class="muted">ยังไม่มีรายชื่อจากไฟล์</td></tr>';
    return;
  }

  tbody.innerHTML = state.customerNames
    .map(
      (row, index) => `<tr>
        <td>${esc(row.name || "")}</td>
        <td class="actions-cell">
          <button class="small secondary" data-edit-cname="${index}">แก้ไข</button>
          <button class="small danger" data-del-cname="${index}">ลบ</button>
        </td>
      </tr>`,
    )
    .join("");

  tbody.querySelectorAll("[data-edit-cname]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.editCname);
      const row = state.customerNames[index];
      if (!row) return;
      editingCNameIndex = index;
      document.getElementById("cname-input").value = row.name || "";
      cnameSubmit.textContent = "บันทึกการแก้ไข";
      cnameCancel.hidden = false;
      document.getElementById("cname-input").focus();
    });
  });

  tbody.querySelectorAll("[data-del-cname]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบรายชื่อลูกค้านี้?"))) return;
      const index = Number(button.dataset.delCname);
      const previous = JSON.stringify(state);
      state.customerNames.splice(index, 1);
      if (editingCNameIndex === index) resetCNameForm();
      else if (editingCNameIndex > index) editingCNameIndex -= 1;

      if (!(await save(["customerNames"]))) {
        state = JSON.parse(previous);
        renderCustomerNames();
        return;
      }
      renderCustomerNames();
      renderJournalCustomerOptions();
      renderAutoDescCustomerOptions();
      toastSuccess("ลบรายชื่อลูกค้าเรียบร้อย");
    });
  });
}

/* ------------------------------------------------------------------ */
/* Customer costs and incoming documents                              */
/* ------------------------------------------------------------------ */

function renderCustomerCosts() {
  const tbody = document.querySelector("#customer-costs-table tbody");
  if (!tbody) return;
  if (!state.customerCosts.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">ยังไม่มีข้อมูล</td></tr>';
    return;
  }

  tbody.innerHTML = state.customerCosts
    .map(
      (row, index) => `<tr>
        <td>${esc(fmtDateDMY(row.date || ""))}</td>
        <td>${esc(row.name || "")}</td>
        <td class="right">${fmt(row.cost)}</td>
        <td class="right">${fmt(row.price)}</td>
        <td><button class="small danger" data-del-cc="${index}">ลบ</button></td>
      </tr>`,
    )
    .join("");

  tbody.querySelectorAll("[data-del-cc]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบรายการนี้?"))) return;
      const previous = JSON.stringify(state);
      state.customerCosts.splice(Number(button.dataset.delCc), 1);
      if (!(await save(["customerCosts"]))) {
        state = JSON.parse(previous);
        return;
      }
      renderCustomerCosts();
      toastSuccess("ลบรายการเรียบร้อย");
    });
  });
}

function renderIncomingDocs() {
  const tbody = document.querySelector("#incoming-docs-table tbody");
  if (!tbody) return;
  if (!state.incomingDocs.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">ยังไม่มีข้อมูล</td></tr>';
    return;
  }

  tbody.innerHTML = state.incomingDocs
    .map(
      (row, index) => `<tr>
        <td>${esc(fmtDateDMY(row.date || ""))}</td>
        <td>${esc(row.docType || "")}</td>
        <td>${esc(row.supplier || "")}</td>
        <td class="right">${fmt(row.total)}</td>
        <td class="right">${fmt(row.discount)}</td>
        <td>${esc(row.payment || "")}</td>
        <td><button class="small danger" data-del-idoc="${index}">ลบ</button></td>
      </tr>`,
    )
    .join("");

  tbody.querySelectorAll("[data-del-idoc]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบเอกสารนี้?"))) return;
      const previous = JSON.stringify(state);
      state.incomingDocs.splice(Number(button.dataset.delIdoc), 1);
      if (!(await save(["incomingDocs"]))) {
        state = JSON.parse(previous);
        return;
      }
      renderIncomingDocs();
      toastSuccess("ลบเอกสารเรียบร้อย");
    });
  });
}

/* ------------------------------------------------------------------ */
/* Receivables                                                        */
/* ------------------------------------------------------------------ */

const arForm = document.getElementById("receivable-form");
const arSubmit = document.getElementById("ar-submit");
const arCancel = document.getElementById("ar-cancel");
let editingArId = null;

function resetArForm() {
  editingArId = null;
  arForm.reset();
  arSubmit.textContent = "เพิ่มลูกหนี้";
  arCancel.hidden = true;
  document.getElementById("ar-date").value = todayIso();
  document.getElementById("ar-paid").value = "0";
}

arCancel.addEventListener("click", () => {
  resetArForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

arForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const customerId = document.getElementById("ar-customer").value;
  const docNo = document.getElementById("ar-doc").value.trim();
  const date = document.getElementById("ar-date").value;
  const due = document.getElementById("ar-due").value;
  const amount = parseFloat(document.getElementById("ar-amount").value) || 0;
  const paid = parseFloat(document.getElementById("ar-paid").value) || 0;
  const note = document.getElementById("ar-note").value.trim();

  if (!customerId) {
    toastError("เลือกลูกค้าก่อน");
    return;
  }
  if (!docNo || !date) {
    toastError("กรอกเลขที่เอกสารและวันที่ให้ครบ");
    return;
  }
  if (amount <= 0) {
    toastError("จำนวนเงินต้องมากกว่า 0");
    return;
  }

  const isEdit = !!editingArId;
  const previous = JSON.stringify(state);
  const payload = { customerId, docNo, date, due, amount, paid, note };

  if (isEdit) {
    const row = state.receivables.find((item) => item.id === editingArId);
    if (!row) {
      resetArForm();
      return;
    }
    Object.assign(row, payload);
  } else {
    state.receivables.push({ id: uid(), ...payload });
  }
  state.receivables.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (!(await save(["receivables"]))) {
    state = JSON.parse(previous);
    return;
  }
  resetArForm();
  renderReceivables();
  renderDashboard();
  toastSuccess(isEdit ? "แก้ไขรายการลูกหนี้เรียบร้อย" : "เพิ่มรายการลูกหนี้เรียบร้อย");
});

function renderReceivables() {
  const tbody = document.querySelector("#receivables-table tbody");
  const summary = document.getElementById("receivables-summary");
  if (!tbody || !summary) return;

  const today = todayIso();
  const total = state.receivables.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const paid = state.receivables.reduce((sum, row) => sum + (Number(row.paid) || 0), 0);
  const outstanding = Math.max(0, total - paid);

  summary.innerHTML = `<div class="stat"><div class="muted">ยอดลูกหนี้รวม</div><div class="stat-value">${fmt(total)}</div></div>
    <div class="stat"><div class="muted">รับชำระแล้ว</div><div class="stat-value">${fmt(paid)}</div></div>
    <div class="stat"><div class="muted">คงค้าง</div><div class="stat-value ${outstanding > 0 ? "unbalanced" : "balanced"}">${fmt(outstanding)}</div></div>`;

  if (!state.receivables.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">ยังไม่มีรายการลูกหนี้</td></tr>';
    return;
  }

  tbody.innerHTML = state.receivables
    .slice()
    .reverse()
    .map((row) => {
      const customer = getCustomer(row.customerId);
      const amount = Number(row.amount) || 0;
      const paidAmount = Number(row.paid) || 0;
      const remaining = Math.max(0, amount - paidAmount);

      let status = "คงค้าง";
      let statusClass = "unbalanced";
      if (remaining <= AMOUNT_EPSILON) {
        status = "ชำระแล้ว";
        statusClass = "balanced";
      } else if (row.due && row.due < today) {
        status = "เกินกำหนด";
        statusClass = "unbalanced";
      }

      return `<tr>
        <td>${esc(customer ? customerLabel(customer) : "-")}</td>
        <td>${esc(row.docNo)}</td>
        <td>${esc(fmtDateDMY(row.date))}</td>
        <td>${esc(row.due ? fmtDateDMY(row.due) : "-")}</td>
        <td class="right">${fmt(amount)}</td>
        <td class="right">${fmt(paidAmount)}</td>
        <td class="right">${fmt(remaining)}</td>
        <td class="${statusClass}">${status}</td>
        <td class="actions-cell">
          <button class="small secondary" data-edit-ar="${row.id}">แก้ไข</button>
          <button class="small danger" data-del-ar="${row.id}">ลบ</button>
        </td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-edit-ar]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = state.receivables.find((item) => item.id === button.dataset.editAr);
      if (!row) return;
      editingArId = row.id;
      renderCustomerOptions();
      document.getElementById("ar-customer").value = row.customerId || "";
      document.getElementById("ar-doc").value = row.docNo || "";
      document.getElementById("ar-date").value = toIsoDate(row.date) || "";
      document.getElementById("ar-due").value = toIsoDate(row.due) || "";
      document.getElementById("ar-amount").value = row.amount || 0;
      document.getElementById("ar-paid").value = row.paid || 0;
      document.getElementById("ar-note").value = row.note || "";
      arSubmit.textContent = "บันทึกการแก้ไข";
      arCancel.hidden = false;
      document.getElementById("ar-doc").focus();
    });
  });

  tbody.querySelectorAll("[data-del-ar]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบรายการลูกหนี้นี้?"))) return;
      const id = button.dataset.delAr;
      const previous = JSON.stringify(state);
      state.receivables = state.receivables.filter((row) => row.id !== id);
      if (editingArId === id) resetArForm();

      if (!(await save(["receivables"]))) {
        state = JSON.parse(previous);
        renderReceivables();
        return;
      }
      renderReceivables();
      renderDashboard();
      toastSuccess("ลบรายการลูกหนี้เรียบร้อย");
    });
  });
}
/* ------------------------------------------------------------------ */
/* Automatic descriptions                                             */
/* ------------------------------------------------------------------ */

const adForm = document.getElementById("autodesc-form");
const adSubmit = document.getElementById("ad-submit");
const adCancel = document.getElementById("ad-cancel");
let editingAdId = null;

function resetAdForm() {
  editingAdId = null;
  adForm.reset();
  adSubmit.textContent = "เพิ่มคำอธิบาย";
  adCancel.hidden = true;
}

function renderAdAccountSelects() {
  const debitSelect = document.getElementById("ad-debit");
  const creditSelect = document.getElementById("ad-credit");
  if (!debitSelect || !creditSelect) return;

  const debitValue = debitSelect.value;
  const creditValue = creditSelect.value;
  const html = accountOptions("");
  debitSelect.innerHTML = html;
  creditSelect.innerHTML = html;
  if (debitValue) debitSelect.value = debitValue;
  if (creditValue) creditSelect.value = creditValue;
}

adCancel.addEventListener("click", () => {
  resetAdForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

adForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rawCustomer = document.getElementById("ad-customer").value;
  const debitAccountId = document.getElementById("ad-debit").value;
  const creditAccountId = document.getElementById("ad-credit").value;
  const text = document.getElementById("ad-text").value.trim();

  if (!rawCustomer || !debitAccountId || !creditAccountId || !text) {
    toastError("กรอกข้อมูลให้ครบก่อนบันทึก");
    return;
  }

  const { customerId, customerName } = resolveAdCustomer(rawCustomer);
  const isEdit = !!editingAdId;
  const previous = JSON.stringify(state);
  const payload = { debitAccountId, creditAccountId, text };
  if (customerId) payload.customerId = customerId;
  if (customerName) payload.customerName = customerName;

  if (isEdit) {
    const rule = state.autoDesc.find((item) => item.id === editingAdId);
    if (!rule) {
      resetAdForm();
      return;
    }
    delete rule.customerId;
    delete rule.customerName;
    delete rule.keyword;
    Object.assign(rule, payload);
  } else {
    state.autoDesc.push({ id: uid(), ...payload });
  }

  if (!(await save(["autoDesc"]))) {
    state = JSON.parse(previous);
    return;
  }
  resetAdForm();
  renderAutoDesc();
  toastSuccess(isEdit ? "แก้ไขคำอธิบายอัตโนมัติเรียบร้อย" : "เพิ่มคำอธิบายอัตโนมัติเรียบร้อย");
});

function autoDescCustomerLabel(rule) {
  if (rule.customerId) {
    const customer = getCustomer(rule.customerId);
    if (customer) return customerLabel(customer);
  }
  return rule.customerName || "-";
}

function renderAutoDescTable() {
  const tbody = document.querySelector("#autodesc-table tbody");
  if (!tbody) return;

  if (!state.autoDesc.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">ยังไม่มีคำอธิบายอัตโนมัติ</td></tr>';
    return;
  }

  tbody.innerHTML = state.autoDesc
    .map((rule) => {
      const debit = getAccount(rule.debitAccountId);
      const credit = getAccount(rule.creditAccountId);
      return `<tr>
        <td>${esc(autoDescCustomerLabel(rule))}</td>
        <td>${debit ? `${esc(debit.code)} - ${esc(debit.name)}` : '<span class="unbalanced">(ไม่พบบัญชี)</span>'}</td>
        <td>${credit ? `${esc(credit.code)} - ${esc(credit.name)}` : '<span class="unbalanced">(ไม่พบบัญชี)</span>'}</td>
        <td>${esc(rule.text || "")}</td>
        <td class="actions-cell">
          <button class="small secondary" data-edit-ad="${rule.id}">แก้ไข</button>
          <button class="small danger" data-del-ad="${rule.id}">ลบ</button>
        </td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-edit-ad]").forEach((button) => {
    button.addEventListener("click", () => {
      const rule = state.autoDesc.find((item) => item.id === button.dataset.editAd);
      if (!rule) return;
      editingAdId = rule.id;
      renderAdSelects();
      const customerSelect = document.getElementById("ad-customer");
      if (rule.customerId) customerSelect.value = `id:${rule.customerId}`;
      else if (rule.customerName) customerSelect.value = `name:${rule.customerName}`;
      document.getElementById("ad-debit").value = rule.debitAccountId || "";
      document.getElementById("ad-credit").value = rule.creditAccountId || "";
      document.getElementById("ad-text").value = rule.text || "";
      adSubmit.textContent = "บันทึกการแก้ไข";
      adCancel.hidden = false;
      customerSelect.focus();
    });
  });

  tbody.querySelectorAll("[data-del-ad]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบคำอธิบายอัตโนมัตินี้?"))) return;
      const id = button.dataset.delAd;
      const previous = JSON.stringify(state);
      state.autoDesc = state.autoDesc.filter((rule) => rule.id !== id);
      if (editingAdId === id) resetAdForm();

      if (!(await save(["autoDesc"]))) {
        state = JSON.parse(previous);
        renderAutoDesc();
        return;
      }
      renderAutoDesc();
      toastSuccess("ลบคำอธิบายอัตโนมัติเรียบร้อย");
    });
  });
}

function renderAdSelects() {
  renderAutoDescCustomerOptions();
  renderAdAccountSelects();
}

function renderAutoDesc() {
  renderAdSelects();
  renderAutoDescTable();
}

/* ------------------------------------------------------------------ */
/* Imported file tracking                                             */
/* ------------------------------------------------------------------ */

const IMPORT_TYPE_LABELS = {
  customer_names: "รายชื่อลูกค้า",
  customer_costs: "รายชื่อลูกค้าพร้อมต้นทุน",
  incoming_docs: "เอกสารรับเข้า",
};

function renderImportFiles(filterType) {
  const container = filterType
    ? document.getElementById(`import-files-${filterType}`)
    : document.getElementById("import-files-all");
  if (!container) return;

  const files = state.importFiles.filter((file) => !filterType || file.type === filterType);
  if (!files.length) {
    container.innerHTML = '<p class="muted">ยังไม่มีไฟล์ที่นำเข้า</p>';
    return;
  }

  container.innerHTML = `<div class="card">
    <h3>ไฟล์ที่นำเข้า</h3>
    <table>
      <thead><tr><th>ชื่อไฟล์</th><th>ประเภท</th><th class="right">จำนวน</th><th>จัดการ</th></tr></thead>
      <tbody>${files
        .map(
          (file) => `<tr>
            <td>${esc(file.name)}</td>
            <td>${esc(IMPORT_TYPE_LABELS[file.type] || file.type)}</td>
            <td class="right">${fmtInt(file.count || 0)}</td>
            <td><button class="small danger" data-del-file="${file.id}">ลบไฟล์</button></td>
          </tr>`,
        )
        .join("")}</tbody>
    </table>
  </div>`;

  container.querySelectorAll("[data-del-file]").forEach((button) => {
    button.addEventListener("click", async () => {
      const fileId = button.dataset.delFile;
      const file = state.importFiles.find((item) => item.id === fileId);
      if (!file) return;
      if (!(await confirmAction(`ยืนยันการลบไฟล์ "${file.name}" และข้อมูลทั้งหมดที่นำเข้าจากไฟล์นี้?`))) return;

      const previous = JSON.stringify(state);
      const keep = (row) => row.fileId !== fileId;
      if (file.type === "customer_names") state.customerNames = state.customerNames.filter(keep);
      if (file.type === "customer_costs") state.customerCosts = state.customerCosts.filter(keep);
      if (file.type === "incoming_docs") state.incomingDocs = state.incomingDocs.filter(keep);
      state.importFiles = state.importFiles.filter((item) => item.id !== fileId);

      if (!(await save(["customerNames", "customerCosts", "incomingDocs", "importFiles"]))) {
        state = JSON.parse(previous);
        return;
      }
      renderCustomerNames();
      renderCustomerCosts();
      renderIncomingDocs();
      renderImportFiles();
      renderImportFiles(filterType);
      renderDashboard();
      toastSuccess("ลบไฟล์และข้อมูลที่เกี่ยวข้องเรียบร้อย");
    });
  });
}
/* ------------------------------------------------------------------ */
/* Excel import                                                       */
/* ------------------------------------------------------------------ */

let importRows = [];
const IMPORT_COLUMNS = {
  customer_names: ["ชื่อลูกค้า"],
  customer_costs: ["วันที่", "ชื่อลูกค้า", "ราคาทุน", "ราคาขาย"],
  incoming_docs: ["วันที่", "ประเภทเอกสาร", "ซัพพลายเออร์", "ยอดรวม", "ส่วนลด", "รูปแบบการชำระเงิน"],
  accounts: ["รหัสบัญชี", "ชื่อบัญชี", "ประเภท"],
  customers: ["รหัสลูกค้า", "ชื่อลูกค้า", "โทรศัพท์", "เลขผู้เสียภาษี", "ที่อยู่"],
  receivables: ["รหัสลูกค้า", "เลขที่เอกสาร", "วันที่", "ครบกำหนด", "จำนวนเงิน", "ชำระแล้ว"],
  journal: ["วันที่", "คำอธิบาย", "รหัสบัญชี", "เดบิต", "เครดิต", "อ้างอิง"],
};

function pick(row, names) {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim() !== "") return row[name];
  }
  return "";
}

function num(value) {
  const parsed = parseFloat(String(value == null ? "" : value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function renderImportPreview(rows) {
  const view = document.getElementById("import-preview-view");
  if (!view) return;
  if (!rows.length) {
    view.innerHTML = '<p class="empty-state">ไม่พบข้อมูลในไฟล์</p>';
    return;
  }

  const keys = Object.keys(rows[0]);
  view.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>${keys.map((key) => `<th>${esc(key)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .slice(0, 5)
      .map((row) => `<tr>${keys.map((key) => `<td>${esc(row[key])}</td>`).join("")}</tr>`)
      .join("")}</tbody>
  </table></div>
  <p class="muted" style="margin-top:8px">แสดง ${fmtInt(Math.min(5, rows.length))} จาก ${fmtInt(rows.length)} แถว</p>`;
}

function importCustomerNames(rows, fileId, fileName) {
  let added = 0;
  rows.forEach((row) => {
    const name = String(pick(row, ["ชื่อลูกค้า", "name", "Name", "customer"])).trim();
    if (!name) return;
    state.customerNames.push({ name, fileId });
    added += 1;
  });
  return added;
}

function importCustomerCosts(rows, fileId) {
  let added = 0;
  rows.forEach((row) => {
    const date = fmtDateDMY(pick(row, ["วันที่", "date", "Date"]));
    const name = String(pick(row, ["ชื่อลูกค้า", "name", "Name"])).trim();
    const cost = num(pick(row, ["ราคาทุน", "cost", "Cost"]));
    const price = num(pick(row, ["ราคาขาย", "price", "Price", "sale"]));
    if (!name && !date && !cost && !price) return;
    state.customerCosts.push({ date, name, cost, price, fileId });
    added += 1;
  });
  return added;
}

function importIncomingDocs(rows, fileId) {
  let added = 0;
  rows.forEach((row) => {
    const date = fmtDateDMY(pick(row, ["วันที่", "date", "Date"]));
    const docType = String(pick(row, ["ประเภทเอกสาร", "docType", "type"])).trim();
    const supplier = String(pick(row, ["ซัพพลายเออร์", "supplier", "vendor"])).trim();
    const total = num(pick(row, ["ยอดรวม", "total", "amount"]));
    const discount = num(pick(row, ["ส่วนลด", "discount"]));
    const payment = String(pick(row, ["รูปแบบการชำระเงิน", "payment"])).trim();
    if (!date && !docType && !supplier && !total && !discount && !payment) return;
    state.incomingDocs.push({ date, docType, supplier, total, discount, payment, fileId });
    added += 1;
  });
  return added;
}

function importAccounts(rows) {
  let added = 0;
  rows.forEach((row) => {
    const code = String(pick(row, ["รหัสบัญชี", "code", "Code"])).trim();
    const name = String(pick(row, ["ชื่อบัญชี", "name", "Name"])).trim();
    const type = String(pick(row, ["ประเภท", "type", "Type"])).trim().toLowerCase();
    if (!code || !name || !TYPES[type]) return;
    if (state.accounts.some((account) => account.code === code)) return;
    state.accounts.push({ id: uid(), code, name, type });
    added += 1;
  });
  state.accounts.sort((a, b) => a.code.localeCompare(b.code));
  return added;
}

function importCustomers(rows) {
  let added = 0;
  rows.forEach((row) => {
    const code = String(pick(row, ["รหัสลูกค้า", "code", "Code"])).trim();
    const name = String(pick(row, ["ชื่อลูกค้า", "ชื่อ", "name", "Name"])).trim();
    if (!code || !name) return;
    if (state.customers.some((customer) => customer.code === code)) return;
    state.customers.push({
      id: uid(),
      code,
      name,
      phone: String(pick(row, ["โทรศัพท์", "phone"])).trim(),
      tax: String(pick(row, ["เลขผู้เสียภาษี", "tax"])).trim(),
      address: String(pick(row, ["ที่อยู่", "address"])).trim(),
    });
    added += 1;
  });
  state.customers.sort((a, b) => (a.code || "").localeCompare(b.code || ""));
  return added;
}

function importReceivables(rows) {
  let added = 0;
  rows.forEach((row) => {
    const code = String(pick(row, ["รหัสลูกค้า", "customerCode"])).trim();
    const customer = state.customers.find((item) => item.code === code);
    if (!customer) return;
    const amount = num(pick(row, ["จำนวนเงิน", "amount"]));
    if (amount <= 0) return;
    const date = toIsoDate(pick(row, ["วันที่", "date"]));
    const due = toIsoDate(pick(row, ["ครบกำหนด", "due"]));
    state.receivables.push({
      id: uid(),
      customerId: customer.id,
      docNo: String(pick(row, ["เลขที่เอกสาร", "docNo", "doc"])).trim() || `IMP-${uid()}`,
      date,
      due,
      amount,
      paid: num(pick(row, ["ชำระแล้ว", "paid"])),
      note: String(pick(row, ["หมายเหตุ", "note"])).trim(),
    });
    added += 1;
  });
  return added;
}

function importJournal(rows) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const acode = String(pick(row, ["รหัสบัญชี", "accountCode", "code"])).trim();
    const account = state.accounts.find((item) => item.code === acode);
    if (!account) return;
    const debit = num(pick(row, ["เดบิต", "debit"]));
    const credit = num(pick(row, ["เครดิต", "credit"]));
    if (!debit && !credit) return;

    const date = toIsoDate(pick(row, ["วันที่", "date"]));
    const desc = String(pick(row, ["คำอธิบาย", "desc", "description"])).trim();
    const ref = String(pick(row, ["อ้างอิง", "ref", "group"])).trim();
    const key = ref ? `ref:${ref}` : `${date}|${desc}|${index}`;
    if (!groups.has(key)) groups.set(key, { date, desc, lines: [] });
    groups.get(key).lines.push({ accountId: account.id, debit, credit });
  });

  let added = 0;
  groups.forEach((group) => {
    if (group.lines.length < 2) return;
    const totalDebit = group.lines.reduce((total, line) => total + line.debit, 0);
    const totalCredit = group.lines.reduce((total, line) => total + line.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > AMOUNT_EPSILON || totalDebit === 0) return;
    state.entries.push({ id: uid(), date: group.date, desc: group.desc, lines: group.lines });
    added += 1;
  });
  state.entries.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return added;
}

function refreshAllViews() {
  renderAccounts();
  renderJournal();
  renderCustomers();
  renderCustomerNames();
  renderCustomerCosts();
  renderIncomingDocs();
  renderReceivables();
  renderCustomerOptions();
  renderJournalCustomerOptions();
  renderAutoDesc();
  renderImportFiles();
  renderImportFiles("customer_names");
  renderImportFiles("customer_costs");
  renderImportFiles("incoming_docs");
  renderDashboard();
}

function bindImportControls() {
  const previewButton = document.getElementById("import-preview");
  const runButton = document.getElementById("import-run");
  if (!previewButton || !runButton) return;

  const typeSelect = document.getElementById("import-type");
  const fileInput = document.getElementById("import-file");
  const message = document.getElementById("import-msg");
  const dropZone = document.getElementById("import-dropzone");
  const selectedFileLabel = document.getElementById("import-file-name");
  const previewView = document.getElementById("import-preview-view");

  const updateSelectedFile = () => {
    const file = fileInput.files[0];
    selectedFileLabel.textContent = file ? file.name : "ลากไฟล์ Excel มาวางที่นี่";
    dropZone.classList.toggle("has-file", Boolean(file));
    importRows = [];
    previewView.innerHTML = "";
  };

  fileInput.addEventListener("change", updateSelectedFile);

  dropZone.addEventListener("click", (event) => {
    if (event.target !== fileInput) fileInput.click();
  });
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  dropZone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragover");
  });
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    dropZone.classList.add("is-dragover");
  });
  dropZone.addEventListener("dragleave", (event) => {
    if (!dropZone.contains(event.relatedTarget)) {
      dropZone.classList.remove("is-dragover");
    }
  });
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragover");

    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toastError("รองรับไฟล์ .xlsx, .xls หรือ .csv เท่านั้น");
      return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });

  typeSelect.addEventListener("change", () => {
    const columns = IMPORT_COLUMNS[typeSelect.value];
    message.textContent = columns ? `คอลัมน์ที่ต้องมี: ${columns.join(", ")}` : "";
    importRows = [];
    document.getElementById("import-preview-view").innerHTML = "";
  });

  const readSelectedFile = async () => {
    const file = fileInput.files[0];
    if (!file) {
      toastError("เลือกไฟล์ก่อน");
      return null;
    }
    try {
      importRows = await parseSheet(file);
      return file;
    } catch (error) {
      console.error(error);
      toastError("อ่านไฟล์ไม่สำเร็จ: " + (error.message || error));
      return null;
    }
  };

  previewButton.addEventListener("click", async () => {
    const file = await readSelectedFile();
    if (!file) return;
    renderImportPreview(importRows);
    message.textContent = `อ่านได้ ${fmtInt(importRows.length)} แถว จากไฟล์ ${file.name}`;
  });

  runButton.addEventListener("click", async () => {
    const type = typeSelect.value;
    let file = fileInput.files[0];
    if (!file) {
      file = await readSelectedFile();
      if (!file) return;
    } else if (!importRows.length) {
      file = await readSelectedFile();
      if (!file) return;
    }
    if (!importRows.length) {
      toastError("ไม่มีข้อมูลให้นำเข้า");
      return;
    }

    const previous = JSON.stringify(state);
    const fileId = uid();
    const fileName = file.name || "ไฟล์นำเข้า";
    let added = 0;
    const trackFile = () => {
      if (added > 0) {
        state.importFiles.push({ id: fileId, name: fileName, type, count: added, at: new Date().toISOString() });
      }
    };

    try {
      if (type === "customer_names") {
        added = importCustomerNames(importRows, fileId, fileName);
        trackFile();
      } else if (type === "customer_costs") {
        added = importCustomerCosts(importRows, fileId);
        trackFile();
      } else if (type === "incoming_docs") {
        added = importIncomingDocs(importRows, fileId);
        trackFile();
      } else if (type === "accounts") {
        added = importAccounts(importRows);
      } else if (type === "customers") {
        added = importCustomers(importRows);
      } else if (type === "receivables") {
        added = importReceivables(importRows);
      } else if (type === "journal") {
        added = importJournal(importRows);
      }

      if (!added) {
        state = JSON.parse(previous);
        message.textContent = "ไม่พบข้อมูลที่นำเข้าได้ ตรวจสอบชื่อคอลัมน์อีกครั้ง";
        toastError("ไม่มีแถวที่นำเข้าได้");
        return;
      }

      if (!(await save())) {
        state = JSON.parse(previous);
        message.textContent = "บันทึกไม่สำเร็จ";
        return;
      }

      refreshAllViews();
      message.textContent = `นำเข้าสำเร็จ ${fmtInt(added)} รายการ จากไฟล์ ${fileName}`;
      toastSuccess(`นำเข้าข้อมูลเรียบร้อย ${fmtInt(added)} รายการ`);
      importRows = [];
      fileInput.value = "";
      selectedFileLabel.textContent = "ลากไฟล์ Excel มาวางที่นี่";
      dropZone.classList.remove("has-file");
    } catch (error) {
      console.error(error);
      state = JSON.parse(previous);
      message.textContent = "นำเข้าไม่สำเร็จ: " + (error.message || error);
      toastError("นำเข้าไม่สำเร็จ");
    }
  });

  typeSelect.dispatchEvent(new Event("change"));
}
/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function renderSettings() {
  const settings = state.settings || {};
  document.getElementById("set-company").value = settings.company || "";
  document.getElementById("set-period-start").value = settings.periodStart || "";
  document.getElementById("set-period-end").value = settings.periodEnd || "";
  document.getElementById("set-currency").value = settings.currency || "THB";
  document.getElementById("set-note").value = settings.note || "";
}

function bindSettingsControls() {
  const form = document.getElementById("settings-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const periodStart = document.getElementById("set-period-start").value;
    const periodEnd = document.getElementById("set-period-end").value;
    if (periodStart && periodEnd && periodStart > periodEnd) {
      toastError("วันที่เริ่มต้นงวดต้องไม่มากกว่าวันที่สิ้นสุด");
      return;
    }

    const previous = JSON.stringify(state);
    state.settings = {
      company: document.getElementById("set-company").value.trim(),
      periodStart,
      periodEnd,
      currency: document.getElementById("set-currency").value.trim() || "THB",
      note: document.getElementById("set-note").value.trim(),
    };

    if (!(await save(["settings"]))) {
      state = JSON.parse(previous);
      renderSettings();
      return;
    }
    renderDashboard();
    renderReports();
    toastSuccess("บันทึกการตั้งค่าเรียบร้อย");
  });
}

/* ------------------------------------------------------------------ */
/* Backup and restore                                                 */
/* ------------------------------------------------------------------ */

function bindBackupControls() {
  const exportButton = document.getElementById("backup-export");
  const importInput = document.getElementById("backup-import");
  const message = document.getElementById("backup-msg");
  if (!exportButton || !importInput) return;

  exportButton.addEventListener("click", () => {
    downloadJson(`accounting-backup-${fileStamp()}.json`, {
      exportedAt: new Date().toISOString(),
      version: 1,
      data: state,
    });
    message.textContent = "ดาวน์โหลดไฟล์สำรองข้อมูลเรียบร้อย";
    toastSuccess("สำรองข้อมูลเรียบร้อย");
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    const confirmed = await confirmAction(`กู้คืนข้อมูลจากไฟล์ "${file.name}"? ข้อมูลปัจจุบันจะถูกเขียนทับทั้งหมด`);
    if (!confirmed) {
      importInput.value = "";
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const payload = parsed && parsed.data ? parsed.data : parsed;
      if (!payload || !Array.isArray(payload.accounts)) {
        throw new Error("ไฟล์ไม่ใช่ไฟล์สำรองของระบบนี้");
      }

      state = normalizeState(payload);
      if (!(await save())) {
        message.textContent = "กู้คืนไม่สำเร็จ: บันทึกข้อมูลไม่ผ่าน";
        return;
      }

      renderAccounts();
      renderJournal();
      renderCustomers();
      renderCustomerNames();
      renderCustomerCosts();
      renderIncomingDocs();
      renderReceivables();
      renderCustomerOptions();
      renderJournalCustomerOptions();
      renderAutoDesc();
      renderImportFiles();
      renderImportFiles("customer_names");
      renderImportFiles("customer_costs");
      renderImportFiles("incoming_docs");
      renderDashboard();
      renderSettings();
      message.textContent = `กู้คืนข้อมูลเรียบร้อย (${fmtInt(state.accounts.length)} บัญชี, ${fmtInt(state.entries.length)} รายการ)`;
      toastSuccess("กู้คืนข้อมูลเรียบร้อย");
    } catch (error) {
      console.error(error);
      message.textContent = "กู้คืนไม่สำเร็จ: " + (error.message || error);
      toastError("กู้คืนข้อมูลไม่สำเร็จ");
    } finally {
      importInput.value = "";
    }
  });
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                          */
/* ------------------------------------------------------------------ */

async function init() {
  document.getElementById("je-date").value = todayIso();
  document.getElementById("ar-date").value = todayIso();

  bindJournalFilters();
  bindReportControls();
  bindImportControls();
  bindSettingsControls();
  bindBackupControls();

  resetJournalForm();
  renderSettings();

  await load();

  renderAccounts();
  renderJournal();
  renderLedgerSelect();
  renderJournalCustomerOptions();
  document.getElementById("je-customer").addEventListener("change", (event) => {
    applyAutoDescForCustomer(event.target.value);
  });

  renderCustomers();
  renderCustomerNames();
  renderCustomerCosts();
  renderIncomingDocs();
  renderImportFiles();
  renderImportFiles("customer_names");
  renderImportFiles("customer_costs");
  renderImportFiles("incoming_docs");
  renderCustomerOptions();
  renderReceivables();
  renderAutoDesc();
  renderDashboard();

  let startTab = "dashboard";
  try {
    const saved = localStorage.getItem("active_tab");
    if (saved && document.getElementById(saved)) startTab = saved;
  } catch (error) {
    console.warn("cannot read active tab", error);
  }

  activateTab(startTab);
}

init();

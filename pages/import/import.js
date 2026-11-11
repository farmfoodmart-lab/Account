import {
  AMOUNT_EPSILON,
  esc,
  fmtDateDMY,
  fmtInt,
  load,
  replaceState,
  save,
  state,
  TYPES,
  uid,
} from "../../js/data.js";
import { confirmAction, toastError, toastSuccess } from "../../js/ui.js";
import { toIsoDate } from "../../js/reports.js";
import { renderImportedFiles } from "../imported-files.js";

let importRows = [];
const typeSelect = document.getElementById("import-type");
const fileInput = document.getElementById("import-file");
const dropZone = document.getElementById("import-dropzone");
const selectedFileLabel = document.getElementById("import-file-name");
const message = document.getElementById("import-message");
const previewView = document.getElementById("import-preview-view");

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
        if (!sheet) throw new Error("ไม่พบ worksheet ในไฟล์");
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error || new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsArrayBuffer(file);
  });
}

function renderPreview(rows) {
  if (!rows.length) {
    previewView.innerHTML = '<p class="empty-state">ไม่พบข้อมูลในไฟล์</p>';
    return;
  }
  const keys = Object.keys(rows[0]);
  previewView.innerHTML = `<div class="table-wrap"><table><thead><tr>${keys.map((key) => `<th>${esc(key)}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0, 5).map((row) => `<tr>${keys.map((key) => `<td>${esc(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="muted" style="margin-top:8px">แสดง ${fmtInt(Math.min(5, rows.length))} จาก ${fmtInt(rows.length)} แถว</p>`;
}

function importCustomerNames(rows, fileId) {
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
    if (!code || !name || !TYPES[type] || state.accounts.some((account) => account.code === code)) return;
    state.accounts.push({ id: uid(), code, name, type });
    added += 1;
  });
  state.accounts.sort((leftAccount, rightAccount) => leftAccount.code.localeCompare(rightAccount.code));
  return added;
}

function importCustomers(rows) {
  let added = 0;
  rows.forEach((row) => {
    const code = String(pick(row, ["รหัสลูกค้า", "code", "Code"])).trim();
    const name = String(pick(row, ["ชื่อลูกค้า", "ชื่อ", "name", "Name"])).trim();
    if (!code || !name || state.customers.some((customer) => customer.code === code)) return;
    state.customers.push({
      id: uid(), code, name,
      phone: String(pick(row, ["โทรศัพท์", "phone"])).trim(),
      tax: String(pick(row, ["เลขผู้เสียภาษี", "tax"])).trim(),
      address: String(pick(row, ["ที่อยู่", "address"])).trim(),
    });
    added += 1;
  });
  state.customers.sort((leftCustomer, rightCustomer) => (leftCustomer.code || "").localeCompare(rightCustomer.code || ""));
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
    state.receivables.push({
      id: uid(),
      customerId: customer.id,
      docNo: String(pick(row, ["เลขที่เอกสาร", "docNo", "doc"])).trim() || `IMP-${uid()}`,
      date: toIsoDate(pick(row, ["วันที่", "date"])),
      due: toIsoDate(pick(row, ["ครบกำหนด", "due"])),
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
    const code = String(pick(row, ["รหัสบัญชี", "accountCode", "code"])).trim();
    const account = state.accounts.find((item) => item.code === code);
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
    const debit = group.lines.reduce((total, line) => total + line.debit, 0);
    const credit = group.lines.reduce((total, line) => total + line.credit, 0);
    if (Math.abs(debit - credit) > AMOUNT_EPSILON || debit === 0) return;
    state.entries.push({ id: uid(), ...group });
    added += 1;
  });
  state.entries.sort((earlierEntry, laterEntry) => (earlierEntry.date || "").localeCompare(laterEntry.date || ""));
  return added;
}

function updateSelectedFile() {
  const file = fileInput.files[0];
  selectedFileLabel.textContent = file ? file.name : "ลากไฟล์ Excel มาวางที่นี่";
  dropZone.classList.toggle("has-file", Boolean(file));
  importRows = [];
  previewView.innerHTML = "";
}

async function readSelectedFile() {
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
    toastError(`อ่านไฟล์ไม่สำเร็จ: ${error.message || error}`);
    return null;
  }
}

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
  if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("is-dragover");
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
  previewView.innerHTML = "";
});

document.getElementById("import-preview").addEventListener("click", async () => {
  const file = await readSelectedFile();
  if (!file) return;
  renderPreview(importRows);
  message.textContent = `อ่านได้ ${fmtInt(importRows.length)} แถว จากไฟล์ ${file.name}`;
});

document.getElementById("import-run").addEventListener("click", async () => {
  const type = typeSelect.value;
  let file = fileInput.files[0];
  if (!file || !importRows.length) {
    file = await readSelectedFile();
    if (!file) return;
  }
  if (!importRows.length) {
    toastError("ไม่มีข้อมูลให้นำเข้า");
    return;
  }

  const previous = JSON.parse(JSON.stringify(state));
  const fileId = uid();
  const fileName = file.name || "ไฟล์นำเข้า";
  let added = 0;
  try {
    if (type === "customer_names") added = importCustomerNames(importRows, fileId);
    else if (type === "customer_costs") added = importCustomerCosts(importRows, fileId);
    else if (type === "incoming_docs") added = importIncomingDocs(importRows, fileId);
    else if (type === "accounts") added = importAccounts(importRows);
    else if (type === "customers") added = importCustomers(importRows);
    else if (type === "receivables") added = importReceivables(importRows);
    else if (type === "journal") added = importJournal(importRows);

    if (!added) {
      replaceState(previous);
      message.textContent = "ไม่พบข้อมูลที่นำเข้าได้ ตรวจสอบชื่อคอลัมน์อีกครั้ง";
      toastError("ไม่มีแถวที่นำเข้าได้");
      return;
    }

    if (["customer_names", "customer_costs", "incoming_docs"].includes(type)) {
      state.importFiles.push({ id: fileId, name: fileName, type, count: added, at: new Date().toISOString() });
    }
    if (!(await save())) {
      replaceState(previous);
      message.textContent = "บันทึกไม่สำเร็จ";
      return;
    }
    renderImportedFiles("all-imported-files", undefined, () => {});
    message.textContent = `นำเข้าสำเร็จ ${fmtInt(added)} รายการ จากไฟล์ ${fileName}`;
    toastSuccess(`นำเข้าข้อมูลเรียบร้อย ${fmtInt(added)} รายการ`);
    importRows = [];
    fileInput.value = "";
    updateSelectedFile();
  } catch (error) {
    replaceState(previous);
    console.error(error);
    message.textContent = `นำเข้าไม่สำเร็จ: ${error.message || error}`;
    toastError("นำเข้าไม่สำเร็จ");
  }
});

if (await load()) {
  renderImportedFiles("all-imported-files", undefined, () => {});
  typeSelect.dispatchEvent(new Event("change"));
}

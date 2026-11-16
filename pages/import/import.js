/**
 * @file หน้า "นำเข้าไฟล์ Excel"
 *
 * ขั้นตอน: เลือกประเภทข้อมูล → เลือก/ลากไฟล์ → ดูตัวอย่าง → นำเข้า
 *
 * ตัวแปลงข้อมูล (parser) ของแต่ละประเภทเป็นฟังก์ชันบริสุทธิ์: รับแถวจาก Excel แล้วคืนข้อมูลชุดใหม่
 * โดยไม่แก้ state โดยตรง จากนั้นจึงบันทึกผ่าน commitChanges (ถ้าบันทึกไม่สำเร็จ state เดิมไม่เปลี่ยน)
 *
 * ต้องโหลดไลบรารี SheetJS (ตัวแปร XLSX) ในหน้า HTML ก่อนไฟล์นี้
 */
import { commitChanges, loadData, state } from "../../src/core/store.js";
import { ACCOUNT_TYPE_LABELS, AMOUNT_EPSILON } from "../../src/accounting/constants.js";
import {
  createCustomerCodes,
  createSupplierCodes,
  normalizeSupplierCode,
  parseCustomerOptionValue,
  resolvePartyText,
} from "../../src/accounting/customers.js";
import { createDocumentNumber, isDateLocked } from "../../src/accounting/journal.js";
import { buildCreditSaleWithCostLines } from "../../src/accounting/posting.js";
import { notifyError, notifySuccess } from "../../src/components/notifications.js";
import { renderImportedFileList } from "../../src/components/imported-file-list.js";
import { toIsoDate } from "../../src/utils/date.js";
import { byId } from "../../src/utils/dom.js";
import { escapeHtml, formatDate, formatNumber } from "../../src/utils/format.js";
import { createId } from "../../src/utils/id.js";

const importTypeSelect = byId("import-type");
const fileInput = byId("import-file");
const dropZone = byId("import-dropzone");
const fileNameLabel = byId("import-file-name");
const messageElement = byId("import-message");
const previewContainer = byId("import-preview-view");

/** จำนวนแถวที่แสดงในตัวอย่าง */
const PREVIEW_ROW_LIMIT = 5;

/** แถวที่อ่านได้จากไฟล์ล่าสุด (ล้างเมื่อเปลี่ยนไฟล์หรือประเภท) */
let sheetRows = [];

/* ------------------------------------------------------------------ */
/* ฟังก์ชันช่วยอ่านค่าจากแถว Excel                                        */
/* ------------------------------------------------------------------ */

/**
 * ค่าจากคอลัมน์แรกที่มีข้อมูล (รองรับชื่อคอลัมน์หลายแบบ ทั้งไทยและอังกฤษ)
 * @param {Record<string, unknown>} row
 * @param {string[]} columnNames
 */
function readCell(row, columnNames) {
  for (const columnName of columnNames) {
    if (row[columnName] != null && String(row[columnName]).trim() !== "") return row[columnName];
  }
  return "";
}

const readText = (row, columnNames) => String(readCell(row, columnNames)).trim();

/** อ่านตัวเลข (ตัดจุลภาคคั่นหลักพันออกก่อน) */
function readNumber(row, columnNames) {
  const parsed = parseFloat(String(readCell(row, columnNames)).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ------------------------------------------------------------------ */
/* ตัวแปลงข้อมูลแต่ละประเภท                                               */
/* ทุกตัวคืน { changes, importedCount, skippedLockedCount? }               */
/* ------------------------------------------------------------------ */

/** รายชื่อลูกค้า: ใช้รหัสจากไฟล์ถ้ามี ไม่มีจะสร้างรหัสอัตโนมัติ (C001, C002, ...) */
function parseCustomerNames(rows, fileId) {
  const names = rows.map((row) => ({
    name: readText(row, ["ชื่อลูกค้า", "name", "Name", "customer"]),
    code: readText(row, ["รหัสลูกค้า", "code", "Code"]),
  })).filter((row) => row.name);
  const generatedCodes = createCustomerCodes(names.filter((row) => !row.code).length);
  const newRecords = names.map((row) => ({ code: row.code || generatedCodes.shift(), name: row.name, fileId }));
  return { changes: { customerNames: [...state.customerNames, ...newRecords] }, importedCount: newRecords.length };
}

/**
 * รายชื่อซัพพลายเออร์ → เพิ่มเข้าทะเบียนซัพพลายเออร์ (state.suppliers)
 * - คอลัมน์ "ชื่อซัพพลายเออร์" (จำเป็น), รหัส/ผู้ติดต่อ/โทรศัพท์/เลขผู้เสียภาษี/ที่อยู่ (ว่างได้)
 * - ชื่อที่มีในทะเบียนแล้ว หรือซ้ำกันในไฟล์ → ข้าม
 * - ไม่มีรหัส หรือรหัสซ้ำกับที่มีอยู่ → สร้างรหัสต่อจากรหัสล่าสุด (S001, S002, ...)
 */
function parseSupplierNames(rows, fileId) {
  const toKey = (name) => name.replace(/\s+/g, " ").trim().toLowerCase();
  const knownNames = new Set(state.suppliers.map((supplier) => toKey(supplier.name || "")));
  const usedCodes = new Set([...state.suppliers, ...state.customers, ...state.customerNames].map((record) => record.code).filter(Boolean));
  const newSuppliers = [];
  let skippedDuplicateCount = 0;
  rows.forEach((row) => {
    const name = readText(row, ["ชื่อซัพพลายเออร์", "ซัพพลายเออร์", "ชื่อผู้ขาย", "ชื่อ", "supplier", "Supplier", "name", "Name"])
      .replace(/\s+/g, " ");
    if (!name) return;
    if (knownNames.has(toKey(name))) {
      skippedDuplicateCount += 1;
      return;
    }
    knownNames.add(toKey(name));
    let code = normalizeSupplierCode(readText(row, ["รหัสซัพพลายเออร์", "รหัส", "code", "Code"]));
    if (code && usedCodes.has(code)) code = "";
    if (code) usedCodes.add(code);
    newSuppliers.push({
      id: createId(),
      code,
      name,
      contact: readText(row, ["ผู้ติดต่อ", "contact"]),
      phone: readText(row, ["โทรศัพท์", "phone"]),
      tax: readText(row, ["เลขผู้เสียภาษี", "เลขประจำตัวผู้เสียภาษี", "tax"]),
      address: readText(row, ["ที่อยู่", "address"]),
      fileId,
    });
  });
  // สร้างรหัสให้แถวที่ไม่มีรหัส (นับต่อจากรหัสในทะเบียนและรหัสที่มากับไฟล์)
  const withoutCode = newSuppliers.filter((supplier) => !supplier.code);
  const generatedCodes = createSupplierCodes(withoutCode.length, newSuppliers.filter((supplier) => supplier.code));
  withoutCode.forEach((supplier) => { supplier.code = generatedCodes.shift(); });
  return {
    changes: { suppliers: [...state.suppliers, ...newSuppliers] },
    importedCount: newSuppliers.length,
    skippedDuplicateCount,
  };
}

/**
 * รายชื่อลูกค้าพร้อมต้นทุน: เก็บข้อมูล และลงบัญชีให้ทุกแถว (1 แถว = 1 รายการในสมุดรายวัน)
 *   Dr ลูกหนี้การค้า (ราคาขาย)   Cr รายได้ (ราคาขาย)
 *   Dr ต้นทุนขาย (ราคาทุน)       Cr สินค้าคงเหลือ (ราคาทุน)
 * - ชื่อลูกค้าในไฟล์เป็นคู่ค้าของรายการ (จึงแสดงในทะเบียนลูกหนี้)
 * - ทั้งข้อมูลและรายการบัญชีมี fileId → ลบไฟล์แล้วรายการบัญชีถูกลบตามไปด้วย
 * - แถวที่ไม่มีวันที่ หรืออยู่ในงวดที่ปิดแล้ว: เก็บข้อมูลไว้แต่ไม่ลงบัญชี
 */
function parseCustomerCosts(rows, fileId) {
  const newRecords = rows
    .map((row) => ({
      id: createId(),
      date: formatDate(readCell(row, ["วันที่", "date", "Date"])),
      name: readText(row, ["ชื่อลูกค้า", "name", "Name"]),
      cost: readNumber(row, ["ราคาทุน", "cost", "Cost"]),
      price: readNumber(row, ["ราคาขาย", "price", "Price", "sale"]),
      fileId,
    }))
    .filter((record) => record.name || record.date || record.cost || record.price);

  const newEntries = [];
  const reservedNumbers = new Set();
  let unpostedCount = 0;
  let skippedLockedCount = 0;
  newRecords.forEach((record) => {
    const isoDate = toIsoDate(record.date);
    if (!(record.price > 0 || record.cost > 0)) return; // ไม่มีจำนวนเงิน ไม่ต้องลงบัญชี
    if (!isoDate) {
      unpostedCount += 1;
      return;
    }
    if (isDateLocked(isoDate)) {
      skippedLockedCount += 1;
      return;
    }
    const posting = buildCreditSaleWithCostLines(record);
    if (posting.error) throw new Error(posting.error); // บัญชีไม่ครบ: หยุดทั้งไฟล์ ไม่บันทึกอะไรเลย

    const { customerId, customerName } = parseCustomerOptionValue(resolvePartyText(record.name));
    const entryId = createId();
    newEntries.push({
      id: entryId,
      date: isoDate,
      docNo: createDocumentNumber(state.entries, "JV", isoDate, "", reservedNumbers),
      kind: "general",
      desc: `ขายสินค้าเชื่อ ${record.name}`.trim(),
      lines: posting.lines,
      fileId,
      createdAt: new Date().toISOString(),
      ...(customerId ? { customerId } : {}),
      ...(customerName ? { customerName } : {}),
    });
    record.entryId = entryId; // ใช้ลบรายการบัญชีตามเมื่อผู้ใช้ลบแถวนี้
  });

  const entries = [...state.entries, ...newEntries]
    .sort((leftEntry, rightEntry) => (leftEntry.date || "").localeCompare(rightEntry.date || ""));
  return {
    changes: { customerCosts: [...state.customerCosts, ...newRecords], entries },
    importedCount: newRecords.length,
    postedCount: newEntries.length,
    unpostedCount,
    skippedLockedCount,
  };
}

function parseIncomingDocuments(rows, fileId) {
  const newRecords = rows
    .map((row) => ({
      date: formatDate(readCell(row, ["วันที่", "date", "Date"])),
      docType: readText(row, ["ประเภทเอกสาร", "docType", "type"]),
      supplier: readText(row, ["ซัพพลายเออร์", "supplier", "vendor"]),
      total: readNumber(row, ["ยอดรวม", "total", "amount"]),
      discount: readNumber(row, ["ส่วนลด", "discount"]),
      payment: readText(row, ["รูปแบบการชำระเงิน", "payment"]),
      fileId,
    }))
    .filter((record) => record.date || record.docType || record.supplier || record.total || record.discount || record.payment);
  return { changes: { incomingDocs: [...state.incomingDocs, ...newRecords] }, importedCount: newRecords.length };
}

/** ผังบัญชี: ข้ามรหัสที่มีอยู่แล้ว และประเภทที่ไม่รู้จัก */
function parseAccounts(rows) {
  const existingCodes = new Set(state.accounts.map((account) => account.code));
  const newAccounts = [];
  rows.forEach((row) => {
    const code = readText(row, ["รหัสบัญชี", "code", "Code"]);
    const name = readText(row, ["ชื่อบัญชี", "name", "Name"]);
    const type = readText(row, ["ประเภท", "type", "Type"]).toLowerCase();
    if (!code || !name || !ACCOUNT_TYPE_LABELS[type] || existingCodes.has(code)) return;
    existingCodes.add(code);
    newAccounts.push({ id: createId(), code, name, type });
  });
  const accounts = [...state.accounts, ...newAccounts]
    .sort((leftAccount, rightAccount) => String(leftAccount.code).localeCompare(String(rightAccount.code)));
  return { changes: { accounts }, importedCount: newAccounts.length };
}

/** ทะเบียนลูกค้า: ข้ามรหัสลูกค้าที่มีอยู่แล้ว */
function parseCustomers(rows) {
  const existingCodes = new Set(state.customers.map((customer) => customer.code));
  const newCustomers = [];
  rows.forEach((row) => {
    const code = readText(row, ["รหัสลูกค้า", "code", "Code"]);
    const name = readText(row, ["ชื่อลูกค้า", "ชื่อ", "name", "Name"]);
    if (!code || !name || existingCodes.has(code)) return;
    existingCodes.add(code);
    newCustomers.push({
      id: createId(),
      code,
      name,
      phone: readText(row, ["โทรศัพท์", "phone"]),
      tax: readText(row, ["เลขผู้เสียภาษี", "tax"]),
      address: readText(row, ["ที่อยู่", "address"]),
    });
  });
  const customers = [...state.customers, ...newCustomers]
    .sort((leftCustomer, rightCustomer) => (leftCustomer.code || "").localeCompare(rightCustomer.code || ""));
  return { changes: { customers }, importedCount: newCustomers.length };
}

/** ลูกหนี้: ต้องมีรหัสลูกค้าที่อยู่ในทะเบียน เอกสารที่ไม่มีเลขที่จะได้เลข INV-YYYYMM-#### */
function parseReceivables(rows) {
  const reservedNumbers = new Set();
  const newReceivables = [];
  rows.forEach((row) => {
    const customerCode = readText(row, ["รหัสลูกค้า", "customerCode"]);
    const customer = state.customers.find((item) => item.code === customerCode);
    const amount = readNumber(row, ["จำนวนเงิน", "amount"]);
    if (!customer || amount <= 0) return;

    const date = toIsoDate(readCell(row, ["วันที่", "date"]));
    const documentNumber = readText(row, ["เลขที่เอกสาร", "docNo", "doc"])
      || createDocumentNumber(state.receivables, "INV", date, "", reservedNumbers);
    reservedNumbers.add(documentNumber);
    newReceivables.push({
      id: createId(),
      customerId: customer.id,
      docNo: documentNumber,
      date,
      due: toIsoDate(readCell(row, ["ครบกำหนด", "due"])),
      amount,
      paid: readNumber(row, ["ชำระแล้ว", "paid"]),
      note: readText(row, ["หมายเหตุ", "note"]),
    });
  });
  return { changes: { receivables: [...state.receivables, ...newReceivables] }, importedCount: newReceivables.length };
}

/**
 * รายการบัญชี: แต่ละแถวคือหนึ่งบรรทัด จัดกลุ่มเป็นรายการด้วยคอลัมน์ "อ้างอิง" หรือ "เลขที่เอกสาร"
 * - รายการที่ไม่ดุล มีน้อยกว่า 2 บรรทัด หรืออยู่ในงวดที่ล็อกแล้ว จะถูกข้าม
 * - รายการที่ไม่มีเลขที่เอกสาร (หรือเลขซ้ำ) จะได้เลข JV-YYYYMM-#### อัตโนมัติ
 */
function parseJournalEntries(rows) {
  const entryGroups = new Map();
  rows.forEach((row, rowIndex) => {
    const account = state.accounts.find((item) => item.code === readText(row, ["รหัสบัญชี", "accountCode", "code"]));
    const debit = readNumber(row, ["เดบิต", "debit"]);
    const credit = readNumber(row, ["เครดิต", "credit"]);
    if (!account || (!debit && !credit)) return;

    const date = toIsoDate(readCell(row, ["วันที่", "date"]));
    const desc = readText(row, ["คำอธิบาย", "desc", "description"]);
    const reference = readText(row, ["อ้างอิง", "ref", "group"]);
    const docNo = readText(row, ["เลขที่เอกสาร", "docNo"]);
    // ไม่มีทั้งอ้างอิงและเลขที่ → ถือเป็นรายการเดี่ยวต่อแถว (จะถูกข้ามเพราะมีบรรทัดเดียว)
    const groupKey = reference ? `ref:${reference}` : docNo ? `doc:${docNo}` : `row:${rowIndex}`;
    if (!entryGroups.has(groupKey)) entryGroups.set(groupKey, { date, desc, docNo, lines: [] });
    entryGroups.get(groupKey).lines.push({ accountId: account.id, debit, credit });
  });

  const usedNumbers = new Set(state.entries.map((entry) => entry.docNo).filter(Boolean));
  const newEntries = [];
  let skippedLockedCount = 0;
  entryGroups.forEach((group) => {
    if (group.lines.length < 2) return;
    if (isDateLocked(group.date)) {
      skippedLockedCount += 1;
      return;
    }
    const totalDebit = group.lines.reduce((total, line) => total + line.debit, 0);
    const totalCredit = group.lines.reduce((total, line) => total + line.credit, 0);
    if (totalDebit === 0 || Math.abs(totalDebit - totalCredit) > AMOUNT_EPSILON) return;

    const documentNumber = group.docNo && !usedNumbers.has(group.docNo)
      ? group.docNo
      : createDocumentNumber(state.entries, "JV", group.date, "", usedNumbers);
    usedNumbers.add(documentNumber);
    newEntries.push({ id: createId(), ...group, docNo: documentNumber, kind: "general", createdAt: new Date().toISOString() });
  });

  const entries = [...state.entries, ...newEntries]
    .sort((leftEntry, rightEntry) => (leftEntry.date || "").localeCompare(rightEntry.date || ""));
  return { changes: { entries }, importedCount: newEntries.length, skippedLockedCount };
}

/**
 * ประเภทข้อมูลที่นำเข้าได้ (ค่า key ตรงกับ <option value> ในหน้า HTML)
 * - requiredColumns แสดงเป็นคำแนะนำให้ผู้ใช้
 * - tracksFile = บันทึกชื่อไฟล์ไว้ในรายการ "ไฟล์ที่นำเข้า" เพื่อลบทั้งไฟล์ได้ภายหลัง
 */
const IMPORT_TYPES = {
  customer_names: { requiredColumns: ["ชื่อลูกค้า", "รหัสลูกค้า (ว่างได้ ระบบสร้างให้)"], tracksFile: true, parse: parseCustomerNames },
  supplier_names: { requiredColumns: ["ชื่อซัพพลายเออร์", "รหัสซัพพลายเออร์ (ว่างได้ ระบบสร้างให้)", "ผู้ติดต่อ / โทรศัพท์ / เลขผู้เสียภาษี / ที่อยู่ (ว่างได้)"], tracksFile: true, parse: parseSupplierNames },
  customer_costs: { requiredColumns: ["วันที่", "ชื่อลูกค้า", "ราคาทุน", "ราคาขาย"], tracksFile: true, parse: parseCustomerCosts, postsEntries: true },
  incoming_docs: { requiredColumns: ["วันที่", "ประเภทเอกสาร", "ซัพพลายเออร์", "ยอดรวม", "ส่วนลด", "รูปแบบการชำระเงิน"], tracksFile: true, parse: parseIncomingDocuments },
  accounts: { requiredColumns: ["รหัสบัญชี", "ชื่อบัญชี", "ประเภท (asset/liability/equity/revenue/expense)"], parse: parseAccounts },
  customers: { requiredColumns: ["รหัสลูกค้า", "ชื่อลูกค้า", "โทรศัพท์", "เลขผู้เสียภาษี", "ที่อยู่"], parse: parseCustomers },
  receivables: { requiredColumns: ["รหัสลูกค้า", "เลขที่เอกสาร (ว่างได้ ระบบสร้างให้)", "วันที่", "ครบกำหนด", "จำนวนเงิน", "ชำระแล้ว"], parse: parseReceivables },
  journal: { requiredColumns: ["วันที่", "คำอธิบาย", "รหัสบัญชี", "เดบิต", "เครดิต", "อ้างอิง", "เลขที่เอกสาร (ว่างได้ ระบบสร้างให้)"], parse: parseJournalEntries },
};

/* ------------------------------------------------------------------ */
/* การอ่านไฟล์และแสดงตัวอย่าง                                              */
/* ------------------------------------------------------------------ */

/**
 * อ่าน worksheet แรกของไฟล์ Excel/CSV เป็นอาร์เรย์ของแถว ({ หัวคอลัมน์: ค่า })
 * @param {File} file
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function readSpreadsheet(file) {
  // CSV: อ่านเป็นข้อความ UTF-8 เอง (SheetJS เดารหัสอักขระของ CSV ที่ไม่มี BOM ผิด ทำให้ภาษาไทยเพี้ยน)
  // raw: true = เก็บค่าตามที่เห็นเป็นข้อความ ไม่ให้ SheetJS แปลง "05/11/2026" เป็นวันที่แบบอเมริกา (เดือน/วัน)
  // วันที่จึงถูกตีความแบบไทย (วัน/เดือน/ปี) โดย formatDate/toIsoDate
  const isCsv = /.csv$/i.test(file.name);
  const workbook = isCsv
    ? XLSX.read((await file.text()).replace(/^﻿/, ""), { type: "string", raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("ไม่พบ worksheet ในไฟล์");
  return XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
}

function renderPreview(rows) {
  if (!rows.length) {
    previewContainer.innerHTML = '<p class="empty-state">ไม่พบข้อมูลในไฟล์</p>';
    return;
  }
  const columnNames = Object.keys(rows[0]);
  const headerCells = columnNames.map((columnName) => `<th>${escapeHtml(columnName)}</th>`).join("");
  const bodyRows = rows.slice(0, PREVIEW_ROW_LIMIT)
    .map((row) => `<tr>${columnNames.map((columnName) => `<td>${escapeHtml(row[columnName])}</td>`).join("")}</tr>`)
    .join("");
  previewContainer.innerHTML = `<div class="table-wrap"><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>
    <p class="muted" style="margin-top:8px">แสดง ${formatNumber(Math.min(PREVIEW_ROW_LIMIT, rows.length))} จาก ${formatNumber(rows.length)} แถว</p>`;
}

/** อ่านไฟล์ที่เลือก (ถ้ายังไม่ได้เลือกไฟล์หรืออ่านไม่สำเร็จ คืน null) */
async function loadSelectedFile() {
  const file = fileInput.files[0];
  if (!file) {
    notifyError("เลือกไฟล์ก่อน");
    return null;
  }
  try {
    sheetRows = await readSpreadsheet(file);
    return file;
  } catch (error) {
    console.error(error);
    notifyError(`อ่านไฟล์ไม่สำเร็จ: ${error.message || error}`);
    return null;
  }
}

function handleFileSelected() {
  const file = fileInput.files[0];
  fileNameLabel.textContent = file ? file.name : "ลากไฟล์ Excel มาวางที่นี่";
  dropZone.classList.toggle("has-file", Boolean(file));
  sheetRows = [];
  previewContainer.innerHTML = "";
}

function handleImportTypeChanged() {
  const importType = IMPORT_TYPES[importTypeSelect.value];
  messageElement.textContent = importType ? `คอลัมน์ที่ต้องมี: ${importType.requiredColumns.join(", ")}` : "";
  sheetRows = [];
  previewContainer.innerHTML = "";
}

async function showPreview() {
  const file = await loadSelectedFile();
  if (!file) return;
  renderPreview(sheetRows);
  messageElement.textContent = `อ่านได้ ${formatNumber(sheetRows.length)} แถว จากไฟล์ ${file.name}`;
}

/* ------------------------------------------------------------------ */
/* นำเข้าข้อมูล                                                          */
/* ------------------------------------------------------------------ */

async function runImport() {
  let file = fileInput.files[0];
  if (!file || !sheetRows.length) {
    file = await loadSelectedFile();
    if (!file) return;
  }
  if (!sheetRows.length) {
    notifyError("ไม่มีข้อมูลให้นำเข้า");
    return;
  }

  const importTypeKey = importTypeSelect.value;
  const importType = IMPORT_TYPES[importTypeKey];
  const fileId = createId();
  const fileName = file.name || "ไฟล์นำเข้า";

  try {
    const {
      changes, importedCount, postedCount, unpostedCount = 0, skippedLockedCount = 0, skippedDuplicateCount = 0,
    } = importType.parse(sheetRows, fileId);
    const duplicateText = skippedDuplicateCount ? ` · ข้าม ${formatNumber(skippedDuplicateCount)} ชื่อที่มีอยู่แล้ว` : "";
    if (!importedCount) {
      messageElement.textContent = skippedDuplicateCount
        ? `ไม่มีรายชื่อใหม่ — ทุกชื่อในไฟล์มีอยู่แล้ว${duplicateText}`
        : "ไม่พบข้อมูลที่นำเข้าได้ ตรวจสอบชื่อคอลัมน์อีกครั้ง";
      notifyError("ไม่มีแถวที่นำเข้าได้");
      return;
    }
    if (importType.tracksFile) {
      changes.importFiles = [
        ...state.importFiles,
        { id: fileId, name: fileName, type: importTypeKey, count: importedCount, at: new Date().toISOString() },
      ];
    }

    if (!(await commitChanges(changes))) {
      messageElement.textContent = "บันทึกไม่สำเร็จ";
      return;
    }

    renderImportedFileList("all-imported-files");
    const postedText = importType.postsEntries ? ` · ลงบัญชีในสมุดรายวัน ${formatNumber(postedCount)} รายการ` : "";
    const unpostedText = unpostedCount ? ` · ไม่ได้ลงบัญชี ${formatNumber(unpostedCount)} แถว (ไม่มีวันที่)` : "";
    const skippedText = skippedLockedCount ? ` · ข้ามการลงบัญชี ${formatNumber(skippedLockedCount)} แถวที่อยู่ในงวดที่ปิดแล้ว` : "";
    messageElement.textContent = `นำเข้าสำเร็จ ${formatNumber(importedCount)} รายการ จากไฟล์ ${fileName}${postedText}${unpostedText}${skippedText}${duplicateText}`;
    notifySuccess(`นำเข้าข้อมูลเรียบร้อย ${formatNumber(importedCount)} รายการ`);
    fileInput.value = "";
    handleFileSelected();
  } catch (error) {
    console.error(error);
    messageElement.textContent = `นำเข้าไม่สำเร็จ: ${error.message || error}`;
    notifyError(error.message || String(error), { title: "นำเข้าไม่สำเร็จ" });
  }
}

/* ------------------------------------------------------------------ */
/* การลากไฟล์มาวาง (drag & drop)                                         */
/* ------------------------------------------------------------------ */

function setupDropZone() {
  dropZone.addEventListener("click", (event) => {
    if (event.target !== fileInput) fileInput.click();
  });
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dropZone.classList.add("is-dragover");
  }));
  dropZone.addEventListener("dragleave", (event) => {
    if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("is-dragover");
  });
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragover");
    const droppedFile = event.dataTransfer.files[0];
    if (!droppedFile) return;
    if (!/\.(xlsx|xls|csv)$/i.test(droppedFile.name)) {
      notifyError("รองรับไฟล์ .xlsx, .xls หรือ .csv เท่านั้น");
      return;
    }
    // ใส่ไฟล์ที่ลากมาลงใน <input type=file> เพื่อใช้เส้นทางเดียวกับการเลือกไฟล์ปกติ
    const transfer = new DataTransfer();
    transfer.items.add(droppedFile);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

fileInput.addEventListener("change", handleFileSelected);
importTypeSelect.addEventListener("change", handleImportTypeChanged);
byId("import-preview").addEventListener("click", showPreview);
byId("import-run").addEventListener("click", runImport);
setupDropZone();

// ลิงก์จากหน้าอื่น เช่น import.html?type=supplier_names → เลือกประเภทให้เลย
const requestedType = new URLSearchParams(location.search).get("type");
if (requestedType && IMPORT_TYPES[requestedType]) importTypeSelect.value = requestedType;

if (await loadData()) {
  renderImportedFileList("all-imported-files");
  handleImportTypeChanged();
}

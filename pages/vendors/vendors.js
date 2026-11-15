/**
 * @file หน้า "รายชื่อซัพพลายเออร์" — ภาพรวมผู้ขาย / ซัพพลายเออร์ (ไม่รวมข้อมูลลูกค้า) แก้ไขและลบได้
 *
 * แหล่งข้อมูล:
 * - ซัพพลายเออร์ในทะเบียน (state.suppliers) — เพิ่มจากฟอร์มด้านบน (รวมหน้า "รายชื่อเจ้าหนี้" เดิมไว้ที่นี่แล้ว)
 * - ชื่อผู้ขายที่พิมพ์ในสมุดรายวัน (รายการที่ใช้บัญชีคุมเจ้าหนี้ หรือเลือกประเภท "ซัพพลายเออร์") แต่ยังไม่อยู่ในทะเบียน
 * ยอดค้างชำระคำนวณจากสมุดรายวัน (บัญชีคุมเจ้าหนี้) เหมือนหน้าทะเบียนเจ้าหนี้
 *
 * แก้ไข / ลบ
 * - ในทะเบียน: แก้ข้อมูลในกล่องฟอร์ม, ลบได้เมื่อไม่มีรายการในสมุดรายวันอ้างอิง
 * - ยังไม่ลงทะเบียน: แก้ชื่อ = เปลี่ยนชื่อในทุกรายการของผู้ขายนั้น (และแม่แบบคำอธิบายอัตโนมัติ)
 *   ลบ = เอาชื่อออกจากรายการ — ทำได้เฉพาะเมื่อไม่มีรายการที่ใช้บัญชีเจ้าหนี้การค้า (ต้องมีคู่ค้า)
 */
import { commitChanges, loadData, onDataRefresh, state } from "../../src/core/store.js";
import { findAccountForRole } from "../../src/accounting/accounts.js";
import {
  createSupplierCode,
  formatCustomerLabel,
  isNonPartyName,
  normalizeAllSupplierCodes,
  normalizeSupplierCode,
} from "../../src/accounting/customers.js";
import { getLockedPeriodMessage, isDateLocked } from "../../src/accounting/journal.js";
import { buildSubledger, getPartyKey } from "../../src/accounting/subledger.js";
import { confirmDialog, formDialog } from "../../src/components/dialogs.js";
import { notifyError, notifySuccess } from "../../src/components/notifications.js";
import { buildCsv } from "../../src/utils/csv.js";
import { getFileDateStamp, getTodayIso, toIsoDate } from "../../src/utils/date.js";
import { byId } from "../../src/utils/dom.js";
import { downloadCsv } from "../../src/utils/download.js";
import { escapeHtml, formatDate, formatMoney, formatNumber } from "../../src/utils/format.js";
import { createId } from "../../src/utils/id.js";
import { debounce } from "../../src/utils/timing.js";

const statusSelect = byId("vendors-status");
const searchInput = byId("vendors-search");
const tableBody = document.querySelector("#vendors-table tbody");

/** ทะเบียนเจ้าหนี้จากสมุดรายวัน (ยอดค้างและเอกสารเกินกำหนดรายผู้ขาย) */
function summarizePayables() {
  const today = getTodayIso();
  const byPartyKey = new Map();
  try {
    buildSubledger("payable").documents.forEach((payableDocument) => {
      const summary = byPartyKey.get(payableDocument.partyKey) || { outstanding: 0, overdueCount: 0 };
      summary.outstanding += payableDocument.outstanding;
      if (payableDocument.outstanding > 0.005 && payableDocument.due && payableDocument.due < today) summary.overdueCount += 1;
      byPartyKey.set(payableDocument.partyKey, summary);
    });
  } catch {
    // ยังไม่มีบัญชีคุมเจ้าหนี้ในผังบัญชี
  }
  return byPartyKey;
}

/** รายการนี้ใช้บัญชีคุมเจ้าหนี้การค้าหรือไม่ */
function usesPayableAccount(entry) {
  const payableAccountId = findAccountForRole("payable")?.id || "";
  return Boolean(payableAccountId) && entry.lines.some((line) => line.accountId === payableAccountId);
}

/** รายการนี้เป็นของซัพพลายเออร์หรือไม่ (ในทะเบียน หรือชื่อที่พิมพ์เอง) */
function isSupplierEntry(entry, supplierIds) {
  if (entry.customerId) return supplierIds.has(entry.customerId);
  if (!entry.customerName || entry.itemName) return false;
  if (entry.partyType) return entry.partyType === "supplier";
  return usesPayableAccount(entry);
}

/** รายการในสมุดรายวันของซัพพลายเออร์ที่ยังไม่ลงทะเบียน (ตามชื่อ) */
function getUnregisteredEntries(name) {
  const supplierIds = new Set(state.suppliers.map((supplier) => supplier.id));
  return state.entries.filter((entry) => !entry.customerId && (entry.customerName || "").trim() === name
    && isSupplierEntry(entry, supplierIds));
}

/**
 * รวบรวมซัพพลายเออร์: ในทะเบียน (เรียงตามรหัส) + ชื่อที่ใช้ในสมุดรายวันแต่ยังไม่ลงทะเบียน (เรียงตามชื่อ)
 * @returns {Array<{ isRegistered: boolean, id: string, partyKey: string, code: string, name: string, contact: string,
 *   phone: string, tax: string, creditDays: string | number, entryCount: number, lastDate: string,
 *   outstanding: number, overdueCount: number }>}
 */
function buildVendorRows() {
  const supplierIds = new Set(state.suppliers.map((supplier) => supplier.id));
  const supplierNames = new Set(state.suppliers.map((supplier) => (supplier.name || "").trim()));

  // นับรายการและวันที่ล่าสุดต่อผู้ขาย
  const activity = new Map();
  const unregisteredNames = new Set();
  state.entries.forEach((entry) => {
    if (!isSupplierEntry(entry, supplierIds)) return;
    const partyKey = getPartyKey(entry);
    const record = activity.get(partyKey) || { count: 0, lastDate: "" };
    record.count += 1;
    const isoDate = toIsoDate(entry.date);
    if (isoDate > record.lastDate) record.lastDate = isoDate;
    activity.set(partyKey, record);
    const name = (entry.customerName || "").trim();
    // ชื่อที่ไม่ใช่ผู้ขายจริง (เช่น "เงินสด") ไม่แสดงเป็นซัพพลายเออร์ที่ยังไม่ลงทะเบียน
    if (!entry.customerId && !supplierNames.has(name) && !isNonPartyName(name)) unregisteredNames.add(name);
  });
  const payables = summarizePayables();

  const toRow = (isRegistered, partyKey, details) => {
    const record = activity.get(partyKey) || { count: 0, lastDate: "" };
    const payable = payables.get(partyKey) || { outstanding: 0, overdueCount: 0 };
    return {
      isRegistered,
      id: details.id || "",
      partyKey,
      code: details.code || "",
      name: details.name || "",
      contact: details.contact || "",
      phone: details.phone || "",
      tax: details.tax || "",
      creditDays: details.creditDays ?? "",
      entryCount: record.count,
      lastDate: record.lastDate,
      outstanding: Math.round(payable.outstanding * 100) / 100,
      overdueCount: payable.overdueCount,
    };
  };

  const registeredRows = state.suppliers
    .map((supplier) => toRow(true, getPartyKey({ customerId: supplier.id }), supplier))
    .sort((left, right) => compareCodes(left.code, right.code) || left.name.localeCompare(right.name, "th"));
  const unregisteredRows = [...unregisteredNames]
    .map((name) => toRow(false, getPartyKey({ customerName: name }), { name }))
    .sort((left, right) => left.name.localeCompare(right.name, "th"));
  return [...registeredRows, ...unregisteredRows];
}

/** เปรียบเทียบรหัสแบบตัวเลข (S2 ก่อน S10) ไม่มีรหัสอยู่ท้าย */
function compareCodes(left, right) {
  if (!left || !right) return (left ? 0 : 1) - (right ? 0 : 1);
  return left.localeCompare(right, "th", { numeric: true });
}

function getFilteredRows(allRows) {
  const status = statusSelect.value;
  const searchText = searchInput.value.trim().toLowerCase();
  return allRows.filter((row) => {
    if (status === "registered" && !row.isRegistered) return false;
    if (status === "unregistered" && row.isRegistered) return false;
    if (status === "outstanding" && !row.outstanding) return false;
    if (!searchText) return true;
    return `${row.code} ${row.name} ${row.contact} ${row.tax} ${row.phone}`.toLowerCase().includes(searchText);
  });
}

function renderSummary(allRows) {
  const registeredCount = allRows.filter((row) => row.isRegistered).length;
  const totalOutstanding = allRows.reduce((total, row) => total + row.outstanding, 0);
  const overdueCount = allRows.reduce((total, row) => total + row.overdueCount, 0);
  byId("vendors-summary").innerHTML = `
    <div class="stat"><div class="muted">ซัพพลายเออร์ทั้งหมด</div><div class="stat-value">${formatNumber(allRows.length)}</div><div class="stat-sub">ในทะเบียน ${formatNumber(registeredCount)} · ยังไม่ลงทะเบียน ${formatNumber(allRows.length - registeredCount)}</div></div>
    <div class="stat accent-liability"><div class="muted">ยอดค้างชำระรวม</div><div class="stat-value">${formatMoney(totalOutstanding)}</div><div class="stat-sub"><a href="../payables/payables.html">ดูทะเบียนเจ้าหนี้</a></div></div>
    <div class="stat${overdueCount ? " is-alert" : ""}"><div class="muted">เอกสารเกินกำหนดชำระ</div><div class="stat-value${overdueCount ? " unbalanced" : ""}">${formatNumber(overdueCount)}</div><div class="stat-sub">${overdueCount ? "ควรวางแผนชำระ" : "ไม่มีรายการเกินกำหนด"}</div></div>`;
}

function renderPage() {
  const allRows = buildVendorRows();
  renderSummary(allRows);
  renderCodeBanner();
  const rows = getFilteredRows(allRows);
  byId("vendors-count").textContent = `แสดง ${formatNumber(rows.length)} จาก ${formatNumber(allRows.length)} ราย`;
  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="10" class="muted">${allRows.length ? "ไม่พบซัพพลายเออร์ที่ตรงกับตัวกรอง" : "ยังไม่มีซัพพลายเออร์ — กรอกฟอร์มด้านบนเพื่อเพิ่ม"}</td></tr>`;
    return;
  }
  tableBody.innerHTML = rows.map((row) => {
    const journalLink = `../journal/journal.html?q=${encodeURIComponent(row.name)}`;
    const nameHtml = row.entryCount ? `<a href="${journalLink}" title="ดูรายการในสมุดรายวัน">${escapeHtml(row.name)}</a>` : escapeHtml(row.name);
    const target = row.isRegistered
      ? `data-supplier-id="${escapeHtml(row.id)}"`
      : `data-vendor-name="${escapeHtml(row.name)}"`;
    const action = `${row.isRegistered
      ? ""
      : `<button type="button" class="small secondary" data-action="register" ${target} title="เพิ่มชื่อนี้เข้าทะเบียน">+ ลงทะเบียน</button> `}`
      + `<button type="button" class="small secondary" data-action="edit" ${target}>แก้ไข</button> `
      + `<button type="button" class="small danger" data-action="delete" ${target}>ลบ</button>`;
    return `<tr>
      <td class="code">${row.isRegistered ? escapeHtml(row.code || "-") : '<span class="badge">ยังไม่ลงทะเบียน</span>'}</td>
      <td>${nameHtml}</td>
      <td>${escapeHtml(row.contact)}</td>
      <td>${escapeHtml(row.phone)}</td>
      <td class="code">${escapeHtml(row.tax)}</td>
      <td class="right">${row.creditDays === "" || row.creditDays == null ? '<span class="muted">-</span>' : `${escapeHtml(row.creditDays)} วัน`}</td>
      <td class="right">${row.entryCount ? formatNumber(row.entryCount) : '<span class="muted">-</span>'}</td>
      <td class="nowrap">${row.lastDate ? escapeHtml(formatDate(row.lastDate)) : '<span class="muted">-</span>'}</td>
      <td class="right">${row.outstanding ? `<a href="../payables/payables.html"${row.overdueCount ? ' class="unbalanced" title="มีเอกสารเกินกำหนดชำระ"' : ""}>${formatMoney(row.outstanding)}</a>` : '<span class="muted">-</span>'}</td>
      <td class="actions-cell">${action}</td>
    </tr>`;
  }).join("");
}

function exportCsv() {
  const rows = getFilteredRows(buildVendorRows());
  if (!rows.length) {
    notifyError("ไม่มีข้อมูลให้ส่งออก");
    return;
  }
  const headers = ["สถานะ", "รหัส", "ชื่อ", "ผู้ติดต่อ", "โทรศัพท์", "เลขผู้เสียภาษี", "เครดิตเทอม (วัน)", "จำนวนรายการ", "รายการล่าสุด", "ค้างชำระ"];
  const csvRows = rows.map((row) => [
    row.isRegistered ? "อยู่ในทะเบียน" : "ยังไม่ลงทะเบียน", row.code, row.name, row.contact, row.phone, row.tax, row.creditDays,
    row.entryCount, row.lastDate ? formatDate(row.lastDate) : "", row.outstanding,
  ]);
  downloadCsv(`suppliers-${getFileDateStamp()}.csv`, buildCsv(headers, csvRows));
  notifySuccess("ส่งออกรายชื่อซัพพลายเออร์เรียบร้อย");
}

/* ------------------------------------------------------------------ */
/* ฟอร์มเพิ่มซัพพลายเออร์ + เรียงรหัส S001                                 */
/* ------------------------------------------------------------------ */

const supplierForm = byId("supplier-form");

/** ช่องในฟอร์ม → ชื่อฟิลด์ที่เก็บในฐานข้อมูล */
const SUPPLIER_FIELD_INPUTS = {
  code: "supplier-code",
  name: "supplier-name",
  contact: "supplier-contact",
  phone: "supplier-phone",
  tax: "supplier-tax-id",
  creditDays: "supplier-credit-days",
  address: "supplier-address",
};

function resetSupplierForm() {
  supplierForm.reset();
  byId("supplier-code").value = createSupplierCode(); // แนะนำรหัสถัดไป (แก้เองได้)
}

/**
 * ตรวจและจัดรูปข้อมูลซัพพลายเออร์ (ใช้ทั้งฟอร์มเพิ่มและกล่องแก้ไข)
 * @param {Record<string, unknown>} values
 * @param {string} [ignoreId] id ของซัพพลายเออร์ที่กำลังแก้ไข
 * @returns {{ error: string } | { data: object }}
 */
function readSupplierData(values, ignoreId = "") {
  const data = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value ?? "").trim()]));
  data.code = normalizeSupplierCode(data.code); // พิมพ์ย่อได้ เช่น "7" หรือ "s7" → S007
  if (!data.code || !data.name) return { error: "กรุณาระบุรหัสและชื่อซัพพลายเออร์" };
  data.creditDays = data.creditDays === "" ? "" : Math.max(0, Math.round(Number(data.creditDays) || 0));
  if (state.suppliers.some((supplier) => supplier.code === data.code && supplier.id !== ignoreId)) {
    return { error: `รหัสซัพพลายเออร์ ${data.code} มีอยู่แล้ว` };
  }
  // รหัสซ้ำกับลูกค้าจะทำให้พิมพ์รหัสในช่องคู่ค้าแล้วสับสน
  if ([...(state.customers || []), ...(state.customerNames || [])].some((customer) => customer.code === data.code)) {
    return { error: `รหัส ${data.code} ซ้ำกับรหัสลูกค้า กรุณาใช้รหัสอื่น` };
  }
  return { data };
}

async function handleSupplierSubmit(event) {
  event.preventDefault();
  const values = Object.fromEntries(Object.entries(SUPPLIER_FIELD_INPUTS).map(([field, inputId]) => [field, byId(inputId).value]));
  const result = readSupplierData(values);
  if (result.error) {
    notifyError(result.error);
    return;
  }
  const savePromise = commitChanges({ suppliers: [...state.suppliers, { id: createId(), ...result.data }] });
  resetSupplierForm();
  renderPage();
  notifySuccess(`เพิ่มซัพพลายเออร์ ${formatCustomerLabel(result.data)} แล้ว`);
  if (!(await savePromise)) renderPage();
}

/** "+ ลงทะเบียน" ชื่อจากสมุดรายวัน → ใส่ชื่อในฟอร์มให้กรอกต่อ */
function startRegistering(name) {
  resetSupplierForm();
  byId("supplier-name").value = name;
  supplierForm.scrollIntoView({ behavior: "smooth", block: "start" });
  byId("supplier-contact").focus({ preventScroll: true });
}

/** รหัสข้ามเลข / ซ้ำ / ไม่มีรหัส / ไม่อยู่ในรูปแบบ S001: แสดงปุ่มเรียงรหัสใหม่ให้ทีเดียว */
function renderCodeBanner() {
  const slot = byId("supplier-code-banner-slot");
  const { changedCount } = normalizeAllSupplierCodes();
  if (!changedCount) {
    slot.innerHTML = "";
    return;
  }
  slot.innerHTML = `<div class="banner info">
    <span>รหัสซัพพลายเออร์ยังไม่เรียงต่อเนื่อง (ข้ามเลข / ซ้ำ / ไม่มีรหัส / ไม่อยู่ในรูปแบบ S001) — ต้องปรับ <strong>${formatNumber(changedCount)}</strong> ราย</span>
    <button type="button" class="small" id="supplier-code-fill" style="margin-left:auto">เรียงรหัสใหม่ S001, S002, ...</button>
  </div>`;
  byId("supplier-code-fill").addEventListener("click", renumberSupplierCodes);
}

async function renumberSupplierCodes() {
  const { suppliers, changedCount } = normalizeAllSupplierCodes();
  if (!changedCount) return;
  const confirmed = await confirmDialog(
    `เรียงรหัสซัพพลายเออร์ใหม่เป็น S001, S002, ... ต่อเนื่องไม่ข้ามเลข? (เปลี่ยน ${formatNumber(changedCount)} ราย)\n`
    + "• ลำดับยึดตามเลขรหัสเดิม เช่น S001, S003, S007 → S001, S002, S003\n"
    + "• ไม่มีรหัส / รหัสรูปแบบอื่น → ต่อท้ายลำดับ\n"
    + "• รายการในสมุดรายวันไม่ได้รับผลกระทบ (อ้างอิงซัพพลายเออร์ด้วย id ไม่ใช่รหัส)",
  );
  if (!confirmed) return;
  const savePromise = commitChanges({ suppliers });
  resetSupplierForm(); // รหัสแนะนำในฟอร์มเปลี่ยนตาม
  renderPage();
  if (await savePromise) notifySuccess(`เรียงรหัสซัพพลายเออร์ใหม่เรียบร้อย (เปลี่ยน ${formatNumber(changedCount)} ราย)`);
  else renderPage();
}

/* ------------------------------------------------------------------ */
/* แก้ไข / ลบ                                                           */
/* ------------------------------------------------------------------ */

/** แก้ไขซัพพลายเออร์ในทะเบียน */
async function editRegisteredSupplier(supplierId) {
  const supplier = state.suppliers.find((item) => item.id === supplierId);
  if (!supplier) return;
  const values = await formDialog({
    title: `แก้ไขซัพพลายเออร์ ${supplier.code || ""}`.trim(),
    icon: "✎",
    fields: [
      { name: "code", label: "รหัสเจ้าหนี้", value: supplier.code || "", required: true },
      { name: "name", label: "ชื่อเจ้าหนี้ / บริษัท", value: supplier.name || "", required: true },
      { name: "contact", label: "ผู้ติดต่อ", value: supplier.contact || "" },
      { name: "phone", label: "โทรศัพท์", value: supplier.phone || "" },
      { name: "tax", label: "เลขประจำตัวผู้เสียภาษี", value: supplier.tax || "" },
      { name: "creditDays", label: "เครดิตเทอม (วัน)", type: "number", min: 0, step: 1, value: supplier.creditDays ?? "" },
      { name: "address", label: "ที่อยู่", value: supplier.address || "" },
    ],
  });
  if (!values) return;

  const result = readSupplierData(values, supplierId);
  if (result.error) {
    notifyError(result.error);
    return;
  }
  const supplierData = result.data;
  const suppliers = state.suppliers.map((item) => (item.id === supplierId ? { ...item, ...supplierData } : item));
  const savePromise = commitChanges({ suppliers });
  renderPage();
  if (await savePromise) notifySuccess(`แก้ไขซัพพลายเออร์ ${supplierData.code} - ${supplierData.name} แล้ว`);
  else renderPage();
}

/** ลบซัพพลายเออร์ในทะเบียน (ห้ามลบเมื่อมีรายการในสมุดรายวันอ้างอิง) */
async function deleteRegisteredSupplier(supplierId) {
  const supplier = state.suppliers.find((item) => item.id === supplierId);
  if (!supplier) return;
  const entryCount = state.entries.filter((entry) => entry.customerId === supplierId).length;
  if (entryCount) {
    notifyError(`ซัพพลายเออร์รายนี้มีรายการในสมุดรายวันอ้างอิงอยู่ ${formatNumber(entryCount)} รายการ ลบไม่ได้`);
    return;
  }
  if (!(await confirmDialog(`ยืนยันการลบซัพพลายเออร์ ${supplier.code || ""} ${supplier.name || ""}?`.replace(/\s+/g, " ")))) return;
  // แม่แบบคำอธิบายอัตโนมัติของซัพพลายเออร์นี้จะใช้ไม่ได้แล้ว → ลบไปด้วย
  const autoDesc = state.autoDesc.filter((rule) => rule.customerId !== supplierId);
  const changes = { suppliers: state.suppliers.filter((item) => item.id !== supplierId) };
  if (autoDesc.length !== state.autoDesc.length) changes.autoDesc = autoDesc;
  const savePromise = commitChanges(changes);
  renderPage();
  if (await savePromise) notifySuccess("ลบซัพพลายเออร์เรียบร้อย");
  else renderPage();
}

/** แม่แบบคำอธิบายอัตโนมัติที่ใช้ชื่อผู้ขาย (ไม่มีในทะเบียน) นี้ */
function isRuleForName(rule, name) {
  return !rule.customerId && !rule.itemName && (rule.customerName || "").trim() === name;
}

/** แก้ชื่อซัพพลายเออร์ที่ยังไม่ลงทะเบียน → เปลี่ยนชื่อในทุกรายการของผู้ขายนั้น */
async function renameUnregisteredSupplier(name) {
  const linkedEntries = getUnregisteredEntries(name);
  if (linkedEntries.some((entry) => isDateLocked(entry.date))) {
    notifyError(`มีรายการของ “${name}” อยู่ในงวดที่ปิดแล้ว จึงแก้ชื่อไม่ได้ — ${getLockedPeriodMessage()}`);
    return;
  }
  const values = await formDialog({
    title: "แก้ไขชื่อซัพพลายเออร์",
    message: `ชื่อนี้ยังไม่อยู่ในทะเบียน — ชื่อใหม่จะถูกเปลี่ยนในรายการสมุดรายวัน ${formatNumber(linkedEntries.length)} รายการ`,
    icon: "✎",
    fields: [{ name: "name", label: "ชื่อซัพพลายเออร์", value: name, required: true }],
  });
  if (!values) return;
  const newName = String(values.name).trim();
  if (!newName || newName === name) return;

  const linkedIds = new Set(linkedEntries.map((entry) => entry.id));
  const now = new Date().toISOString();
  const entries = state.entries.map((entry) => (linkedIds.has(entry.id)
    ? { ...entry, customerName: newName, updatedAt: now }
    : entry));
  const autoDesc = state.autoDesc.map((rule) => (isRuleForName(rule, name) ? { ...rule, customerName: newName } : rule));
  const savePromise = commitChanges({ entries, autoDesc });
  renderPage();
  if (await savePromise) notifySuccess(`เปลี่ยนชื่อ “${name}” เป็น “${newName}” แล้ว (${formatNumber(linkedEntries.length)} รายการ)`);
  else renderPage();
}

/**
 * ลบซัพพลายเออร์ที่ยังไม่ลงทะเบียน = เอาชื่อออกจากรายการในสมุดรายวัน
 * รายการที่ใช้บัญชีเจ้าหนี้การค้าต้องมีคู่ค้า จึงลบไม่ได้ (ให้แก้ชื่อหรือลงทะเบียนแทน)
 */
async function deleteUnregisteredSupplier(name) {
  const linkedEntries = getUnregisteredEntries(name);
  const controlAccountIds = ["payable", "receivable"].map((role) => findAccountForRole(role)?.id).filter(Boolean);
  const payableCount = linkedEntries
    .filter((entry) => entry.lines.some((line) => controlAccountIds.includes(line.accountId))).length;
  if (payableCount) {
    notifyError(`“${name}” ใช้กับบัญชีเจ้าหนี้/ลูกหนี้การค้า ${formatNumber(payableCount)} รายการ ซึ่งต้องระบุคู่ค้า จึงลบไม่ได้ — แก้ชื่อ หรือกด “+ ลงทะเบียน” แทน`);
    return;
  }
  if (linkedEntries.some((entry) => isDateLocked(entry.date))) {
    notifyError(`มีรายการของ “${name}” อยู่ในงวดที่ปิดแล้ว จึงลบไม่ได้ — ${getLockedPeriodMessage()}`);
    return;
  }
  const ruleCount = state.autoDesc.filter((rule) => isRuleForName(rule, name)).length;
  const confirmed = await confirmDialog(
    `ลบ “${name}” ออกจากรายชื่อซัพพลายเออร์?\n`
    + `• ชื่อนี้จะถูกเอาออกจากรายการในสมุดรายวัน ${formatNumber(linkedEntries.length)} รายการ (ตัวรายการและจำนวนเงินยังอยู่)`
    + (ruleCount ? `\n• แม่แบบคำอธิบายอัตโนมัติของชื่อนี้ ${formatNumber(ruleCount)} แม่แบบจะถูกลบด้วย` : ""),
  );
  if (!confirmed) return;

  const linkedIds = new Set(linkedEntries.map((entry) => entry.id));
  const now = new Date().toISOString();
  const entries = state.entries.map((entry) => {
    if (!linkedIds.has(entry.id)) return entry;
    const { customerName: _name, partyType: _partyType, ...rest } = entry;
    return { ...rest, updatedAt: now };
  });
  const autoDesc = state.autoDesc.filter((rule) => !isRuleForName(rule, name));
  const savePromise = commitChanges({ entries, autoDesc });
  renderPage();
  if (await savePromise) notifySuccess(`ลบ “${name}” ออกจากรายชื่อซัพพลายเออร์แล้ว`);
  else renderPage();
}

tableBody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const isEdit = button.dataset.action === "edit";
  if (button.dataset.action === "register") {
    startRegistering(button.dataset.vendorName || "");
  } else if (button.dataset.supplierId) {
    if (isEdit) editRegisteredSupplier(button.dataset.supplierId);
    else deleteRegisteredSupplier(button.dataset.supplierId);
  } else if (button.dataset.vendorName != null) {
    if (isEdit) renameUnregisteredSupplier(button.dataset.vendorName);
    else deleteUnregisteredSupplier(button.dataset.vendorName);
  }
});
statusSelect.addEventListener("change", renderPage);
searchInput.addEventListener("input", debounce(renderPage, 200));
byId("vendors-export").addEventListener("click", exportCsv);

supplierForm.addEventListener("submit", handleSupplierSubmit);
// ปุ่ม "ล้าง" (type=reset) ล้างทุกช่อง → ใส่รหัสแนะนำกลับหลังเบราว์เซอร์ล้างเสร็จ
supplierForm.addEventListener("reset", () => setTimeout(() => {
  byId("supplier-code").value = createSupplierCode();
}));

if (await loadData(["suppliers", "customers", "customerNames", "entries", "accounts", "autoDesc"])) {
  resetSupplierForm();
  // ลิงก์เดิม suppliers.html?name=... (ถูกส่งต่อมาหน้านี้) → ใส่ชื่อให้ลงทะเบียน
  const requestedName = new URLSearchParams(location.search).get("name");
  if (requestedName) startRegistering(requestedName);
  renderPage();
  onDataRefresh(renderPage);
}

/**
 * @file หน้า "รายชื่อลูกค้า"
 *
 * แสดงลูกค้าทุกคนในตารางเดียว และเพิ่ม/แก้ไขผ่านฟอร์ม "เพิ่ม / แก้ไขลูกค้า" ด้านบนเท่านั้น
 * ข้อมูลมาจาก 2 แหล่ง (ชื่อชุดข้อมูลในฐานข้อมูลคงเดิม):
 * 1. รายชื่อลูกค้า (state.customerNames) — นำเข้าจากไฟล์ Excel หรือเพิ่มจากฟอร์มนี้ (ลูกค้าใหม่เก็บที่นี่)
 * 2. ทะเบียนลูกค้าเดิม (state.customers) — ข้อมูลที่เคยเพิ่มไว้ก่อน ยังแสดงและแก้ไขได้
 *    (รายการบัญชีอ้างอิงด้วย customerId จึงต้องเก็บไว้ ไม่ย้ายไปชุดอื่น)
 */
import { commitChanges, loadData, onDataRefresh, state } from "../../src/core/store.js";
import { createCustomerCodes, normalizeAllCustomerCodes, normalizeCustomerCode } from "../../src/accounting/customers.js";
import { notifyError, notifySuccess, notify } from "../../src/components/notifications.js";
import { confirmDialog } from "../../src/components/dialogs.js";
import { renderImportedFileList } from "../../src/components/imported-file-list.js";
import { byId } from "../../src/utils/dom.js";
import { escapeHtml } from "../../src/utils/format.js";
import { watchDocumentNumbers } from "../../src/components/document-number-alert.js";

const customerForm = byId("customer-form");
const formTitle = byId("customer-form-title");
const submitButton = byId("customer-submit");
const cancelButton = byId("customer-cancel");
const tableBody = document.querySelector("#customer-list-table tbody");

/** ช่องในฟอร์ม → ชื่อฟิลด์ที่เก็บในฐานข้อมูล */
const CUSTOMER_FIELD_INPUTS = {
  code: "customer-code",
  name: "customer-name",
  phone: "customer-phone",
  tax: "customer-tax-id",
  address: "customer-address",
};

/**
 * รายการที่กำลังแก้ไข (null = เพิ่มใหม่)
 * - { source: "registry", id }  = ลูกค้าในทะเบียนเดิม
 * - { source: "list", index }   = รายชื่อลูกค้า (ไม่มี id จึงอ้างด้วยลำดับ)
 * @type {{ source: "registry", id: string } | { source: "list", index: number } | null}
 */
let editingTarget = null;

/* ------------------------------------------------------------------ */
/* ฟอร์ม                                                                */
/* ------------------------------------------------------------------ */

function resetForm() {
  editingTarget = null;
  customerForm.reset();
  // แนะนำรหัสลูกค้าถัดไปให้ (แก้เองได้)
  byId("customer-code").value = createCustomerCodes()[0];
  formTitle.textContent = "เพิ่ม / แก้ไขลูกค้า";
  submitButton.textContent = "เพิ่มลูกค้า";
  cancelButton.hidden = true;
}

/** นำข้อมูลลูกค้าขึ้นฟอร์มเพื่อแก้ไข */
function startEditing(target, record) {
  editingTarget = target;
  Object.entries(CUSTOMER_FIELD_INPUTS).forEach(([field, inputId]) => {
    byId(inputId).value = record[field] || "";
  });
  formTitle.textContent = `แก้ไขลูกค้า ${record.code || record.name || ""}`.trim();
  submitButton.textContent = "บันทึกการแก้ไข";
  cancelButton.hidden = false;
  customerForm.scrollIntoView({ behavior: "smooth", block: "start" });
  byId("customer-name").focus();
}

/** รหัสนี้ถูกใช้แล้วหรือยัง (ไม่นับรายการที่กำลังแก้ไข) */
function isCodeTaken(code) {
  const isSelf = (source, key) => editingTarget && editingTarget.source === source
    && (source === "registry" ? editingTarget.id === key : editingTarget.index === key);
  return state.customers.some((customer) => customer.code === code && !isSelf("registry", customer.id))
    || state.customerNames.some((record, index) => record.code === code && !isSelf("list", index));
}

async function handleSubmit(event) {
  event.preventDefault();
  const customerData = Object.fromEntries(
    Object.entries(CUSTOMER_FIELD_INPUTS).map(([field, inputId]) => [field, byId(inputId).value.trim()]),
  );
  // พิมพ์รหัสแบบย่อได้ เช่น "7" หรือ "c7" → C007
  customerData.code = normalizeCustomerCode(customerData.code);
  if (!customerData.code || !customerData.name) return;
  if (isCodeTaken(customerData.code)) {
    notifyError(`รหัสลูกค้า ${customerData.code} มีอยู่แล้ว`);
    return;
  }

  const target = editingTarget;
  let changes;
  if (target && target.source === "registry") {
    changes = { customers: state.customers.map((customer) => (customer.id === target.id ? { ...customer, ...customerData } : customer)) };
  } else if (target && target.source === "list" && state.customerNames[target.index]) {
    changes = { customerNames: state.customerNames.map((record, index) => (index === target.index ? { ...record, ...customerData } : record)) };
  } else {
    // ลูกค้าใหม่ → เก็บในรายชื่อลูกค้า (fileId: null = เพิ่มเอง ไม่ได้มาจากไฟล์)
    changes = { customerNames: [...state.customerNames, { ...customerData, fileId: null }] };
  }

  // บันทึกแบบทันที: วาดตารางและล้างฟอร์มก่อน แล้วส่งขึ้นเซิร์ฟเวอร์เบื้องหลัง
  const savePromise = commitChanges(changes);
  resetForm();
  renderTable();
  notifySuccess(`${target ? "แก้ไข" : "เพิ่ม"}ลูกค้า ${customerData.code} - ${customerData.name} แล้ว`);
  if (!(await savePromise)) renderTable();
}

/* ------------------------------------------------------------------ */
/* ตารางรายชื่อลูกค้า                                                     */
/* ------------------------------------------------------------------ */

function renderRow(record, attributes) {
  return `<tr>
    <td class="code">${escapeHtml(record.code || "-")}</td>
    <td>${escapeHtml(record.name || "")}</td>
    <td>${escapeHtml(record.phone || "")}</td>
    <td class="code">${escapeHtml(record.tax || "")}</td>
    <td>${escapeHtml(record.address || "")}</td>
    <td class="actions-cell">
      <button type="button" class="small secondary" data-action="edit" ${attributes}>แก้ไข</button>
      <button type="button" class="small danger" data-action="delete" ${attributes}>ลบ</button>
    </td>
  </tr>`;
}

function renderTable() {
  const registryRows = state.customers.map((customer) => ({
    code: customer.code, html: renderRow(customer, `data-registry-id="${escapeHtml(customer.id)}"`),
  }));
  const listRows = state.customerNames.map((record, index) => ({
    code: record.code, html: renderRow(record, `data-list-index="${index}"`),
  }));
  // แสดงเรียงตามรหัส (C001, C002, ...) ไม่มีรหัสอยู่ท้ายสุด — ลำดับในฐานข้อมูลไม่เปลี่ยน
  const rows = [...registryRows, ...listRows]
    .map((row, index) => ({ ...row, index }))
    .sort((left, right) => compareCodes(left.code, right.code) || left.index - right.index)
    .map((row) => row.html);
  tableBody.innerHTML = rows.length
    ? rows.join("")
    : '<tr><td colspan="6" class="muted">ยังไม่มีลูกค้า — กรอกฟอร์มด้านบน หรือนำเข้าไฟล์รายชื่อลูกค้า</td></tr>';
  renderMissingCodeBanner();
}

/** เปรียบเทียบรหัสแบบตัวเลข (C2 ก่อน C10) ช่องว่างอยู่ท้าย */
function compareCodes(left, right) {
  if (!left || !right) return (left ? 0 : 1) - (right ? 0 : 1);
  return left.localeCompare(right, "th", { numeric: true });
}

/** รหัสข้ามเลข / ซ้ำ / ไม่มีรหัส / ไม่อยู่ในรูปแบบ C001: แสดงปุ่มเรียงรหัสใหม่ให้ทีเดียว */
function renderMissingCodeBanner() {
  const slot = byId("customer-code-banner-slot");
  const { changedCount } = normalizeAllCustomerCodes();
  if (!changedCount) {
    slot.innerHTML = "";
    return;
  }
  slot.innerHTML = `<div class="banner info">
    <span>รหัสลูกค้ายังไม่เรียงต่อเนื่อง (ข้ามเลข / ซ้ำ / ไม่มีรหัส / ไม่อยู่ในรูปแบบ C001) — ต้องปรับ <strong>${changedCount.toLocaleString("th-TH")}</strong> รายชื่อ</span>
    <button type="button" class="small" id="customer-code-fill" style="margin-left:auto">เรียงรหัสใหม่ C001, C002, ...</button>
  </div>`;
  byId("customer-code-fill").addEventListener("click", normalizeCustomerCodes);
}

async function normalizeCustomerCodes() {
  const { customers, customerNames, changedCount } = normalizeAllCustomerCodes();
  if (!changedCount) return;
  const confirmed = await confirmDialog(
    `เรียงรหัสลูกค้าใหม่เป็น C001, C002, ... ต่อเนื่องไม่ข้ามเลข? (เปลี่ยน ${changedCount.toLocaleString("th-TH")} รายชื่อ)\n`
    + "• ลำดับยึดตามเลขรหัสเดิม เช่น C001, C003, C007 → C001, C002, C003\n"
    + "• ไม่มีรหัส / รหัสรูปแบบอื่น → ต่อท้ายลำดับ\n"
    + "• รายการในสมุดรายวันไม่ได้รับผลกระทบ (อ้างอิงลูกค้าด้วย id ไม่ใช่รหัส)",
  );
  if (!confirmed) return;
  const savePromise = commitChanges({ customers, customerNames });
  if (!editingTarget) resetForm(); // รหัสแนะนำในฟอร์มเปลี่ยนตาม
  renderTable();
  if (await savePromise) notifySuccess(`เรียงรหัสลูกค้าใหม่เรียบร้อย (เปลี่ยน ${changedCount.toLocaleString("th-TH")} รายชื่อ)`);
  else renderTable();
}

async function deleteRegistryCustomer(customerId) {
  // ลูกค้าที่ถูกอ้างอิงในสมุดรายวันห้ามลบ (ไม่เช่นนั้นทะเบียนลูกหนี้จะหาชื่อไม่เจอ)
  if (state.entries.some((entry) => entry.customerId === customerId)) {
    notifyError("ลูกค้ารายนี้มีรายการในสมุดรายวันอ้างอิงอยู่ ลบไม่ได้");
    return;
  }
  if (!(await confirmDialog("ยืนยันการลบลูกค้านี้?"))) return;
  const savePromise = commitChanges({ customers: state.customers.filter((customer) => customer.id !== customerId) });
  if (editingTarget && editingTarget.source === "registry" && editingTarget.id === customerId) resetForm();
  renderTable();
  if (await savePromise) notifySuccess("ลบลูกค้าเรียบร้อย");
  else renderTable();
}

async function deleteListCustomer(listIndex) {
  if (!(await confirmDialog("ยืนยันการลบรายชื่อลูกค้านี้?"))) return;
  const savePromise = commitChanges({ customerNames: state.customerNames.filter((_, index) => index !== listIndex) });
  // ลำดับของรายการหลังตัวที่ลบจะเลื่อนขึ้นหนึ่งตำแหน่ง
  if (editingTarget && editingTarget.source === "list") {
    if (editingTarget.index === listIndex) resetForm();
    else if (editingTarget.index > listIndex) editingTarget.index -= 1;
  }
  renderTable();
  if (await savePromise) notifySuccess("ลบรายชื่อลูกค้าเรียบร้อย");
  else renderTable();
}

/* ------------------------------------------------------------------ */
/* ผูกอีเวนต์                                                           */
/* ------------------------------------------------------------------ */

tableBody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const isEdit = button.dataset.action === "edit";
  if (button.dataset.registryId) {
    const customerId = button.dataset.registryId;
    const customer = state.customers.find((item) => item.id === customerId);
    if (!customer) return;
    if (isEdit) startEditing({ source: "registry", id: customerId }, customer);
    else deleteRegistryCustomer(customerId);
  } else if (button.dataset.listIndex != null) {
    const listIndex = Number(button.dataset.listIndex);
    const record = state.customerNames[listIndex];
    if (!record) return;
    if (isEdit) startEditing({ source: "list", index: listIndex }, record);
    else deleteListCustomer(listIndex);
  }
});

cancelButton.addEventListener("click", () => {
  resetForm();
  notify("ยกเลิกการแก้ไขแล้ว");
});
customerForm.addEventListener("submit", handleSubmit);

function renderPage() {
  renderTable();
  renderImportedFileList("customer-name-import-files", "customer_names", renderTable);
}

if (await loadData(["customers", "entries", "customerNames"])) {
  watchDocumentNumbers();
  resetForm();
  renderPage();
  onDataRefresh(renderPage);
}

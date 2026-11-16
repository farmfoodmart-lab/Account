/**
 * @file หน้า "การตั้งค่า"
 *
 * - ข้อมูลกิจการ งวดบัญชี และอัตรา VAT เริ่มต้น
 * - บัญชีที่ใช้ลงบัญชีอัตโนมัติ (ลูกหนี้ เจ้าหนี้ ภาษี กำไรสะสม)
 * - ปิดงวดบัญชี (สร้างรายการปิดบัญชี) และล็อกงวด
 * - สำรอง/กู้คืนข้อมูลเป็นไฟล์ JSON
 */
import {
  DATA_COLLECTIONS,
  commitChanges,
  createDefaultState,
  loadData,
  onDataRefresh,
  state,
} from "../../src/core/store.js";
import { authReady } from "../../src/core/auth.js";
import { ACCOUNT_ROLES } from "../../src/accounting/constants.js";
import { findAccountForRole, formatAccountLabel, renderAccountOptions } from "../../src/accounting/accounts.js";
import { buildClosingLines, calculateClosingBalances } from "../../src/accounting/closing.js";
import { isDateLocked } from "../../src/accounting/journal.js";
import { PAYMENT_METHODS, THAI_BANKS, getDefaultSupplierPayment } from "../../src/accounting/payment-methods.js";
import { sortEntriesByDate, upsertJournalEntry } from "../../src/accounting/posting.js";
import { DEFAULT_CREDIT_DAYS } from "../../src/accounting/subledger.js";
import { notifyError, notifySuccess } from "../../src/components/notifications.js";
import { confirmDialog } from "../../src/components/dialogs.js";
import { getFileDateStamp } from "../../src/utils/date.js";
import { byId } from "../../src/utils/dom.js";
import { downloadJson } from "../../src/utils/download.js";
import { escapeHtml, formatDate, formatMoney, formatNumber } from "../../src/utils/format.js";

const settingsForm = byId("settings-form");
const supplierPaymentSelect = byId("settings-supplier-payment-method");
const supplierBankSelect = byId("settings-supplier-bank-name");

/** ค่าเริ่มต้นช่องทางชำระเงินของซัพพลายเออร์ใหม่ */
function renderSupplierPaymentFields() {
  const { paymentMethod, bankName } = getDefaultSupplierPayment(state.settings);
  supplierPaymentSelect.innerHTML = PAYMENT_METHODS
    .map((method) => `<option value="${method.value}">${escapeHtml(method.label)}</option>`).join("");
  const banks = bankName && !THAI_BANKS.includes(bankName) ? [...THAI_BANKS, bankName] : THAI_BANKS;
  supplierBankSelect.innerHTML = '<option value="">— เลือกธนาคาร —</option>'
    + banks.map((bank) => `<option value="${escapeHtml(bank)}">${escapeHtml(bank)}</option>`).join("");
  supplierPaymentSelect.value = paymentMethod;
  supplierBankSelect.value = bankName;
}
// เลือกธนาคาร → ช่องทางเป็น "โอนเข้าบัญชีธนาคาร" อัตโนมัติ
supplierBankSelect.addEventListener("change", () => {
  if (supplierBankSelect.value) supplierPaymentSelect.value = "transfer";
});
const closingDateInput = byId("close-date");
const backupMessage = byId("backup-msg");
const backupFileInput = byId("backup-import");

/** เวอร์ชันของรูปแบบไฟล์สำรองข้อมูล */
const BACKUP_FORMAT_VERSION = 2;

/* ------------------------------------------------------------------ */
/* การแสดงผล                                                            */
/* ------------------------------------------------------------------ */

/** ช่องเลือกบัญชีของแต่ละบทบาท พร้อมบอกบัญชีที่ระบบจะเลือกให้ถ้าเว้นว่าง */
function renderAccountRoleFields() {
  const configuredAccounts = state.settings.accountMap || {};
  byId("settings-account-map").innerHTML = Object.entries(ACCOUNT_ROLES).map(([role, roleConfig]) => {
    const resolvedAccount = findAccountForRole(role);
    let hint = "";
    if (!configuredAccounts[role]) hint = resolvedAccount ? `อัตโนมัติ: ${formatAccountLabel(resolvedAccount)}` : "ไม่พบบัญชีที่เหมาะสม";
    return `<label class="field">
      <span>${roleConfig.label}</span>
      <select data-role="${role}">${renderAccountOptions(configuredAccounts[role] || "", "— เลือกอัตโนมัติ —")}</select>
      <span class="hint-text">${hint}</span>
    </label>`;
  }).join("");
}

function renderLockStatus() {
  const lockDate = state.settings.lockDate;
  byId("lock-status").innerHTML = lockDate
    ? `<span class="badge warning dot">ล็อกถึง ${formatDate(lockDate)}</span>`
    : '<span class="badge">ยังไม่ล็อกงวด</span>';
  byId("lock-date").value = lockDate || "";
}

/** ตัวอย่างยอดที่จะปิด เมื่อเลือกวันที่ปิดบัญชี */
function renderClosingPreview() {
  const previewElement = byId("close-preview");
  const closingDate = closingDateInput.value;
  if (!closingDate) {
    previewElement.textContent = "เลือกวันที่สิ้นงวดเพื่อดูยอดที่จะปิด";
    return;
  }
  const { balances, netProfit } = calculateClosingBalances(state.accounts, state.entries, closingDate);
  if (!balances.length) {
    previewElement.textContent = "ไม่มียอดรายได้/ค่าใช้จ่ายคงค้างให้ปิด (อาจปิดบัญชีไปแล้ว)";
    return;
  }
  const retainedEarningsAccount = findAccountForRole("retained");
  const destination = retainedEarningsAccount
    ? formatAccountLabel(retainedEarningsAccount)
    : '<span class="unbalanced">ยังไม่มีบัญชีกำไรสะสม</span>';
  previewElement.innerHTML = `ปิด ${formatNumber(balances.length)} บัญชี · ${netProfit >= 0 ? "กำไร" : "ขาดทุน"}สุทธิ <strong>${formatMoney(Math.abs(netProfit))}</strong> โอนเข้า ${destination}`;
}

function renderDataCounts() {
  const counts = [
    ["ผังบัญชี", state.accounts.length],
    ["รายการบันทึก", state.entries.length],
    ["ลูกค้า (ทะเบียน)", state.customers.length],
    ["เจ้าหนี้ (ทะเบียน)", state.suppliers.length],
    ["รายชื่อจากไฟล์", state.customerNames.length],
    ["ลูกหนี้", state.receivables.length],
    ["เจ้าหนี้", state.payables.length],
    ["คำอธิบายอัตโนมัติ", state.autoDesc.length],
    ["ต้นทุน/ขาย", state.customerCosts.length],
    ["เอกสารรับเข้า", state.incomingDocs.length],
  ];
  byId("settings-stats").innerHTML = counts
    .map(([label, count]) => `<div><small>${label}</small><strong>${formatNumber(count)}</strong></div>`)
    .join("");
}

function renderSettingsPage() {
  const { settings } = state;
  byId("settings-company").value = settings.company || "";
  byId("settings-tax-id").value = settings.taxId || "";
  byId("settings-period-start").value = settings.periodStart || "";
  byId("settings-period-end").value = settings.periodEnd || "";
  byId("settings-currency").value = settings.currency || "THB";
  byId("settings-note").value = settings.note || "";
  byId("settings-vat-rate").value = settings.vatRate ?? 7;
  byId("settings-credit-days").value = settings.creditDays ?? DEFAULT_CREDIT_DAYS;
  if (!closingDateInput.value) closingDateInput.value = settings.periodEnd || "";
  renderAccountRoleFields();
  renderSupplierPaymentFields();
  renderLockStatus();
  renderClosingPreview();
  renderDataCounts();
}

/**
 * บันทึกเฉพาะฟิลด์ที่เปลี่ยนใน settings
 * @param {Partial<typeof state.settings>} settingsChanges
 * @param {string} successMessage
 */
async function saveSettings(settingsChanges, successMessage) {
  const isSaved = await commitChanges({ settings: { ...state.settings, ...settingsChanges } });
  renderSettingsPage();
  if (isSaved) notifySuccess(successMessage);
  return isSaved;
}

/* ------------------------------------------------------------------ */
/* ข้อมูลกิจการ / งวดบัญชี / บัญชีลงอัตโนมัติ                              */
/* ------------------------------------------------------------------ */

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const periodStart = byId("settings-period-start").value;
  const periodEnd = byId("settings-period-end").value;
  if (periodStart && periodEnd && periodStart > periodEnd) {
    notifyError("วันที่เริ่มต้นงวดต้องไม่มากกว่าวันที่สิ้นสุด");
    return;
  }

  const supplierPaymentMethod = supplierPaymentSelect.value;
  if (supplierPaymentMethod === "transfer" && !supplierBankSelect.value) {
    notifyError("ค่าเริ่มต้นซัพพลายเออร์: กรุณาเลือกธนาคาร");
    return;
  }

  // เก็บเฉพาะบทบาทที่ผู้ใช้เลือกบัญชีเอง (ที่เว้นว่าง = ให้ระบบเลือกอัตโนมัติ)
  const accountMap = {};
  settingsForm.querySelectorAll("[data-role]").forEach((select) => {
    if (select.value) accountMap[select.dataset.role] = select.value;
  });

  await saveSettings({
    company: byId("settings-company").value.trim(),
    taxId: byId("settings-tax-id").value.trim(),
    periodStart,
    periodEnd,
    currency: byId("settings-currency").value.trim() || "THB",
    note: byId("settings-note").value.trim(),
    vatRate: Number(byId("settings-vat-rate").value) || 0,
    creditDays: Math.max(0, Math.round(Number(byId("settings-credit-days").value) || 0)),
    accountMap,
    supplierPaymentMethod,
    supplierBankName: supplierPaymentMethod === "transfer" ? supplierBankSelect.value : "",
  }, "บันทึกการตั้งค่าเรียบร้อย");
}

/* ------------------------------------------------------------------ */
/* ปิดงวดบัญชีและล็อกงวด                                                 */
/* ------------------------------------------------------------------ */

async function createClosingEntry() {
  const closingDate = closingDateInput.value;
  if (!closingDate) {
    notifyError("เลือกวันที่ปิดบัญชี");
    return;
  }
  if (isDateLocked(closingDate)) {
    notifyError("วันที่นี้อยู่ในงวดที่ล็อกแล้ว ปลดล็อกก่อนหากต้องการปิดบัญชีใหม่");
    return;
  }
  const retainedEarningsAccount = findAccountForRole("retained");
  if (!retainedEarningsAccount) {
    notifyError("ยังไม่มีบัญชีกำไรสะสม (ประเภทส่วนของเจ้าของ) — เพิ่มในผังบัญชีหรือกำหนดในหัวข้อบัญชีสำหรับลงบัญชีอัตโนมัติ");
    return;
  }
  const { balances, netProfit } = calculateClosingBalances(state.accounts, state.entries, closingDate);
  if (!balances.length) {
    notifyError("ไม่มียอดรายได้/ค่าใช้จ่ายให้ปิด");
    return;
  }

  const shouldLockAfterClosing = byId("close-lock").checked;
  const confirmMessage = `สร้างรายการปิดบัญชี ณ วันที่ ${formatDate(closingDate)}: ปิด ${balances.length} บัญชี `
    + `${netProfit >= 0 ? "กำไร" : "ขาดทุน"}สุทธิ ${formatMoney(Math.abs(netProfit))} โอนเข้า ${formatAccountLabel(retainedEarningsAccount)}`
    + `${shouldLockAfterClosing ? " และล็อกงวดถึงวันที่นี้" : ""}?`;
  if (!(await confirmDialog(confirmMessage, { title: "ปิดงวดบัญชี", confirmText: "ปิดบัญชี", tone: "primary" }))) return;

  const entries = state.entries.slice();
  const closingEntryId = upsertJournalEntry(entries, {
    date: closingDate,
    desc: `ปิดบัญชีรายได้และค่าใช้จ่ายเข้ากำไรสะสม ณ ${formatDate(closingDate)}`,
    lines: buildClosingLines(balances, netProfit, retainedEarningsAccount.id),
    source: { type: "closing", id: closingDate },
  });
  const closingEntry = entries.find((entry) => entry.id === closingEntryId);
  closingEntry.kind = "closing";

  const changes = { entries: sortEntriesByDate(entries) };
  if (shouldLockAfterClosing) changes.settings = { ...state.settings, lockDate: closingDate };
  const isSaved = await commitChanges(changes);
  renderSettingsPage();
  if (isSaved) {
    notifySuccess(`สร้างรายการปิดบัญชี ${closingEntry.docNo} เรียบร้อย${shouldLockAfterClosing ? " และล็อกงวดแล้ว" : ""}`);
  }
}

async function lockPeriod() {
  const lockDate = byId("lock-date").value;
  if (!lockDate) {
    notifyError("เลือกวันที่ล็อก");
    return;
  }
  const confirmed = await confirmDialog(
    `ล็อกรายการทั้งหมดที่ลงวันที่ถึง ${formatDate(lockDate)}? รายการในช่วงนี้จะแก้ไข/ลบ/เพิ่มไม่ได้`,
    { title: "ล็อกงวดบัญชี", confirmText: "ล็อก", tone: "primary" },
  );
  if (confirmed) await saveSettings({ lockDate }, `ล็อกงวดถึง ${formatDate(lockDate)} แล้ว`);
}

async function unlockPeriod() {
  if (!state.settings.lockDate) return;
  if (!(await confirmDialog("ปลดล็อกงวดบัญชี? รายการในงวดที่ปิดแล้วจะแก้ไขได้อีกครั้ง"))) return;
  await saveSettings({ lockDate: "" }, "ปลดล็อกงวดบัญชีแล้ว");
}

/* ------------------------------------------------------------------ */
/* สำรองและกู้คืนข้อมูล                                                   */
/* ------------------------------------------------------------------ */

function downloadBackup() {
  downloadJson(`accounting-backup-${getFileDateStamp()}.json`, {
    exportedAt: new Date().toISOString(),
    version: BACKUP_FORMAT_VERSION,
    data: state,
  });
  backupMessage.textContent = "ดาวน์โหลดไฟล์สำรองข้อมูลเรียบร้อย";
  notifySuccess("สำรองข้อมูลเรียบร้อย");
}

async function restoreBackup() {
  const backupFile = backupFileInput.files[0];
  if (!backupFile) return;
  try {
    if (!(await confirmDialog(`กู้คืนข้อมูลจากไฟล์ "${backupFile.name}"? ข้อมูลปัจจุบันจะถูกเขียนทับทั้งหมด`))) return;

    const parsedFile = JSON.parse(await backupFile.text());
    // รองรับทั้งไฟล์แบบมี { data: ... } และไฟล์รุ่นเก่าที่เก็บข้อมูลไว้ชั้นบนสุด
    const backupData = parsedFile && parsedFile.data ? parsedFile.data : parsedFile;
    if (!backupData || !Array.isArray(backupData.accounts)) throw new Error("ไฟล์ไม่ใช่ไฟล์สำรองของระบบนี้");

    // แทนที่ข้อมูลทั้งหมด: ชุดข้อมูลที่ไม่มีในไฟล์จะกลายเป็นค่าว่าง
    const restoredState = { ...createDefaultState(), ...backupData };
    const isSaved = await commitChanges(restoredState, [...DATA_COLLECTIONS, "settings", "importFiles"]);
    renderSettingsPage();
    if (!isSaved) {
      backupMessage.textContent = "กู้คืนไม่สำเร็จ: บันทึกข้อมูลไม่ผ่าน";
      return;
    }
    backupMessage.textContent = `กู้คืนข้อมูลเรียบร้อย (${formatNumber(state.accounts.length)} บัญชี, ${formatNumber(state.entries.length)} รายการ)`;
    notifySuccess("กู้คืนข้อมูลเรียบร้อย");
  } catch (error) {
    console.error(error);
    backupMessage.textContent = `กู้คืนไม่สำเร็จ: ${error.message || error}`;
    notifyError("กู้คืนข้อมูลไม่สำเร็จ");
  } finally {
    backupFileInput.value = "";
  }
}

/* ------------------------------------------------------------------ */
/* ผูกอีเวนต์                                                           */
/* ------------------------------------------------------------------ */

settingsForm.addEventListener("submit", handleSettingsSubmit);
closingDateInput.addEventListener("change", renderClosingPreview);
byId("close-run").addEventListener("click", createClosingEntry);
byId("lock-save").addEventListener("click", lockPeriod);
byId("lock-clear").addEventListener("click", unlockPeriod);
byId("backup-export").addEventListener("click", downloadBackup);
backupFileInput.addEventListener("change", restoreBackup);

if (await loadData()) {
  renderSettingsPage();
  onDataRefresh(renderSettingsPage);
  const currentUser = await authReady;
  if (currentUser) byId("settings-user").textContent = `เข้าสู่ระบบเป็น ${currentUser.email || ""}`;
}

/**
 * @file หน้า "ผังบัญชี" — เพิ่ม/แก้ไข/ลบบัญชี ค้นหา กรองตามหมวด และเพิ่มผังบัญชีมาตรฐาน
 *
 * บัญชีที่มีรายการในสมุดรายวันแล้วลบไม่ได้ (ป้องกันรายการอ้างอิงบัญชีที่ไม่มีอยู่)
 */
import { commitChanges, loadData, onDataRefresh, state } from "../../src/core/store.js";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "../../src/accounting/constants.js";
import { isDebitNormal } from "../../src/accounting/rules.js";
import { compareAccounts, renderAccountTypeBadge } from "../../src/accounting/accounts.js";
import { calculateNetBalance, sumMovementsByAccount } from "../../src/accounting/statements.js";
import { ACCOUNT_CODE_PREFIX, STANDARD_CHART_OF_ACCOUNTS } from "../../src/accounting/standard-chart.js";
import { notifyError, notifySuccess, notify } from "../../src/components/notifications.js";
import { confirmDialog } from "../../src/components/dialogs.js";
import { buildCsv } from "../../src/utils/csv.js";
import { getFileDateStamp } from "../../src/utils/date.js";
import { byId } from "../../src/utils/dom.js";
import { downloadCsv } from "../../src/utils/download.js";
import { escapeHtml, formatAccounting, formatNumber } from "../../src/utils/format.js";
import { createId } from "../../src/utils/id.js";
import { debounce } from "../../src/utils/timing.js";

const accountForm = byId("account-form");
const submitButton = byId("account-submit");
const cancelButton = byId("account-cancel");
const typeSelect = byId("account-type");
const codeInput = byId("account-code");
const nameInput = byId("account-name");
const typeHintElement = byId("account-type-hint");
const tableBody = document.querySelector("#accounts-table tbody");

/** คำอธิบายใต้ช่องหมวดบัญชี: ด้านปกติ งบที่แสดง และรหัสที่แนะนำ */
const ACCOUNT_TYPE_HINTS = {
  asset: "สินทรัพย์ · ด้านปกติ: เดบิต · แสดงในงบแสดงฐานะการเงิน · รหัสแนะนำขึ้นต้นด้วย 1",
  liability: "หนี้สิน · ด้านปกติ: เครดิต · แสดงในงบแสดงฐานะการเงิน · รหัสแนะนำขึ้นต้นด้วย 2",
  equity: "ส่วนของเจ้าของ · ด้านปกติ: เครดิต · แสดงในงบแสดงฐานะการเงิน · รหัสแนะนำขึ้นต้นด้วย 3",
  revenue: "รายได้ · ด้านปกติ: เครดิต · แสดงในงบกำไรขาดทุน · รหัสแนะนำขึ้นต้นด้วย 4",
  expense: "ค่าใช้จ่าย · ด้านปกติ: เดบิต · แสดงในงบกำไรขาดทุน · รหัสแนะนำขึ้นต้นด้วย 5",
};

/** id ของบัญชีที่กำลังแก้ไข (null = เพิ่มใหม่) */
let editingAccountId = null;
/** หมวดที่กรองอยู่ ("" = ทุกหมวด) */
let selectedTypeFilter = "";
/** จำนวนบรรทัดในสมุดรายวันที่ใช้แต่ละบัญชี */
let lineCountByAccountId = new Map();
/** ยอดเคลื่อนไหวของทุกบัญชี (ใช้คำนวณยอดคงเหลือ) */
let movementsByAccountId = new Map();

/** นับการใช้งานและยอดคงเหลือใหม่ (เรียกเมื่อข้อมูลเปลี่ยน) */
function recalculateAccountUsage() {
  lineCountByAccountId = new Map();
  state.entries.forEach((entry) => entry.lines.forEach((line) => {
    lineCountByAccountId.set(line.accountId, (lineCountByAccountId.get(line.accountId) || 0) + 1);
  }));
  movementsByAccountId = sumMovementsByAccount(state.entries);
}

/**
 * รหัสบัญชีถัดไปในหมวด เช่น มี 1101, 1102 แล้ว → แนะนำ 1103
 * @param {string} accountType
 * @returns {string}
 */
function suggestNextAccountCode(accountType) {
  const prefix = ACCOUNT_CODE_PREFIX[accountType];
  if (!prefix) return "";
  const numericCodes = state.accounts
    .map((account) => String(account.code))
    .filter((code) => /^\d+$/.test(code) && code.startsWith(prefix))
    .map(Number);
  return numericCodes.length ? String(Math.max(...numericCodes) + 1) : `${prefix}101`;
}

const sortByCode = (accounts) =>
  accounts.sort((leftAccount, rightAccount) => String(leftAccount.code).localeCompare(String(rightAccount.code), "th-TH", { numeric: true }));

/* ------------------------------------------------------------------ */
/* ฟอร์ม                                                                */
/* ------------------------------------------------------------------ */

function resetForm() {
  editingAccountId = null;
  accountForm.reset();
  accountForm.classList.remove("is-editing");
  byId("account-form-title").textContent = "เพิ่มบัญชีใหม่";
  submitButton.textContent = "เพิ่มบัญชี";
  cancelButton.hidden = true;
  typeHintElement.textContent = "เลือกหมวดบัญชีเพื่อดูด้านปกติและรหัสที่แนะนำ";
}

function startEditingAccount(account) {
  editingAccountId = account.id;
  codeInput.value = account.code;
  nameInput.value = account.name;
  typeSelect.value = account.type;
  typeHintElement.textContent = ACCOUNT_TYPE_HINTS[account.type] || "";
  accountForm.classList.add("is-editing");
  byId("account-form-title").textContent = `แก้ไขบัญชี ${account.code}`;
  submitButton.textContent = "บันทึกการแก้ไข";
  cancelButton.hidden = false;
  accountForm.scrollIntoView({ behavior: "smooth", block: "start" });
  nameInput.focus();
  if (lineCountByAccountId.get(account.id)) {
    notify("บัญชีนี้มีรายการแล้ว การเปลี่ยนหมวดจะมีผลกับงบการเงินทั้งหมด");
  }
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const code = codeInput.value.trim();
  const name = nameInput.value.trim();
  const type = typeSelect.value;
  if (!code || !name || !type) {
    notifyError("กรอกหมวด รหัส และชื่อบัญชีให้ครบ");
    return;
  }
  const isDuplicateCode = state.accounts.some((account) => String(account.code) === code && account.id !== editingAccountId);
  if (isDuplicateCode) {
    notifyError(`รหัสบัญชี ${code} มีอยู่แล้ว`);
    codeInput.focus();
    return;
  }

  const isEditing = Boolean(editingAccountId);
  const accounts = isEditing
    ? state.accounts.map((account) => (account.id === editingAccountId ? { ...account, code, name, type } : account))
    : [...state.accounts, { id: createId(), code, name, type }];
  if (!(await commitChanges({ accounts: sortByCode(accounts) }))) {
    renderAccountTable();
    return;
  }

  resetForm();
  renderAccountTable();
  notifySuccess(isEditing ? "แก้ไขบัญชีเรียบร้อย" : `เพิ่มบัญชี ${code} ${name} เรียบร้อย`);
  if (!isEditing) {
    // เพิ่มหลายบัญชีต่อเนื่องได้เร็ว: คงหมวดเดิมไว้ และแนะนำรหัสถัดไป
    typeSelect.value = type;
    typeHintElement.textContent = ACCOUNT_TYPE_HINTS[type] || "";
    codeInput.value = suggestNextAccountCode(type);
    nameInput.focus();
  }
}

async function deleteAccount(accountId) {
  if (lineCountByAccountId.get(accountId)) {
    notifyError("บัญชีนี้ถูกใช้ในรายการแล้ว ลบไม่ได้");
    return;
  }
  const account = state.accounts.find((item) => item.id === accountId);
  if (!(await confirmDialog(`ยืนยันการลบบัญชี ${account?.code || ""} ${account?.name || ""}?`))) return;

  const isSaved = await commitChanges({ accounts: state.accounts.filter((item) => item.id !== accountId) });
  if (isSaved && editingAccountId === accountId) resetForm();
  renderAccountTable();
  if (isSaved) notifySuccess("ลบบัญชีเรียบร้อย");
}

/** เพิ่มบัญชีจากผังบัญชีมาตรฐาน เฉพาะรหัสที่ยังไม่มี */
async function addStandardChart() {
  const existingCodes = new Set(state.accounts.map((account) => String(account.code)));
  const missingAccounts = STANDARD_CHART_OF_ACCOUNTS.filter((account) => !existingCodes.has(account.code));
  if (!missingAccounts.length) {
    notify("มีบัญชีมาตรฐานครบแล้ว");
    return;
  }
  const confirmed = await confirmDialog(
    `เพิ่มบัญชีมาตรฐานสำหรับธุรกิจขนาดเล็ก ${missingAccounts.length} บัญชี (ข้ามรหัสที่มีอยู่แล้ว)?`,
    { title: "เพิ่มผังบัญชีมาตรฐาน", confirmText: "เพิ่มบัญชี", tone: "primary" },
  );
  if (!confirmed) return;

  const newAccounts = missingAccounts.map((account) => ({ id: createId(), ...account }));
  if (!(await commitChanges({ accounts: sortByCode([...state.accounts, ...newAccounts]) }))) return;
  renderAccountTable();
  notifySuccess(`เพิ่ม ${missingAccounts.length} บัญชีเรียบร้อย`);
}

/* ------------------------------------------------------------------ */
/* ตาราง                                                                */
/* ------------------------------------------------------------------ */

function renderTypeFilterChips() {
  const countByType = Object.fromEntries(ACCOUNT_TYPE_ORDER.map((type) => [type, 0]));
  state.accounts.forEach((account) => {
    if (account.type in countByType) countByType[account.type] += 1;
  });
  const allChip = `<button type="button" class="chip" data-type="" aria-pressed="${!selectedTypeFilter}">ทั้งหมด<span class="count">${formatNumber(state.accounts.length)}</span></button>`;
  const typeChips = ACCOUNT_TYPE_ORDER.map((type) =>
    `<button type="button" class="chip" data-type="${type}" aria-pressed="${selectedTypeFilter === type}">${ACCOUNT_TYPE_LABELS[type]}<span class="count">${formatNumber(countByType[type])}</span></button>`);
  byId("account-type-chips").innerHTML = [allChip, ...typeChips].join("");
}

function renderAccountRow(account) {
  const lineCount = lineCountByAccountId.get(account.id) || 0;
  const netBalance = calculateNetBalance(account, movementsByAccountId);
  const isDebitSide = isDebitNormal(account.type);
  const nameCell = lineCount
    ? `<a href="../ledger/ledger.html?account=${encodeURIComponent(account.id)}" title="ดูบัญชีแยกประเภท">${escapeHtml(account.name)}</a>`
    : escapeHtml(account.name);
  const deleteAttributes = lineCount ? ' disabled title="บัญชีนี้ถูกใช้ในรายการแล้ว ลบไม่ได้"' : "";

  return `<tr>
    <td class="code">${escapeHtml(account.code)}</td>
    <td>${nameCell}</td>
    <td>${renderAccountTypeBadge(account.type)}</td>
    <td><span class="${isDebitSide ? "debit-text" : "credit-text"}">${isDebitSide ? "เดบิต (Dr)" : "เครดิต (Cr)"}</span></td>
    <td class="right">${lineCount ? formatNumber(lineCount) : '<span class="muted">-</span>'}</td>
    <td class="right${netBalance < 0 ? " negative-amount" : ""}">${lineCount ? formatAccounting(netBalance) : ""}</td>
    <td class="actions-cell">
      <button type="button" class="small secondary" data-edit-account="${escapeHtml(account.id)}">แก้ไข</button>
      <button type="button" class="small danger" data-delete-account="${escapeHtml(account.id)}"${deleteAttributes}>ลบ</button>
    </td>
  </tr>`;
}

function renderAccountTable() {
  renderTypeFilterChips();
  if (!state.accounts.length) {
    tableBody.innerHTML = '<tr><td colspan="7" class="muted">ยังไม่มีบัญชี — กรอกฟอร์มด้านบน หรือกด “เพิ่มผังบัญชีมาตรฐาน” เพื่อเริ่มต้นอย่างรวดเร็ว</td></tr>';
    return;
  }

  const searchText = byId("account-search").value.trim().toLowerCase();
  const visibleAccounts = state.accounts
    .filter((account) => !selectedTypeFilter || account.type === selectedTypeFilter)
    .filter((account) => !searchText || `${account.code} ${account.name}`.toLowerCase().includes(searchText))
    .sort(compareAccounts);
  if (!visibleAccounts.length) {
    tableBody.innerHTML = '<tr><td colspan="7" class="muted">ไม่พบบัญชีที่ค้นหา</td></tr>';
    return;
  }

  // แสดงหัวกลุ่มหมวดบัญชีเมื่อดูทุกหมวด
  let previousType = null;
  tableBody.innerHTML = visibleAccounts.map((account) => {
    const showGroupHeader = !selectedTypeFilter && account.type !== previousType;
    previousType = account.type;
    const groupHeader = showGroupHeader
      ? `<tr class="group-head"><td colspan="7">${escapeHtml(ACCOUNT_TYPE_LABELS[account.type] || "อื่น ๆ")}</td></tr>`
      : "";
    return groupHeader + renderAccountRow(account);
  }).join("");
}

function exportCsv() {
  if (!state.accounts.length) {
    notifyError("ไม่มีบัญชีให้ส่งออก");
    return;
  }
  const headers = ["รหัส", "ชื่อบัญชี", "หมวด", "ด้านปกติ", "จำนวนรายการ", "ยอดคงเหลือ"];
  const rows = state.accounts.slice().sort(compareAccounts).map((account) => [
    account.code,
    account.name,
    ACCOUNT_TYPE_LABELS[account.type] || account.type,
    isDebitNormal(account.type) ? "เดบิต" : "เครดิต",
    lineCountByAccountId.get(account.id) || 0,
    calculateNetBalance(account, movementsByAccountId),
  ]);
  downloadCsv(`chart-of-accounts-${getFileDateStamp()}.csv`, buildCsv(headers, rows));
  notifySuccess("ส่งออกผังบัญชีเรียบร้อย");
}

/* ------------------------------------------------------------------ */
/* ผูกอีเวนต์                                                           */
/* ------------------------------------------------------------------ */

tableBody.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.editAccount) {
    const account = state.accounts.find((item) => item.id === button.dataset.editAccount);
    if (account) startEditingAccount(account);
  } else if (button.dataset.deleteAccount) {
    deleteAccount(button.dataset.deleteAccount);
  }
});

byId("account-type-chips").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-type]");
  if (!chip) return;
  selectedTypeFilter = chip.dataset.type;
  renderAccountTable();
});
byId("account-search").addEventListener("input", debounce(renderAccountTable, 150));

typeSelect.addEventListener("change", () => {
  typeHintElement.textContent = ACCOUNT_TYPE_HINTS[typeSelect.value] || "";
  if (!editingAccountId && !codeInput.value.trim()) codeInput.value = suggestNextAccountCode(typeSelect.value);
});
cancelButton.addEventListener("click", () => {
  resetForm();
  notify("ยกเลิกการแก้ไขแล้ว");
});
accountForm.addEventListener("submit", handleFormSubmit);
byId("account-template").addEventListener("click", addStandardChart);
byId("account-export").addEventListener("click", exportCsv);

if (await loadData(["accounts", "entries"])) {
  recalculateAccountUsage();
  resetForm();
  renderAccountTable();
  onDataRefresh(() => {
    recalculateAccountUsage();
    renderAccountTable();
  });
}

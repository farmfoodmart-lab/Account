/**
 * @file หน้า "บัญชีแยกประเภท" — ความเคลื่อนไหวและยอดคงเหลือของแต่ละบัญชี
 *
 * ยอดคงเหลือนับเฉพาะรายการในช่วงที่เลือก (ค่าเริ่มต้น = เดือนล่าสุด)
 * ติ๊ก "รวมยอดยกมา" เพื่อนับรายการก่อน "ตั้งแต่วันที่" เป็นยอดยกมาด้วย (ยอดสะสม)
 *
 * เพื่อให้รองรับข้อมูลจำนวนมาก:
 * - สร้างดัชนี "บัญชี → รายการ" ครั้งเดียวต่อการโหลด (ไม่ต้องวนทุกรายการซ้ำทุกบัญชี)
 * - ตารางรายละเอียดของแต่ละบัญชีจะสร้างเมื่อผู้ใช้กดเปิดบัญชีนั้นเท่านั้น
 */
import { loadData, onDataRefresh, state } from "../../src/core/store.js";
import { ACCOUNT_TYPE_LABELS, AMOUNT_EPSILON } from "../../src/accounting/constants.js";
import { isDebitNormal } from "../../src/accounting/rules.js";
import { compareAccounts } from "../../src/accounting/accounts.js";
import { notifyError, notifySuccess } from "../../src/components/notifications.js";
import { createMonthFilter, getInitialMonthRange } from "../../src/components/month-filter.js";
import { buildCsv } from "../../src/utils/csv.js";
import { getFileDateStamp, toIsoDate } from "../../src/utils/date.js";
import { byId } from "../../src/utils/dom.js";
import { downloadCsv } from "../../src/utils/download.js";
import { escapeHtml, formatDate, formatMoney, formatNumber } from "../../src/utils/format.js";
import { debounce } from "../../src/utils/timing.js";

const accountTypeSelect = byId("ledger-type");
const accountSelect = byId("ledger-account");
const fromDateInput = byId("ledger-from");
const toDateInput = byId("ledger-to");
const searchInput = byId("ledger-search");
const hideInactiveCheckbox = byId("ledger-hide-empty");
const includeOpeningCheckbox = byId("ledger-include-opening");
const ledgerContainer = byId("ledger-view");
const toggleAllButton = byId("ledger-toggle-all");

/**
 * ดัชนีรายการของแต่ละบัญชี เรียงตามวันที่
 * @type {Map<string, Array<{ entry: object, line: object, isoDate: string }>>}
 */
let postingsByAccountId = new Map();

/** แคชผลคำนวณของแต่ละบัญชีสำหรับตัวกรองปัจจุบัน (ล้างทุกครั้งที่ตัวกรองเปลี่ยน) */
let ledgerCache = new Map();

function buildPostingIndex() {
  postingsByAccountId = new Map();
  state.entries.forEach((entry) => {
    const isoDate = toIsoDate(entry.date);
    entry.lines.forEach((line) => {
      if (!line.accountId) return;
      if (!postingsByAccountId.has(line.accountId)) postingsByAccountId.set(line.accountId, []);
      postingsByAccountId.get(line.accountId).push({ entry, line, isoDate });
    });
  });
  postingsByAccountId.forEach((postings) => postings.sort((left, right) => left.isoDate.localeCompare(right.isoDate)));
}

/** จัดกลุ่มบัญชีตามหมวด (หมวดที่ไม่รู้จักต่อท้าย) */
function groupAccountsByType(accounts) {
  const knownTypes = Object.keys(ACCOUNT_TYPE_LABELS);
  const extraTypes = [...new Set(accounts.map((account) => account.type || "other"))].filter((type) => !knownTypes.includes(type));
  return [...knownTypes, ...extraTypes]
    .map((type) => ({
      type,
      label: ACCOUNT_TYPE_LABELS[type] || (type === "other" ? "อื่น ๆ" : type),
      accounts: accounts.filter((account) => (account.type || "other") === type).sort(compareAccounts),
    }))
    .filter((group) => group.accounts.length);
}

/**
 * ยอดคงเหลือพร้อมป้ายด้าน Dr/Cr
 * @param {object} account
 * @param {number} balance ยอดในด้านปกติของบัญชี (ลบ = กลับด้าน)
 */
function renderBalance(account, balance) {
  let side = "";
  if (Math.abs(balance) >= AMOUNT_EPSILON) {
    const isDebitSide = isDebitNormal(account.type) ? balance > 0 : balance < 0;
    side = isDebitSide ? "Dr" : "Cr";
  }
  return `${formatMoney(Math.abs(balance))}<span class="side-tag">${side}</span>`;
}

/**
 * คำนวณบัญชีแยกประเภทของบัญชีหนึ่งตามตัวกรองปัจจุบัน
 * - รายการก่อน "ตั้งแต่วันที่" รวมเป็นยอดยกมา เฉพาะเมื่อติ๊ก "รวมยอดยกมา" (ไม่ติ๊ก = ไม่นับ)
 * - รายการที่ไม่ตรงคำค้นหาจะไม่แสดง แต่ยังนับในยอดคงเหลือสะสม (ยอดจึงถูกต้องเสมอ)
 * @returns {{ openingBalance: number, closingBalance: number, totalDebit: number, totalCredit: number,
 *             rows: Array<{ entry: object, debit: number, credit: number, runningBalance: number }> }}
 */
function calculateAccountLedger(account) {
  if (ledgerCache.has(account.id)) return ledgerCache.get(account.id);

  const fromDate = fromDateInput.value;
  const toDate = toDateInput.value;
  const searchText = searchInput.value.trim().toLowerCase();
  const includeOpening = includeOpeningCheckbox.checked;
  const normalSideSign = isDebitNormal(account.type) ? 1 : -1;
  let openingBalance = 0;
  let periodChange = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = [];

  (postingsByAccountId.get(account.id) || []).forEach(({ entry, line, isoDate }) => {
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    const change = normalSideSign * (debit - credit);

    if (fromDate && isoDate && isoDate < fromDate) {
      if (includeOpening) openingBalance += change;
      return;
    }
    if (toDate && isoDate && isoDate > toDate) return;

    periodChange += change;
    const searchableText = `${entry.desc || ""} ${entry.docNo || ""} ${entry.customerName || ""}`.toLowerCase();
    if (searchText && !searchableText.includes(searchText)) return;

    totalDebit += debit;
    totalCredit += credit;
    rows.push({ entry, debit, credit, runningBalance: openingBalance + periodChange });
  });

  const ledger = { openingBalance, closingBalance: openingBalance + periodChange, totalDebit, totalCredit, rows };
  ledgerCache.set(account.id, ledger);
  return ledger;
}

const hasNoActivity = (ledger) => !ledger.rows.length && Math.abs(ledger.openingBalance) < AMOUNT_EPSILON;

/** ตารางรายละเอียดของบัญชี (สร้างเมื่อกดเปิด) */
function renderAccountDetail(account) {
  const ledger = calculateAccountLedger(account);
  if (hasNoActivity(ledger)) return '<p class="ledger-empty">ไม่มีความเคลื่อนไหวในช่วงที่เลือก</p>';

  const openingRow = fromDateInput.value && includeOpeningCheckbox.checked
    ? `<tr class="opening"><td>${escapeHtml(formatDate(fromDateInput.value))}</td><td></td><td>ยอดยกมา</td><td></td><td></td><td class="right">${renderBalance(account, ledger.openingBalance)}</td></tr>`
    : "";
  const postingRows = ledger.rows.map((row) => `<tr>
    <td class="nowrap">${escapeHtml(formatDate(row.entry.date))}</td>
    <td class="code">${escapeHtml(row.entry.docNo || "")}</td>
    <td>${escapeHtml(row.entry.desc || "")}${row.entry.customerName ? `<span class="cell-sub">${escapeHtml(row.entry.customerName)}</span>` : ""}</td>
    <td class="right">${row.debit ? formatMoney(row.debit) : ""}</td>
    <td class="right">${row.credit ? formatMoney(row.credit) : ""}</td>
    <td class="right">${renderBalance(account, row.runningBalance)}</td>
  </tr>`).join("");

  return `<table>
    <thead><tr><th class="col-date">วันที่</th><th style="width:130px">เลขที่</th><th>รายละเอียด</th><th class="right col-amount">เดบิต</th><th class="right col-amount">เครดิต</th><th class="right col-amount">คงเหลือ</th></tr></thead>
    <tbody>${openingRow}${postingRows}</tbody>
    <tfoot><tr><th colspan="3">รวมความเคลื่อนไหว (${formatNumber(ledger.rows.length)} รายการ)</th><th class="right">${formatMoney(ledger.totalDebit)}</th><th class="right">${formatMoney(ledger.totalCredit)}</th><th class="right">${renderBalance(account, ledger.closingBalance)}</th></tr></tfoot>
  </table>`;
}

/** หัวบัญชีแบบพับ/ขยายได้ (<details>) */
function renderAccountPanel(account, isOpen) {
  const ledger = calculateAccountLedger(account);
  return `<details class="ledger-account" data-account-id="${escapeHtml(account.id)}"${isOpen ? " open" : ""}>
    <summary>
      <span class="ledger-name"><span class="code">${escapeHtml(account.code)}</span>${escapeHtml(account.name)}</span>
      <span class="ledger-sum"><small>เดบิต</small>${formatMoney(ledger.totalDebit)}</span>
      <span class="ledger-sum"><small>เครดิต</small>${formatMoney(ledger.totalCredit)}</span>
      <span class="ledger-sum is-balance"><small>คงเหลือ</small><strong>${renderBalance(account, ledger.closingBalance)}</strong></span>
    </summary>
    <div class="ledger-body">${isOpen ? renderAccountDetail(account) : ""}</div>
  </details>`;
}

/** บัญชีที่ผ่านตัวกรองหมวด/บัญชี/ซ่อนบัญชีไม่เคลื่อนไหว */
function getFilteredAccounts() {
  const selectedType = accountTypeSelect.value;
  const selectedAccountId = accountSelect.value;
  return state.accounts.filter((account) => {
    if (selectedType && (account.type || "other") !== selectedType) return false;
    if (selectedAccountId && account.id !== selectedAccountId) return false;
    if (hideInactiveCheckbox.checked && !selectedAccountId && hasNoActivity(calculateAccountLedger(account))) return false;
    return true;
  });
}

/**
 * ยอดคงเหลือรวมของหมวด (ด้านปกติของหมวด เช่น สินทรัพย์ = Dr)
 * บัญชีปรับมูลค่า เช่น ค่าเสื่อมราคาสะสม จะถูกหักออกโดยอัตโนมัติ เพราะยอดอยู่คนละด้าน
 */
function renderGroupBalance(group) {
  const total = group.accounts.reduce((sum, account) => {
    const sign = isDebitNormal(account.type) === isDebitNormal(group.type) ? 1 : -1;
    return sum + sign * calculateAccountLedger(account).closingBalance;
  }, 0);
  return renderBalance({ type: group.type }, total);
}

function renderLedger() {
  ledgerCache = new Map();
  if (fromDateInput.value && toDateInput.value && fromDateInput.value > toDateInput.value) {
    notifyError("วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด");
    return;
  }

  const accounts = getFilteredAccounts();
  if (!accounts.length) {
    ledgerContainer.innerHTML = state.accounts.length
      ? '<div class="empty-state"><strong>ไม่พบบัญชี</strong>ลองยกเลิก “ซ่อนบัญชีที่ไม่มีความเคลื่อนไหว” หรือเปลี่ยนตัวกรอง</div>'
      : '<div class="empty-state"><strong>ยังไม่มีผังบัญชี</strong><a class="btn" href="../accounts/accounts.html">สร้างผังบัญชี</a></div>';
    return;
  }

  // เลือกบัญชีเดียว → เปิดรายละเอียดให้ทันที
  const shouldOpenAll = accounts.length === 1;
  ledgerContainer.innerHTML = groupAccountsByType(accounts).map((group) => `<section class="ledger-group">
    <div class="ledger-group-head"><h3><span class="badge type-${escapeHtml(group.type)}">${escapeHtml(group.label)}</span></h3>
      <span>${formatNumber(group.accounts.length)} บัญชี · ยอดคงเหลือรวม <strong>${renderGroupBalance(group)}</strong></span></div>
    <div class="ledger-group-accounts">${group.accounts.map((account) => renderAccountPanel(account, shouldOpenAll)).join("")}</div>
  </section>`).join("");
  toggleAllButton.textContent = shouldOpenAll ? "ย่อทั้งหมด" : "ขยายทั้งหมด";
}

/** สร้างตัวเลือกหมวด/บัญชี (รายการบัญชีกรองตามหมวดที่เลือก) แล้ววาดใหม่ */
function renderFilterOptions() {
  const groups = groupAccountsByType(state.accounts);
  const selectedType = accountTypeSelect.value;
  const selectedAccountId = accountSelect.value;

  accountTypeSelect.innerHTML = '<option value="">ทุกหมวด</option>'
    + groups.map((group) => `<option value="${escapeHtml(group.type)}">${escapeHtml(group.label)}</option>`).join("");
  accountTypeSelect.value = groups.some((group) => group.type === selectedType) ? selectedType : "";

  const visibleGroups = accountTypeSelect.value ? groups.filter((group) => group.type === accountTypeSelect.value) : groups;
  const visibleAccounts = visibleGroups.flatMap((group) => group.accounts);
  accountSelect.innerHTML = `<option value="">${accountTypeSelect.value ? "ทุกบัญชีในหมวดนี้" : "ทุกบัญชี"}</option>`
    + visibleGroups.map((group) => `<optgroup label="${escapeHtml(group.label)}">${group.accounts
      .map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.code)} · ${escapeHtml(account.name)}</option>`).join("")}</optgroup>`).join("");
  accountSelect.value = visibleAccounts.some((account) => account.id === selectedAccountId) ? selectedAccountId : "";
  renderLedger();
}

function toggleAllAccounts() {
  const panels = [...ledgerContainer.querySelectorAll("details.ledger-account")];
  const shouldOpen = panels.some((panel) => !panel.open);
  if (shouldOpen && panels.length > 60) notifySuccess(`กำลังขยาย ${formatNumber(panels.length)} บัญชี`);
  panels.forEach((panel) => { panel.open = shouldOpen; });
  toggleAllButton.textContent = shouldOpen ? "ย่อทั้งหมด" : "ขยายทั้งหมด";
}

function exportCsv() {
  const rows = [];
  getFilteredAccounts().sort(compareAccounts).forEach((account) => {
    const ledger = calculateAccountLedger(account);
    if (fromDateInput.value && includeOpeningCheckbox.checked) {
      rows.push([account.code, account.name, formatDate(fromDateInput.value), "", "ยอดยกมา", "", "", ledger.openingBalance]);
    }
    ledger.rows.forEach((row) => rows.push([
      account.code, account.name, formatDate(row.entry.date), row.entry.docNo || "", row.entry.desc || "",
      row.debit, row.credit, row.runningBalance,
    ]));
  });
  if (!rows.length) {
    notifyError("ไม่มีข้อมูลให้ส่งออก");
    return;
  }
  const headers = ["รหัสบัญชี", "ชื่อบัญชี", "วันที่", "เลขที่เอกสาร", "รายละเอียด", "เดบิต", "เครดิต", "คงเหลือ (ด้านปกติ)"];
  downloadCsv(`ledger-${getFileDateStamp()}.csv`, buildCsv(headers, rows));
  notifySuccess("ส่งออกบัญชีแยกประเภทเรียบร้อย");
}

// สร้างตารางรายละเอียดเมื่อเปิดบัญชี (อีเวนต์ toggle ไม่ bubble จึงต้องดักในช่วง capture)
ledgerContainer.addEventListener("toggle", (event) => {
  const panel = event.target;
  if (!(panel instanceof HTMLDetailsElement) || !panel.open) return;
  const detailContainer = panel.querySelector(".ledger-body");
  if (detailContainer.childElementCount) return;
  const account = state.accounts.find((item) => item.id === panel.dataset.accountId);
  if (account) detailContainer.innerHTML = renderAccountDetail(account);
}, true);

toggleAllButton.addEventListener("click", toggleAllAccounts);
byId("ledger-export").addEventListener("click", exportCsv);
accountTypeSelect.addEventListener("change", renderFilterOptions);
accountSelect.addEventListener("change", renderLedger);
fromDateInput.addEventListener("change", renderLedger);
toDateInput.addEventListener("change", renderLedger);
hideInactiveCheckbox.addEventListener("change", renderLedger);
includeOpeningCheckbox.addEventListener("change", renderLedger);
searchInput.addEventListener("input", debounce(renderLedger, 200));

if (await loadData(["accounts", "entries"])) {
  const monthFilter = createMonthFilter({
    fromInput: fromDateInput,
    toInput: toDateInput,
    getRecords: () => state.entries,
    onSelect: renderLedger,
  });
  // ค่าเริ่มต้น: เดือนล่าสุดที่มีรายการ (ยอดคงเหลือนับเฉพาะเดือนนี้ ไม่รวมยอดยกมา)
  // เดือนที่เลือกไว้ในหน้าอื่น (ถ้ามี) ไม่เช่นนั้นเดือนล่าสุดที่มีรายการ
  const latestMonth = getInitialMonthRange(state.entries);
  fromDateInput.value = latestMonth.from;
  toDateInput.value = latestMonth.to;
  buildPostingIndex();
  renderFilterOptions();

  // ลิงก์จากหน้าอื่น เช่น ledger.html?account=<id> → เปิดบัญชีนั้นทันที
  const requestedAccountId = new URLSearchParams(location.search).get("account");
  if (requestedAccountId && state.accounts.some((account) => account.id === requestedAccountId)) {
    accountSelect.value = requestedAccountId;
    renderLedger();
  }
  onDataRefresh(() => {
    monthFilter.refresh();
    buildPostingIndex();
    renderFilterOptions();
  });
}

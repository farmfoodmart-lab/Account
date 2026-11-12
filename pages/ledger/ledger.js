import {
  AMOUNT_EPSILON,
  TYPES,
  compareAccounts,
  esc,
  fmt,
  fmtDateDMY,
  fmtInt,
  load,
  normalDebit,
  state, onDataRefresh
} from "../../js/data.js";
import { toIsoDate } from "../../js/reports.js";
import { debounce, downloadCsvFile, fileStamp, toastError, toastSuccess } from "../../js/ui.js";
import { toCsv } from "../../js/csv.js";

const $ = (id) => document.getElementById(id);
const typeSelect = $("ledger-type");
const accountSelect = $("ledger-account");
const fromInput = $("ledger-from");
const toInput = $("ledger-to");
const searchInput = $("ledger-search");
const hideEmptyInput = $("ledger-hide-empty");
const ledgerContainer = $("ledger-view");

/** accountId -> [{ entry, line, iso }] sorted by date; built once per load. */
let postingsByAccount = new Map();
let ledgerCache = new Map();

function buildIndex() {
  postingsByAccount = new Map();
  state.entries.forEach((entry) => {
    const iso = toIsoDate(entry.date);
    entry.lines.forEach((line) => {
      if (!line.accountId) return;
      if (!postingsByAccount.has(line.accountId)) postingsByAccount.set(line.accountId, []);
      postingsByAccount.get(line.accountId).push({ entry, line, iso });
    });
  });
  postingsByAccount.forEach((postings) => postings.sort((left, right) => left.iso.localeCompare(right.iso)));
}

function getLedgerGroups(accounts) {
  const knownTypes = Object.keys(TYPES);
  const extraTypes = [...new Set(accounts.map((account) => account.type || "other"))].filter((type) => !knownTypes.includes(type));
  return [...knownTypes, ...extraTypes]
    .map((type) => ({
      type,
      label: TYPES[type] || (type === "other" ? "อื่น ๆ" : type),
      accounts: accounts.filter((account) => (account.type || "other") === type).sort(compareAccounts),
    }))
    .filter((group) => group.accounts.length);
}

function sideOf(account, amount) {
  if (Math.abs(amount) < AMOUNT_EPSILON) return "";
  const debitSide = normalDebit(account.type) ? amount > 0 : amount < 0;
  return debitSide ? "Dr" : "Cr";
}

function balanceText(account, amount) {
  return `${fmt(Math.abs(amount))}<span class="side-tag">${sideOf(account, amount)}</span>`;
}

/**
 * Compute the ledger for one account for the current filters.
 * Running balance is in the account's normal direction (positive = normal side).
 */
function computeLedger(account) {
  if (ledgerCache.has(account.id)) return ledgerCache.get(account.id);
  const from = fromInput.value;
  const to = toInput.value;
  const needle = searchInput.value.trim().toLowerCase();
  const sign = normalDebit(account.type) ? 1 : -1;
  let opening = 0;
  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = [];
  (postingsByAccount.get(account.id) || []).forEach(({ entry, line, iso }) => {
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    const delta = sign * (debit - credit);
    if (from && iso && iso < from) {
      opening += delta;
      return;
    }
    if (to && iso && iso > to) return;
    if (needle && !`${entry.desc || ""} ${entry.docNo || ""} ${entry.customerName || ""}`.toLowerCase().includes(needle)) {
      running += delta;
      return;
    }
    running += delta;
    totalDebit += debit;
    totalCredit += credit;
    rows.push({ entry, debit, credit, balanceAfter: opening + running });
  });
  const result = { opening, closing: opening + running, totalDebit, totalCredit, rows };
  ledgerCache.set(account.id, result);
  return result;
}

function renderAccountBody(account) {
  const ledger = computeLedger(account);
  if (!ledger.rows.length && Math.abs(ledger.opening) < AMOUNT_EPSILON) {
    return '<p class="ledger-empty">ไม่มีความเคลื่อนไหวในช่วงที่เลือก</p>';
  }
  const opening = fromInput.value
    ? `<tr class="opening"><td>${esc(fmtDateDMY(fromInput.value))}</td><td></td><td>ยอดยกมา</td><td></td><td></td><td class="right">${balanceText(account, ledger.opening)}</td></tr>`
    : "";
  const rows = ledger.rows.map((row) => `<tr><td class="nowrap">${esc(fmtDateDMY(row.entry.date))}</td><td class="code">${esc(row.entry.docNo || "")}</td><td>${esc(row.entry.desc || "")}${row.entry.customerName ? `<span class="cell-sub">${esc(row.entry.customerName)}</span>` : ""}</td><td class="right">${row.debit ? fmt(row.debit) : ""}</td><td class="right">${row.credit ? fmt(row.credit) : ""}</td><td class="right">${balanceText(account, row.balanceAfter)}</td></tr>`).join("");
  return `<table><thead><tr><th class="col-date">วันที่</th><th style="width:130px">เลขที่</th><th>รายละเอียด</th><th class="right col-amt">เดบิต</th><th class="right col-amt">เครดิต</th><th class="right col-amt">คงเหลือ</th></tr></thead>
    <tbody>${opening}${rows}</tbody>
    <tfoot><tr><th colspan="3">รวมความเคลื่อนไหว (${fmtInt(ledger.rows.length)} รายการ)</th><th class="right">${fmt(ledger.totalDebit)}</th><th class="right">${fmt(ledger.totalCredit)}</th><th class="right">${balanceText(account, ledger.closing)}</th></tr></tfoot></table>`;
}

function renderAccount(account, open) {
  const ledger = computeLedger(account);
  return `<details class="ledger-account" data-account-id="${esc(account.id)}"${open ? " open" : ""}>
    <summary>
      <span class="ledger-name"><span class="code">${esc(account.code)}</span>${esc(account.name)}</span>
      <span class="ledger-sum"><small>เดบิต</small>${fmt(ledger.totalDebit)}</span>
      <span class="ledger-sum"><small>เครดิต</small>${fmt(ledger.totalCredit)}</span>
      <span class="ledger-sum is-balance"><small>คงเหลือ</small><strong>${balanceText(account, ledger.closing)}</strong></span>
    </summary>
    <div class="ledger-body">${open ? renderAccountBody(account) : ""}</div>
  </details>`;
}

function filteredAccounts() {
  const type = typeSelect.value;
  const accountId = accountSelect.value;
  return state.accounts.filter((account) => {
    if (type && (account.type || "other") !== type) return false;
    if (accountId && account.id !== accountId) return false;
    if (hideEmptyInput.checked && !accountId) {
      const ledger = computeLedger(account);
      if (!ledger.rows.length && Math.abs(ledger.opening) < AMOUNT_EPSILON) return false;
    }
    return true;
  });
}

function renderLedger() {
  ledgerCache = new Map();
  const from = fromInput.value;
  const to = toInput.value;
  if (from && to && from > to) {
    toastError("วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด");
    return;
  }
  const accounts = filteredAccounts();
  $("ledger-summary").innerHTML = "";
  if (!accounts.length) {
    ledgerContainer.innerHTML = state.accounts.length
      ? '<div class="empty-state"><strong>ไม่พบบัญชี</strong>ลองยกเลิก “ซ่อนบัญชีที่ไม่มีความเคลื่อนไหว” หรือเปลี่ยนตัวกรอง</div>'
      : '<div class="empty-state"><strong>ยังไม่มีผังบัญชี</strong><a class="btn" href="../accounts/accounts.html">สร้างผังบัญชี</a></div>';
    return;
  }
  const openAll = accounts.length === 1;
  ledgerContainer.innerHTML = getLedgerGroups(accounts).map((group) =>
    `<section class="ledger-group"><div class="ledger-group-head"><h3><span class="badge type-${esc(group.type)}">${esc(group.label)}</span></h3><span>${fmtInt(group.accounts.length)} บัญชี</span></div>
      <div class="ledger-group-accounts">${group.accounts.map((account) => renderAccount(account, openAll)).join("")}</div></section>`,
  ).join("");
  $("ledger-toggle-all").textContent = openAll ? "ย่อทั้งหมด" : "ขยายทั้งหมด";
}

// Lazily render the posting table when an account is expanded.
ledgerContainer.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.open) return;
  const body = details.querySelector(".ledger-body");
  if (body.childElementCount) return;
  const account = state.accounts.find((item) => item.id === details.dataset.accountId);
  if (account) body.innerHTML = renderAccountBody(account);
}, true);

function renderFilters() {
  const groups = getLedgerGroups(state.accounts);
  const currentType = typeSelect.value;
  const currentAccount = accountSelect.value;
  typeSelect.innerHTML = '<option value="">ทุกหมวด</option>' + groups.map((group) => `<option value="${esc(group.type)}">${esc(group.label)}</option>`).join("");
  typeSelect.value = groups.some((group) => group.type === currentType) ? currentType : "";
  const availableGroups = typeSelect.value ? groups.filter((group) => group.type === typeSelect.value) : groups;
  const accounts = availableGroups.flatMap((group) => group.accounts);
  accountSelect.innerHTML = `<option value="">${typeSelect.value ? "ทุกบัญชีในหมวดนี้" : "ทุกบัญชี"}</option>` +
    availableGroups.map((group) => `<optgroup label="${esc(group.label)}">${group.accounts.map((account) => `<option value="${esc(account.id)}">${esc(account.code)} · ${esc(account.name)}</option>`).join("")}</optgroup>`).join("");
  accountSelect.value = accounts.some((account) => account.id === currentAccount) ? currentAccount : "";
  renderLedger();
}

$("ledger-toggle-all").addEventListener("click", () => {
  const items = [...ledgerContainer.querySelectorAll("details.ledger-account")];
  const shouldOpen = items.some((item) => !item.open);
  if (shouldOpen && items.length > 60) toastSuccess(`กำลังขยาย ${fmtInt(items.length)} บัญชี`);
  items.forEach((item) => { item.open = shouldOpen; });
  $("ledger-toggle-all").textContent = shouldOpen ? "ย่อทั้งหมด" : "ขยายทั้งหมด";
});

$("ledger-export").addEventListener("click", () => {
  const accounts = filteredAccounts().sort(compareAccounts);
  const rows = [];
  accounts.forEach((account) => {
    const ledger = computeLedger(account);
    if (fromInput.value) rows.push([account.code, account.name, fmtDateDMY(fromInput.value), "", "ยอดยกมา", "", "", ledger.opening]);
    ledger.rows.forEach((row) => rows.push([account.code, account.name, fmtDateDMY(row.entry.date), row.entry.docNo || "", row.entry.desc || "", row.debit, row.credit, row.balanceAfter]));
  });
  if (!rows.length) return toastError("ไม่มีข้อมูลให้ส่งออก");
  downloadCsvFile(`ledger-${fileStamp()}.csv`, toCsv(["รหัสบัญชี", "ชื่อบัญชี", "วันที่", "เลขที่เอกสาร", "รายละเอียด", "เดบิต", "เครดิต", "คงเหลือ (ด้านปกติ)"], rows));
  toastSuccess("ส่งออกบัญชีแยกประเภทเรียบร้อย");
});

typeSelect.addEventListener("change", renderFilters);
accountSelect.addEventListener("change", renderLedger);
fromInput.addEventListener("change", renderLedger);
toInput.addEventListener("change", renderLedger);
hideEmptyInput.addEventListener("change", renderLedger);
searchInput.addEventListener("input", debounce(renderLedger, 200));

if (await load(["accounts", "entries"])) {
  onDataRefresh(() => {
    buildIndex();
    renderFilters();
  });
  buildIndex();
  const preset = new URLSearchParams(location.search).get("account");
  renderFilters();
  if (preset && state.accounts.some((account) => account.id === preset)) {
    accountSelect.value = preset;
    renderLedger();
  }
}

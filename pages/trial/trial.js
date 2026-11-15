/**
 * @file หน้า "งบทดลอง" — ตรวจว่ายอดคงเหลือด้านเดบิตรวมเท่ากับด้านเครดิตรวม ณ วันที่ที่เลือก
 *
 * ค่าเริ่มต้น: ยอดคงเหลือนับเฉพาะรายการในช่วง "ตั้งแต่–ถึง" (เดือนล่าสุด) ไม่รวมยอดยกมา
 * ติ๊ก "รวมยอดยกมา": บัญชีงบดุลแสดงยอดสะสมถึงวันสิ้นช่วง, บัญชีรายได้/ค่าใช้จ่ายแสดงเฉพาะในช่วง
 * และกำไรก่อนช่วงถูกรวมไว้ในบัญชีกำไรสะสม (ดู sumBalancesForPeriod)
 */
import { loadData, onDataRefresh, state } from "../../src/core/store.js";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "../../src/accounting/constants.js";
import { compareAccounts, findAccountForRole } from "../../src/accounting/accounts.js";
import { buildTrialBalance, getAccountMovement, sumBalancesForPeriod } from "../../src/accounting/statements.js";
import { notifySuccess } from "../../src/components/notifications.js";
import { createMonthFilter, getInitialMonthRange } from "../../src/components/month-filter.js";
import { buildCsv } from "../../src/utils/csv.js";
import { getFileDateStamp } from "../../src/utils/date.js";
import { byId } from "../../src/utils/dom.js";
import { downloadCsv } from "../../src/utils/download.js";
import { escapeHtml, formatDate, formatMoney, formatNumber } from "../../src/utils/format.js";

const fromDateInput = byId("trial-from");
const asOfDateInput = byId("trial-to");
const includeOpeningCheckbox = byId("trial-include-opening");
const groupByTypeCheckbox = byId("trial-group");
const showMovementCheckbox = byId("trial-movement");

/** คำนวณงบทดลองตามช่วงวันที่ที่เลือก (ยอดเคลื่อนไหว = เฉพาะในช่วง) */
function calculateTrialBalance() {
  const retainedAccount = findAccountForRole("retained");
  const { balances, periodMovements, carriedProfit } = sumBalancesForPeriod(state.accounts, state.entries, {
    from: fromDateInput.value,
    to: asOfDateInput.value,
    retainedAccountId: retainedAccount ? retainedAccount.id : "",
  });
  const sortedAccounts = state.accounts.slice().sort(compareAccounts);
  // ไม่รวมยอดยกมา = ใช้เฉพาะรายการในช่วง (รายการทุกรายการดุลในตัว งบทดลองจึงยังดุล)
  const includeOpening = includeOpeningCheckbox.checked || !fromDateInput.value;
  const trialBalance = buildTrialBalance(sortedAccounts, includeOpening ? balances : periodMovements);
  trialBalance.rows.forEach((row) => {
    const movement = getAccountMovement(periodMovements, row.account.id);
    row.debit = movement.debit;
    row.credit = movement.credit;
  });
  return { ...trialBalance, carriedProfit, retainedAccount, includeOpening };
}

/** คำบรรยายช่วงวันที่ */
function describeRange() {
  const from = fromDateInput.value;
  const to = asOfDateInput.value;
  if (!from && !to) return "ณ ปัจจุบัน (ทุกรายการ)";
  if (!from) return `ณ วันที่ ${formatDate(to)}`;
  return `ตั้งแต่ ${formatDate(from)} ถึง ${to ? formatDate(to) : "ปัจจุบัน"}`;
}

/** แสดงตัวเลข หรือช่องว่างเมื่อเป็นศูนย์ (งบทดลองนิยมเว้นว่างแทนการใส่ 0.00) */
const formatAmountOrBlank = (amount) => (amount ? formatMoney(amount) : "");

function renderAccountRow(row, showMovement) {
  const isZeroBalance = !row.balanceDebit && !row.balanceCredit;
  const movementCells = showMovement
    ? `<td class="right muted">${formatAmountOrBlank(row.debit)}</td><td class="right muted">${formatAmountOrBlank(row.credit)}</td>`
    : "";
  return `<tr>
    <td class="code">${escapeHtml(row.account.code)}</td>
    <td><a href="../ledger/ledger.html?account=${encodeURIComponent(row.account.id)}" title="ดูบัญชีแยกประเภท">${escapeHtml(row.account.name)}</a></td>
    ${movementCells}
    <td class="right">${formatAmountOrBlank(row.balanceDebit)}</td>
    <td class="right">${formatAmountOrBlank(row.balanceCredit)}</td>
    <td>${isZeroBalance ? '<span class="badge">ยอดเป็นศูนย์</span>' : ""}</td>
  </tr>`;
}

/** แถวของตาราง: จัดกลุ่มตามหมวดบัญชี พร้อมยอดรวมของแต่ละหมวด */
function renderGroupedRows(rows, showMovement, columnCount) {
  const extraTypes = rows.map((row) => row.account.type).filter((type) => !ACCOUNT_TYPE_ORDER.includes(type));
  const accountTypes = [...ACCOUNT_TYPE_ORDER, ...new Set(extraTypes)];
  return accountTypes.map((accountType) => {
    const groupRows = rows.filter((row) => row.account.type === accountType);
    if (!groupRows.length) return "";
    const groupDebit = groupRows.reduce((total, row) => total + row.balanceDebit, 0);
    const groupCredit = groupRows.reduce((total, row) => total + row.balanceCredit, 0);
    const typeLabel = ACCOUNT_TYPE_LABELS[accountType] || "อื่น ๆ";
    return `<tr class="group-head"><td colspan="${columnCount}"><span class="badge type-${escapeHtml(accountType)}">${escapeHtml(typeLabel)}</span></td></tr>
      ${groupRows.map((row) => renderAccountRow(row, showMovement)).join("")}
      <tr class="subtotal"><td></td><td>รวม${escapeHtml(ACCOUNT_TYPE_LABELS[accountType] || "")}</td>${showMovement ? "<td></td><td></td>" : ""}
        <td class="right">${formatAmountOrBlank(groupDebit)}</td><td class="right">${formatAmountOrBlank(groupCredit)}</td><td></td></tr>`;
  }).join("");
}

function renderTrialBalance() {
  const container = byId("trial-view");
  if (!state.accounts.length) {
    container.innerHTML = '<div class="empty-state"><strong>ยังไม่มีผังบัญชี</strong><a class="btn" href="../accounts/accounts.html">สร้างผังบัญชี</a></div>';
    return;
  }

  if (fromDateInput.value && asOfDateInput.value && fromDateInput.value > asOfDateInput.value) {
    container.innerHTML = '<div class="banner bad">วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด</div>';
    return;
  }
  const { rows, totalDebit, totalCredit, isBalanced, carriedProfit, retainedAccount, includeOpening } = calculateTrialBalance();
  const showMovement = showMovementCheckbox.checked;
  const columnCount = showMovement ? 7 : 5;
  const asOfLabel = describeRange();
  let carriedNote = "";
  if (fromDateInput.value && !includeOpening) {
    carriedNote = '<p class="table-meta">ยอดคงเหลือนับเฉพาะรายการในช่วงที่เลือก (ไม่รวมยอดยกมา) · ติ๊ก “รวมยอดยกมา” เพื่อดูยอดสะสม</p>';
  } else if (fromDateInput.value && retainedAccount) {
    const carriedText = Math.abs(carriedProfit) > 0.005
      ? ` · ${carriedProfit >= 0 ? "กำไร" : "ขาดทุน"}ก่อนช่วง ${formatMoney(Math.abs(carriedProfit))} รวมอยู่ใน${escapeHtml(retainedAccount.name)}`
      : "";
    carriedNote = `<p class="table-meta">บัญชีงบดุลแสดงยอดสะสมถึงวันสิ้นช่วง · รายได้/ค่าใช้จ่ายแสดงเฉพาะในช่วง${carriedText}</p>`;
  } else if (fromDateInput.value) {
    carriedNote = '<p class="table-meta unbalanced">ไม่พบบัญชีกำไรสะสม จึงแสดงยอดคงเหลือสะสมทั้งหมด (ยอดเคลื่อนไหวยังเป็นเฉพาะในช่วง)</p>';
  }

  let bodyHtml;
  if (!rows.length) bodyHtml = `<tr><td colspan="${columnCount}" class="muted">ยังไม่มียอดคงเหลือ</td></tr>`;
  else if (groupByTypeCheckbox.checked) bodyHtml = renderGroupedRows(rows, showMovement, columnCount);
  else bodyHtml = rows.map((row) => renderAccountRow(row, showMovement)).join("");

  const totalClass = isBalanced ? "balanced" : "unbalanced";
  const statusText = isBalanced
    ? `ยอดเดบิตและเครดิตเท่ากัน ${formatMoney(totalDebit)}`
    : `ผลต่าง ${formatMoney(Math.abs(totalDebit - totalCredit))} — ตรวจสอบรายการที่บันทึกในสมุดรายวัน`;
  const movementHeaders = showMovement
    ? '<th class="right col-amount">ยอดเคลื่อนไหวเดบิต</th><th class="right col-amount">ยอดเคลื่อนไหวเครดิต</th>'
    : "";

  container.innerHTML = `
    <div class="banner ${isBalanced ? "ok" : "bad"}">
      <strong>${isBalanced ? "✓ งบทดลองดุล" : "✕ งบทดลองไม่ดุล"}</strong>
      <span>${statusText}</span>
      <span style="margin-left:auto" class="muted">${formatNumber(rows.length)} บัญชี · ${escapeHtml(asOfLabel)}</span>
    </div>
    <div class="report" style="margin-bottom:0">
      <div class="report-head"><div class="company">${escapeHtml(state.settings.company || "กิจการของฉัน")}</div><h3>งบทดลอง</h3><div class="muted">${escapeHtml(asOfLabel)}</div></div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th class="col-code">รหัส</th><th>ชื่อบัญชี</th>${movementHeaders}<th class="center col-amount">เดบิต</th><th class="right col-amount">เครดิต</th><th class="col-actions"></th></tr></thead>
        <tbody>${bodyHtml}</tbody>
        <tfoot><tr class="grand-total"><td colspan="${showMovement ? 4 : 2}"><strong>รวม</strong></td><td class="right ${totalClass}"><strong>${formatMoney(totalDebit)}</strong></td><td class="right ${totalClass}"><strong>${formatMoney(totalCredit)}</strong></td><td></td></tr></tfoot>
      </table></div>
    </div>
    ${carriedNote}`;
}

function exportCsv() {
  const { rows, totalDebit, totalCredit } = calculateTrialBalance();
  const headers = ["รหัส", "ชื่อบัญชี", "หมวด", "เคลื่อนไหวเดบิต", "เคลื่อนไหวเครดิต", "ยอดคงเหลือเดบิต", "ยอดคงเหลือเครดิต"];
  const csvRows = rows.map((row) => [
    row.account.code, row.account.name, ACCOUNT_TYPE_LABELS[row.account.type] || row.account.type || "",
    row.debit, row.credit, row.balanceDebit, row.balanceCredit,
  ]);
  csvRows.push(["", "รวม", "", "", "", totalDebit, totalCredit]);
  downloadCsv(`trial-balance-${getFileDateStamp()}.csv`, buildCsv(headers, csvRows));
  notifySuccess("ส่งออกงบทดลองเรียบร้อย");
}

byId("trial-export").addEventListener("click", exportCsv);
[fromDateInput, asOfDateInput, includeOpeningCheckbox, groupByTypeCheckbox, showMovementCheckbox].forEach((input) => input.addEventListener("change", renderTrialBalance));

if (await loadData(["accounts", "entries"])) {
  const monthFilter = createMonthFilter({
    fromInput: fromDateInput,
    toInput: asOfDateInput,
    getRecords: () => state.entries,
    onSelect: renderTrialBalance,
  });
  // ค่าเริ่มต้น: เดือนล่าสุดที่มีรายการ
  // เดือนที่เลือกไว้ในหน้าอื่น (ถ้ามี) ไม่เช่นนั้นเดือนล่าสุดที่มีรายการ
  const latestMonth = getInitialMonthRange(state.entries);
  fromDateInput.value = latestMonth.from;
  asOfDateInput.value = latestMonth.to;
  renderTrialBalance();
  onDataRefresh(() => {
    monthFilter.refresh();
    renderTrialBalance();
  });
}

/**
 * @file หน้า "กระดาษทำการ" (Worksheet 6 ช่อง)
 *
 * คอลัมน์: ชื่อบัญชี | เลขที่ | งบทดลอง | งบกำไรขาดทุน | งบดุล (แต่ละงบมีช่องเดบิต/เครดิต)
 * - ช่อง "งบทดลอง" รวมทั้งรายการทั่วไปและรายการปรับปรุงแล้ว (ยอดหลังปรับปรุง)
 *   เพื่อให้งบกำไรขาดทุนและงบดุลที่แยกออกมากระทบยอดกันได้
 * - บัญชีรายได้/ค่าใช้จ่ายไปช่องงบกำไรขาดทุน ที่เหลือไปช่องงบดุล
 * - ไม่นำรายการปิดบัญชีมาแสดง (กระดาษทำการจัดทำก่อนปิดบัญชี)
 * - ค่าเริ่มต้น: นับเฉพาะรายการในช่วง "ตั้งแต่–ถึง" (เดือนล่าสุด) ไม่รวมยอดยกมา
 * - ติ๊ก "รวมยอดยกมา": บัญชีงบดุลเป็นยอดสะสม รายได้/ค่าใช้จ่ายนับเฉพาะในช่วง
 *   กำไรก่อนช่วงรวมไว้ในกำไรสะสม (ดู sumBalancesForPeriod)
 */
import { loadData, onDataRefresh, state } from "../../src/core/store.js";
import { AMOUNT_EPSILON } from "../../src/accounting/constants.js";
import { compareAccounts, findAccountForRole } from "../../src/accounting/accounts.js";
import { getAccountMovement, sumBalancesForPeriod } from "../../src/accounting/statements.js";
import { notifySuccess } from "../../src/components/notifications.js";
import { createMonthFilter, getInitialMonthRange } from "../../src/components/month-filter.js";
import { buildCsv } from "../../src/utils/csv.js";
import { getFileDateStamp } from "../../src/utils/date.js";
import { byId } from "../../src/utils/dom.js";
import { downloadCsv } from "../../src/utils/download.js";
import { escapeHtml, formatDate, formatMoney } from "../../src/utils/format.js";
import { watchDocumentNumbers } from "../../src/components/document-number-alert.js";

const fromDateInput = byId("worksheet-from");
const asOfDateInput = byId("worksheet-to");
const includeOpeningCheckbox = byId("worksheet-include-opening");

/**
 * คอลัมน์ตัวเลขของกระดาษทำการ เรียงตามลำดับที่แสดง (คู่ละ เดบิต/เครดิต)
 * ใช้ร่วมกันทั้งการวาดตาราง การรวมยอด และการส่งออก CSV
 */
const AMOUNT_COLUMNS = [
  { key: "trialDebit", csvLabel: "งบทดลอง Dr" },
  { key: "trialCredit", csvLabel: "งบทดลอง Cr" },
  { key: "incomeDebit", csvLabel: "งบกำไรขาดทุน Dr" },
  { key: "incomeCredit", csvLabel: "งบกำไรขาดทุน Cr" },
  { key: "balanceSheetDebit", csvLabel: "งบดุล Dr" },
  { key: "balanceSheetCredit", csvLabel: "งบดุล Cr" },
];

/** จำนวนคอลัมน์ข้อความด้านซ้าย (ชื่อบัญชี, เลขที่) */
const LABEL_COLUMN_COUNT = 2;

/**
 * แยกยอด (เดบิต - เครดิต) ออกเป็นช่องเดบิตหรือช่องเครดิต
 * @param {number} debitMinusCredit
 * @returns {{ debit: number, credit: number }}
 */
function splitDebitCredit(debitMinusCredit) {
  return {
    debit: debitMinusCredit > AMOUNT_EPSILON ? debitMinusCredit : 0,
    credit: debitMinusCredit < -AMOUNT_EPSILON ? -debitMinusCredit : 0,
  };
}

/** คำนวณทุกแถวของกระดาษทำการ พร้อมยอดรวมแต่ละคอลัมน์และกำไรสุทธิ */
function calculateWorksheet() {
  // รายการทั่วไป + รายการปรับปรุง (ไม่รวมรายการปิดบัญชี)
  const retainedAccount = findAccountForRole("retained");
  const { balances, periodMovements, carriedProfit } = sumBalancesForPeriod(state.accounts, state.entries, {
    from: fromDateInput.value,
    to: asOfDateInput.value,
    excludeKinds: ["closing"],
    retainedAccountId: retainedAccount ? retainedAccount.id : "",
  });
  // ไม่รวมยอดยกมา = ใช้เฉพาะรายการในช่วง
  const includeOpening = includeOpeningCheckbox.checked || !fromDateInput.value;
  const movements = includeOpening ? balances : periodMovements;
  const totals = Object.fromEntries(AMOUNT_COLUMNS.map((column) => [column.key, 0]));
  const rows = [];

  state.accounts.slice().sort(compareAccounts).forEach((account) => {
    const movement = getAccountMovement(movements, account.id);
    if (!movement.debit && !movement.credit) return;

    const trialBalance = splitDebitCredit(movement.debit - movement.credit);
    const isIncomeStatementAccount = account.type === "revenue" || account.type === "expense";
    const row = {
      account,
      trialDebit: trialBalance.debit,
      trialCredit: trialBalance.credit,
      incomeDebit: isIncomeStatementAccount ? trialBalance.debit : 0,
      incomeCredit: isIncomeStatementAccount ? trialBalance.credit : 0,
      balanceSheetDebit: isIncomeStatementAccount ? 0 : trialBalance.debit,
      balanceSheetCredit: isIncomeStatementAccount ? 0 : trialBalance.credit,
    };
    AMOUNT_COLUMNS.forEach(({ key }) => { totals[key] += row[key]; });
    rows.push(row);
  });

  const netProfit = totals.incomeCredit - totals.incomeDebit;
  return { rows, totals, netProfit, carriedProfit, retainedAccount, includeOpening };
}

/** เซลล์ตัวเลข (ว่างเมื่อเป็นศูนย์) — คอลัมน์เดบิตมีเส้นแบ่งด้านซ้ายเพื่อแยกแต่ละงบ */
function renderAmountCell(amount, columnIndex) {
  const bandClass = columnIndex % 2 === 0 ? " band" : "";
  return `<td class="right${bandClass}">${amount ? formatMoney(amount) : ""}</td>`;
}

function renderWorksheet() {
  const container = byId("worksheet-view");
  if (!state.accounts.length) {
    container.innerHTML = '<div class="empty-state"><strong>ยังไม่มีผังบัญชี</strong><a class="btn" href="../accounts/accounts.html">สร้างผังบัญชี</a></div>';
    return;
  }

  if (fromDateInput.value && asOfDateInput.value && fromDateInput.value > asOfDateInput.value) {
    container.innerHTML = '<div class="banner bad">วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด</div>';
    return;
  }
  const { rows, totals, netProfit, carriedProfit, retainedAccount, includeOpening } = calculateWorksheet();
  const from = fromDateInput.value;
  const to = asOfDateInput.value;
  let rangeText = to ? `ณ วันที่ ${formatDate(to)}` : "รวมทุกรายการ";
  if (from) rangeText = `ตั้งแต่ ${formatDate(from)} ถึง ${to ? formatDate(to) : "ปัจจุบัน"}`;
  let carriedText = "";
  if (from && !includeOpening) carriedText = " · เฉพาะรายการในช่วง (ไม่รวมยอดยกมา)";
  else if (from && retainedAccount && Math.abs(carriedProfit) > AMOUNT_EPSILON) {
    carriedText = ` · ${carriedProfit >= 0 ? "กำไร" : "ขาดทุน"}ก่อนช่วง ${formatMoney(Math.abs(carriedProfit))} รวมอยู่ใน${retainedAccount.name}`;
  }
  const isTrialBalanced = Math.abs(totals.trialDebit - totals.trialCredit) < AMOUNT_EPSILON;
  // กำไร: ใส่ฝั่งเดบิตของงบกำไรขาดทุน และฝั่งเครดิตของงบดุล (ขาดทุนกลับกัน)
  const profitAmount = Math.max(0, netProfit);
  const lossAmount = Math.max(0, -netProfit);
  const blankIfZero = (amount) => (amount ? formatMoney(amount) : "");
  // แถวสรุปด้านล่างเริ่มที่คอลัมน์งบกำไรขาดทุน: ข้ามชื่อบัญชี เลขที่ และงบทดลอง 2 ช่อง
  const summaryLabelSpan = LABEL_COLUMN_COUNT + 2;

  const bodyHtml = rows.map((row) => `<tr>
    <td>${escapeHtml(row.account.name)}</td><td class="code center">${escapeHtml(row.account.code)}</td>
    ${AMOUNT_COLUMNS.map((column, index) => renderAmountCell(row[column.key], index)).join("")}
  </tr>`).join("") || `<tr><td colspan="${LABEL_COLUMN_COUNT + AMOUNT_COLUMNS.length}" class="muted">ยังไม่มียอดคงเหลือ</td></tr>`;
  const totalCells = AMOUNT_COLUMNS.map((column, index) =>
    `<th class="right${index % 2 === 0 ? " band" : ""}">${formatMoney(totals[column.key])}</th>`).join("");

  container.innerHTML = `
    <div class="banner ${isTrialBalanced ? "ok" : "bad"}">
      <span>${isTrialBalanced ? "✓ งบทดลองดุล" : "✕ งบทดลองไม่ดุล"}</span>
      <span style="margin-left:auto"><strong>${netProfit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"} ${formatMoney(Math.abs(netProfit))}</strong></span>
    </div>
    <div class="table-wrap tall"><table class="worksheet-table" style="min-width:960px">
      <thead>
        <tr><th rowspan="2">ชื่อบัญชี</th><th rowspan="2" class="col-code center">เลขที่</th><th colspan="2" class="band">งบทดลอง</th><th colspan="2" class="band">งบกำไรขาดทุน</th><th colspan="2" class="band">งบดุล</th></tr>
        <tr>${'<th class="center band">เดบิต</th><th class="center">เครดิต</th>'.repeat(AMOUNT_COLUMNS.length / 2)}</tr>
      </thead>
      <tbody>${bodyHtml}</tbody>
      <tfoot>
        <tr><th colspan="${LABEL_COLUMN_COUNT}">รวม</th>${totalCells}</tr>
        <tr><th colspan="${summaryLabelSpan}">${netProfit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}</th>
          <th class="right band">${blankIfZero(profitAmount)}</th><th class="right">${blankIfZero(lossAmount)}</th>
          <th class="right band">${blankIfZero(lossAmount)}</th><th class="right">${blankIfZero(profitAmount)}</th></tr>
        <tr><th colspan="${summaryLabelSpan}">รวมทั้งสิ้น</th>
          <th class="right band">${formatMoney(totals.incomeDebit + profitAmount)}</th><th class="right">${formatMoney(totals.incomeCredit + lossAmount)}</th>
          <th class="right band">${formatMoney(totals.balanceSheetDebit + lossAmount)}</th><th class="right">${formatMoney(totals.balanceSheetCredit + profitAmount)}</th></tr>
      </tfoot>
    </table></div>
    <p class="table-meta">${escapeHtml(rangeText + carriedText)} · งบทดลองรวมรายการปรับปรุงแล้ว · ไม่รวมรายการปิดบัญชี</p>`;
}

function exportCsv() {
  const { rows, totals } = calculateWorksheet();
  const headers = ["ชื่อบัญชี", "เลขที่", ...AMOUNT_COLUMNS.map((column) => column.csvLabel)];
  const csvRows = rows.map((row) => [row.account.name, row.account.code, ...AMOUNT_COLUMNS.map((column) => row[column.key])]);
  csvRows.push(["รวม", "", ...AMOUNT_COLUMNS.map((column) => totals[column.key])]);
  downloadCsv(`worksheet-${getFileDateStamp()}.csv`, buildCsv(headers, csvRows));
  notifySuccess("ส่งออกกระดาษทำการเรียบร้อย");
}

byId("worksheet-export").addEventListener("click", exportCsv);
[fromDateInput, asOfDateInput, includeOpeningCheckbox].forEach((input) => input.addEventListener("change", renderWorksheet));

if (await loadData(["accounts", "entries"])) {
  watchDocumentNumbers();
  const monthFilter = createMonthFilter({
    fromInput: fromDateInput,
    toInput: asOfDateInput,
    getRecords: () => state.entries,
    onSelect: renderWorksheet,
  });
  // ค่าเริ่มต้น: เดือนล่าสุดที่มีรายการ
  // เดือนที่เลือกไว้ในหน้าอื่น (ถ้ามี) ไม่เช่นนั้นเดือนล่าสุดที่มีรายการ
  const latestMonth = getInitialMonthRange(state.entries);
  fromDateInput.value = latestMonth.from;
  asOfDateInput.value = latestMonth.to;
  renderWorksheet();
  onDataRefresh(() => {
    monthFilter.refresh();
    renderWorksheet();
  });
}

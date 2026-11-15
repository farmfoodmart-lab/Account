/**
 * @file หน้า "งบการเงิน" — งบกำไรขาดทุน และงบแสดงฐานะการเงิน (งบดุล)
 *
 * หลักการคำนวณ
 * - งบกำไรขาดทุน: ยอดเคลื่อนไหว "ภายในงวด" ที่เลือก ไม่รวมรายการปิดบัญชี
 * - งบดุล: ยอดสะสม "ตั้งแต่ต้นจนถึงวันสิ้นงวด" (งบ ณ วันที่)
 *   รายได้/ค่าใช้จ่ายที่ยังไม่ได้ปิดเข้าทุน แสดงเป็น "กำไร (ขาดทุน) ที่ยังไม่ได้ปิดบัญชี" ในส่วนของเจ้าของ
 */
import { loadData, onDataRefresh, state } from "../../src/core/store.js";
import { AMOUNT_EPSILON } from "../../src/accounting/constants.js";
import { compareAccounts } from "../../src/accounting/accounts.js";
import { buildBalanceSheet, buildIncomeStatement, sumMovementsByAccount } from "../../src/accounting/statements.js";
import { notifyError, notifySuccess } from "../../src/components/notifications.js";
import { buildCsv } from "../../src/utils/csv.js";
import { formatIsoDate, getFileDateStamp, getTodayIso } from "../../src/utils/date.js";
import { createMonthFilter, getInitialMonthRange } from "../../src/components/month-filter.js";
import { byId } from "../../src/utils/dom.js";
import { downloadCsv } from "../../src/utils/download.js";
import { escapeHtml, formatAccounting, formatDate, formatMoney } from "../../src/utils/format.js";

const startDateInput = byId("report-start-date");
const endDateInput = byId("report-end-date");

/** ช่วงวันที่ของรายงานที่แสดงอยู่ */
const reportPeriod = { from: "", to: "" };

/** คำบรรยายช่วงเวลาใต้หัวงบกำไรขาดทุน */
function describePeriod() {
  if (!reportPeriod.from && !reportPeriod.to) return "สำหรับทุกรายการที่บันทึก";
  const fromText = reportPeriod.from ? formatDate(reportPeriod.from) : "เริ่มต้น";
  const toText = reportPeriod.to ? formatDate(reportPeriod.to) : "ปัจจุบัน";
  return `สำหรับงวด ${fromText} ถึง ${toText}`;
}

/** คำบรรยายวันที่ใต้หัวงบดุล */
function describeAsOfDate() {
  return reportPeriod.to ? `ณ วันที่ ${formatDate(reportPeriod.to)}` : "ณ ปัจจุบัน";
}

/** คำนวณงบทั้งสองตามช่วงวันที่ปัจจุบัน */
function calculateStatements() {
  const accounts = state.accounts.slice().sort(compareAccounts);
  const periodMovements = sumMovementsByAccount(state.entries, { ...reportPeriod, excludeKinds: ["closing"] });
  const incomeStatement = buildIncomeStatement(accounts, periodMovements);

  const cumulativeMovements = sumMovementsByAccount(state.entries, { to: reportPeriod.to });
  const unclosedProfit = buildIncomeStatement(accounts, cumulativeMovements).profit;
  const balanceSheet = buildBalanceSheet(accounts, cumulativeMovements, unclosedProfit);
  return { incomeStatement, balanceSheet };
}

/** สัดส่วนต่อรายได้รวม เช่น "27.5%" */
function formatPercentOf(amount, baseAmount) {
  if (Math.abs(baseAmount) < AMOUNT_EPSILON) return "";
  return `${((amount / baseAmount) * 100).toFixed(1)}%`;
}

/**
 * แถวรายการบัญชีในงบ (ข้ามบัญชีที่ยอดเป็นศูนย์)
 * @param {Array<{ account: object, amount: number }>} rows
 * @param {number} [revenueBase] ถ้าระบุ จะแสดงคอลัมน์ % ของรายได้
 */
function renderStatementLines(rows, revenueBase) {
  return rows
    .filter((row) => Math.abs(row.amount) > AMOUNT_EPSILON)
    .map((row) => {
      const percentCell = revenueBase != null ? `<td class="right pct">${formatPercentOf(row.amount, revenueBase)}</td>` : "";
      return `<tr><td class="indent"><span class="code">${escapeHtml(row.account.code)}</span> ${escapeHtml(row.account.name)}</td><td class="right">${formatAccounting(row.amount)}</td>${percentCell}</tr>`;
    })
    .join("");
}

function renderIncomeStatement(incomeStatement) {
  const revenueBase = incomeStatement.totalRevenue;
  const isProfit = incomeStatement.profit >= 0;
  return `
    <tr class="group-row"><td colspan="3">รายได้</td></tr>${renderStatementLines(incomeStatement.revenue, revenueBase)}
    <tr class="total-row"><td>รวมรายได้</td><td class="right">${formatAccounting(incomeStatement.totalRevenue)}</td><td class="right pct">${revenueBase ? "100.0%" : ""}</td></tr>
    <tr class="group-row"><td colspan="3">ค่าใช้จ่าย</td></tr>${renderStatementLines(incomeStatement.expense, revenueBase)}
    <tr class="total-row"><td>รวมค่าใช้จ่าย</td><td class="right">${formatAccounting(incomeStatement.totalExpense)}</td><td class="right pct">${formatPercentOf(incomeStatement.totalExpense, revenueBase)}</td></tr>
    <tr class="grand-total"><td>${isProfit ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}</td><td class="right ${isProfit ? "balanced" : "unbalanced"}">${formatAccounting(incomeStatement.profit)}</td><td class="right pct">${formatPercentOf(incomeStatement.profit, revenueBase)}</td></tr>`;
}

function renderBalanceSheet(balanceSheet) {
  return `
    <tr class="group-row"><td colspan="2">สินทรัพย์</td></tr>${renderStatementLines(balanceSheet.assets)}
    <tr class="grand-total"><td>รวมสินทรัพย์</td><td class="right">${formatAccounting(balanceSheet.totalAssets)}</td></tr>
    <tr class="group-row"><td colspan="2">หนี้สิน</td></tr>${renderStatementLines(balanceSheet.liabilities)}
    <tr class="total-row"><td>รวมหนี้สิน</td><td class="right">${formatAccounting(balanceSheet.totalLiabilities)}</td></tr>
    <tr class="group-row"><td colspan="2">ส่วนของเจ้าของ</td></tr>${renderStatementLines(balanceSheet.equity)}
    <tr><td class="indent">กำไร (ขาดทุน) ที่ยังไม่ได้ปิดบัญชี</td><td class="right">${formatAccounting(balanceSheet.profit)}</td></tr>
    <tr class="total-row"><td>รวมส่วนของเจ้าของ</td><td class="right">${formatAccounting(balanceSheet.totalEquity)}</td></tr>
    <tr class="grand-total"><td>รวมหนี้สินและส่วนของเจ้าของ</td><td class="right">${formatAccounting(balanceSheet.totalLiabilitiesAndEquity)}</td></tr>`;
}

function renderReports() {
  const container = byId("reports-view");
  if (!state.accounts.length) {
    container.innerHTML = '<div class="empty-state"><strong>ยังไม่มีผังบัญชี</strong>สร้างผังบัญชีและบันทึกรายการก่อนออกงบการเงิน</div>';
    return;
  }

  const { incomeStatement, balanceSheet } = calculateStatements();
  const hasActivity = incomeStatement.revenue.length || incomeStatement.expense.length
    || balanceSheet.assets.length || balanceSheet.liabilities.length || balanceSheet.equity.length;
  if (!hasActivity) {
    container.innerHTML = '<div class="empty-state"><strong>ไม่มีความเคลื่อนไหว</strong>ไม่มีรายการในช่วงเวลาที่เลือก</div>';
    return;
  }

  const companyName = escapeHtml(state.settings.company || "กิจการของฉัน");
  const currency = escapeHtml(state.settings.currency || "THB");
  const balanceNote = balanceSheet.isBalanced
    ? '<p class="hint balanced">✓ สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ</p>'
    : `<p class="hint unbalanced">✕ งบไม่สมดุล ต่างกัน ${formatMoney(Math.abs(balanceSheet.totalAssets - balanceSheet.totalLiabilitiesAndEquity))} — ตรวจสอบงบทดลอง</p>`;

  container.innerHTML = `<div class="report-grid">
    <div class="report">
      <div class="report-head"><div class="company">${companyName}</div><h3>งบกำไรขาดทุน</h3><div class="muted">${describePeriod()}</div></div>
      <table><thead><tr><th>รายการ</th><th class="right">จำนวนเงิน (${currency})</th><th class="right pct">% ของรายได้</th></tr></thead>
        <tbody>${renderIncomeStatement(incomeStatement)}</tbody></table>
      <p class="hint">ไม่รวมรายการปิดบัญชี · ตัวเลขในวงเล็บคือยอดติดลบ</p>
    </div>
    <div class="report">
      <div class="report-head"><div class="company">${companyName}</div><h3>งบแสดงฐานะการเงิน (งบดุล)</h3><div class="muted">${describeAsOfDate()}</div></div>
      <table><thead><tr><th>รายการ</th><th class="right">จำนวนเงิน (${currency})</th></tr></thead>
        <tbody>${renderBalanceSheet(balanceSheet)}</tbody></table>
      ${balanceNote}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* ช่วงเวลาสำเร็จรูป (เดือนนี้ / ไตรมาสนี้ / ปีนี้ / งวดบัญชี)            */
/* ------------------------------------------------------------------ */

/**
 * @param {"month" | "last-month" | "quarter" | "year" | "period" | "all"} presetName
 * @returns {{ from: string, to: string }}
 */
function getPresetPeriod(presetName) {
  const [year, month] = getTodayIso().split("-").map(Number);
  // new Date(year, monthIndex, 0) = วันสุดท้ายของเดือนก่อนหน้า monthIndex
  switch (presetName) {
    case "month":
      return { from: formatIsoDate(new Date(year, month - 1, 1)), to: formatIsoDate(new Date(year, month, 0)) };
    case "last-month":
      return { from: formatIsoDate(new Date(year, month - 2, 1)), to: formatIsoDate(new Date(year, month - 1, 0)) };
    case "quarter": {
      const quarterStartMonthIndex = Math.floor((month - 1) / 3) * 3;
      return {
        from: formatIsoDate(new Date(year, quarterStartMonthIndex, 1)),
        to: formatIsoDate(new Date(year, quarterStartMonthIndex + 3, 0)),
      };
    }
    case "year":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "period":
      return { from: state.settings.periodStart || "", to: state.settings.periodEnd || "" };
    default:
      return { from: "", to: "" };
  }
}

/** ตั้งช่วงวันที่ อัปเดตช่องกรอกและปุ่มที่เลือก แล้ววาดงบใหม่ */
function applyPeriod(period, activePresetName = "") {
  startDateInput.value = period.from;
  endDateInput.value = period.to;
  reportPeriod.from = period.from;
  reportPeriod.to = period.to;
  document.querySelectorAll("#report-presets [data-preset]").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.preset === activePresetName));
  });
  renderReports();
}

/* ------------------------------------------------------------------ */
/* ส่งออก CSV                                                           */
/* ------------------------------------------------------------------ */

function exportCsv() {
  const { incomeStatement, balanceSheet } = calculateStatements();
  const toRow = (row) => [`${row.account.code} ${row.account.name}`, row.amount];
  const rows = [
    ["งบกำไรขาดทุน", describePeriod()],
    ...incomeStatement.revenue.map(toRow),
    ["รวมรายได้", incomeStatement.totalRevenue],
    ...incomeStatement.expense.map(toRow),
    ["รวมค่าใช้จ่าย", incomeStatement.totalExpense],
    [incomeStatement.profit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ", incomeStatement.profit],
    ["", ""],
    ["งบแสดงฐานะการเงิน", describeAsOfDate()],
    ...balanceSheet.assets.map(toRow),
    ["รวมสินทรัพย์", balanceSheet.totalAssets],
    ...balanceSheet.liabilities.map(toRow),
    ["รวมหนี้สิน", balanceSheet.totalLiabilities],
    ...balanceSheet.equity.map(toRow),
    ["กำไร (ขาดทุน) ที่ยังไม่ได้ปิดบัญชี", balanceSheet.profit],
    ["รวมส่วนของเจ้าของ", balanceSheet.totalEquity],
    ["รวมหนี้สินและส่วนของเจ้าของ", balanceSheet.totalLiabilitiesAndEquity],
  ];
  downloadCsv(`financial-statements-${getFileDateStamp()}.csv`, buildCsv(["รายการ", "จำนวนเงิน"], rows));
  notifySuccess("ส่งออกงบการเงินเรียบร้อย");
}

/* ------------------------------------------------------------------ */
/* ผูกอีเวนต์                                                           */
/* ------------------------------------------------------------------ */

byId("report-presets").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-preset]");
  if (!chip) return;
  const presetName = chip.dataset.preset;
  if (presetName === "period" && !state.settings.periodStart && !state.settings.periodEnd) {
    notifyError("ยังไม่ได้กำหนดงวดบัญชีในหน้าการตั้งค่า");
    return;
  }
  applyPeriod(getPresetPeriod(presetName), presetName);
});

byId("report-apply-filter").addEventListener("click", () => {
  const from = startDateInput.value;
  const to = endDateInput.value;
  if (from && to && from > to) {
    notifyError("วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด");
    return;
  }
  applyPeriod({ from, to });
});

byId("report-clear-filter").addEventListener("click", () => applyPeriod({ from: "", to: "" }, "all"));
byId("report-export").addEventListener("click", exportCsv);

/** ช่วงนี้ตรงกับปุ่ม "เดือนนี้" / "เดือนก่อน" หรือไม่ (ใช้ไฮไลต์ปุ่ม) */
function findMatchingPreset(period) {
  return ["month", "last-month"].find((presetName) => {
    const presetPeriod = getPresetPeriod(presetName);
    return presetPeriod.from === period.from && presetPeriod.to === period.to;
  }) || "";
}

if (await loadData(["accounts", "entries"])) {
  const monthFilter = createMonthFilter({
    fromInput: startDateInput,
    toInput: endDateInput,
    getRecords: () => state.entries,
    onSelect: (period) => applyPeriod(period, findMatchingPreset(period)),
  });
  // ค่าเริ่มต้น: เดือนล่าสุดที่มีรายการ (ถ้าตรงกับเดือนนี้ ปุ่ม "เดือนนี้" จะถูกเลือกด้วย)
  // เดือนที่เลือกไว้ในหน้าอื่น (ถ้ามี) ไม่เช่นนั้นเดือนล่าสุดที่มีรายการ
  const latestMonth = getInitialMonthRange(state.entries);
  applyPeriod(latestMonth, findMatchingPreset(latestMonth));
  onDataRefresh(() => {
    monthFilter.refresh();
    renderReports();
  });
}

import { AMOUNT_EPSILON, compareAccounts, esc, fmt, fmtAcc, fmtDateDMY, load, state, onDataRefresh } from "../../js/data.js";
import { buildBalanceSheet, buildIncomeStatement, collectTotals } from "../../js/reports.js";
import { downloadCsvFile, fileStamp, todayIso, toastError, toastSuccess } from "../../js/ui.js";
import { toCsv } from "../../js/csv.js";

const $ = (id) => document.getElementById(id);
const fromInput = $("report-start-date");
const toInput = $("report-end-date");
const reportDateRange = { from: "", to: "" };
let activePreset = "all";

function periodLabel() {
  if (!reportDateRange.from && !reportDateRange.to) return "สำหรับทุกรายการที่บันทึก";
  return `สำหรับงวด ${reportDateRange.from ? fmtDateDMY(reportDateRange.from) : "เริ่มต้น"} ถึง ${reportDateRange.to ? fmtDateDMY(reportDateRange.to) : "ปัจจุบัน"}`;
}

function asAtLabel() {
  return reportDateRange.to ? `ณ วันที่ ${fmtDateDMY(reportDateRange.to)}` : "ณ ปัจจุบัน";
}

/**
 * Income statement: movement inside the period, excluding closing entries.
 * Balance sheet: cumulative balances up to the period end (an "as at" statement),
 * with revenue/expense not yet closed to equity shown as current earnings.
 */
function reportData() {
  const accounts = state.accounts.slice().sort(compareAccounts);
  const periodTotals = collectTotals(state.entries, { ...reportDateRange, excludeKinds: ["closing"] });
  const income = buildIncomeStatement(accounts, periodTotals);
  const cumulativeTotals = collectTotals(state.entries, { to: reportDateRange.to });
  const unclosedProfit = buildIncomeStatement(accounts, cumulativeTotals).profit;
  const balance = buildBalanceSheet(accounts, cumulativeTotals, unclosedProfit);
  return { income, balance };
}

function pct(amount, base) {
  if (Math.abs(base) < AMOUNT_EPSILON) return "";
  return `${((amount / base) * 100).toFixed(1)}%`;
}

function lines(rows, base) {
  return rows
    .filter((row) => Math.abs(row.amount) > AMOUNT_EPSILON)
    .map((row) => `<tr><td class="indent"><span class="code">${esc(row.account.code)}</span> ${esc(row.account.name)}</td><td class="right">${fmtAcc(row.amount)}</td>${base != null ? `<td class="right pct">${pct(row.amount, base)}</td>` : ""}</tr>`)
    .join("");
}

function renderReports() {
  const container = $("reports-view");
  if (!state.accounts.length) {
    container.innerHTML = '<div class="empty-state"><strong>ยังไม่มีผังบัญชี</strong>สร้างผังบัญชีและบันทึกรายการก่อนออกงบการเงิน</div>';
    return;
  }
  const { income, balance } = reportData();
  const hasMovement = income.revenue.length || income.expense.length || balance.assets.length || balance.liabilities.length || balance.equity.length;
  if (!hasMovement) {
    container.innerHTML = '<div class="empty-state"><strong>ไม่มีความเคลื่อนไหว</strong>ไม่มีรายการในช่วงเวลาที่เลือก</div>';
    return;
  }

  const company = esc(state.settings.company || "กิจการของฉัน");
  const currency = esc(state.settings.currency || "THB");
  const base = income.totalRevenue;
  const incomeBody = `
    <tr class="group-row"><td colspan="3">รายได้</td></tr>${lines(income.revenue, base)}
    <tr class="total-row"><td>รวมรายได้</td><td class="right">${fmtAcc(income.totalRevenue)}</td><td class="right pct">${base ? "100.0%" : ""}</td></tr>
    <tr class="group-row"><td colspan="3">ค่าใช้จ่าย</td></tr>${lines(income.expense, base)}
    <tr class="total-row"><td>รวมค่าใช้จ่าย</td><td class="right">${fmtAcc(income.totalExpense)}</td><td class="right pct">${pct(income.totalExpense, base)}</td></tr>
    <tr class="grand-total"><td>${income.profit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}</td><td class="right ${income.profit >= 0 ? "balanced" : "unbalanced"}">${fmtAcc(income.profit)}</td><td class="right pct">${pct(income.profit, base)}</td></tr>`;

  const balanceBody = `
    <tr class="group-row"><td colspan="2">สินทรัพย์</td></tr>${lines(balance.assets)}
    <tr class="grand-total"><td>รวมสินทรัพย์</td><td class="right">${fmtAcc(balance.totalAssets)}</td></tr>
    <tr class="group-row"><td colspan="2">หนี้สิน</td></tr>${lines(balance.liabilities)}
    <tr class="total-row"><td>รวมหนี้สิน</td><td class="right">${fmtAcc(balance.totalLiabilities)}</td></tr>
    <tr class="group-row"><td colspan="2">ส่วนของเจ้าของ</td></tr>${lines(balance.equity)}
    <tr><td class="indent">กำไร (ขาดทุน) ที่ยังไม่ได้ปิดบัญชี</td><td class="right">${fmtAcc(balance.profit)}</td></tr>
    <tr class="total-row"><td>รวมส่วนของเจ้าของ</td><td class="right">${fmtAcc(balance.totalEquity)}</td></tr>
    <tr class="grand-total"><td>รวมหนี้สินและส่วนของเจ้าของ</td><td class="right">${fmtAcc(balance.totalLiabilitiesAndEquity)}</td></tr>`;

  const balanceNote = balance.isBalanced
    ? '<p class="hint balanced">✓ สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ</p>'
    : `<p class="hint unbalanced">✕ งบไม่สมดุล ต่างกัน ${fmt(Math.abs(balance.totalAssets - balance.totalLiabilitiesAndEquity))} — ตรวจสอบงบทดลอง</p>`;

  container.innerHTML = `<div class="report-grid">
    <div class="report"><div class="report-head"><div class="company">${company}</div><h3>งบกำไรขาดทุน</h3><div class="muted">${periodLabel()}</div></div>
      <table><thead><tr><th>รายการ</th><th class="right">จำนวนเงิน (${currency})</th><th class="right pct">% ของรายได้</th></tr></thead><tbody>${incomeBody}</tbody></table>
      <p class="hint">ไม่รวมรายการปิดบัญชี · ตัวเลขในวงเล็บคือยอดติดลบ</p></div>
    <div class="report"><div class="report-head"><div class="company">${company}</div><h3>งบแสดงฐานะการเงิน (งบดุล)</h3><div class="muted">${asAtLabel()}</div></div>
      <table><thead><tr><th>รายการ</th><th class="right">จำนวนเงิน (${currency})</th></tr></thead><tbody>${balanceBody}</tbody></table>${balanceNote}</div>
  </div>`;
}

/* ---------- period presets ---------- */
function isoOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function presetRange(preset) {
  const [year, month] = todayIso().split("-").map(Number);
  switch (preset) {
    case "month": return { from: isoOf(new Date(year, month - 1, 1)), to: isoOf(new Date(year, month, 0)) };
    case "last-month": return { from: isoOf(new Date(year, month - 2, 1)), to: isoOf(new Date(year, month - 1, 0)) };
    case "quarter": {
      const startMonth = Math.floor((month - 1) / 3) * 3;
      return { from: isoOf(new Date(year, startMonth, 1)), to: isoOf(new Date(year, startMonth + 3, 0)) };
    }
    case "year": return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "period": return { from: state.settings.periodStart || "", to: state.settings.periodEnd || "" };
    default: return { from: "", to: "" };
  }
}

function setRange(range, preset = "") {
  fromInput.value = range.from;
  toInput.value = range.to;
  reportDateRange.from = range.from;
  reportDateRange.to = range.to;
  activePreset = preset;
  document.querySelectorAll("#report-presets [data-preset]").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.preset === activePreset));
  });
  renderReports();
}

$("report-presets").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-preset]");
  if (!chip) return;
  if (chip.dataset.preset === "period" && !state.settings.periodStart && !state.settings.periodEnd) {
    toastError("ยังไม่ได้กำหนดงวดบัญชีในหน้าการตั้งค่า");
    return;
  }
  setRange(presetRange(chip.dataset.preset), chip.dataset.preset);
});

$("report-apply-filter").addEventListener("click", () => {
  const from = fromInput.value;
  const to = toInput.value;
  if (from && to && from > to) {
    toastError("วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด");
    return;
  }
  setRange({ from, to });
});

$("report-clear-filter").addEventListener("click", () => setRange({ from: "", to: "" }, "all"));

$("report-export").addEventListener("click", () => {
  const { income, balance } = reportData();
  const rows = [["งบกำไรขาดทุน", periodLabel()]];
  income.revenue.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
  rows.push(["รวมรายได้", income.totalRevenue]);
  income.expense.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
  rows.push(["รวมค่าใช้จ่าย", income.totalExpense]);
  rows.push([income.profit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ", income.profit]);
  rows.push(["", ""], ["งบแสดงฐานะการเงิน", asAtLabel()]);
  balance.assets.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
  rows.push(["รวมสินทรัพย์", balance.totalAssets]);
  balance.liabilities.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
  rows.push(["รวมหนี้สิน", balance.totalLiabilities]);
  balance.equity.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
  rows.push(["กำไร (ขาดทุน) ที่ยังไม่ได้ปิดบัญชี", balance.profit], ["รวมส่วนของเจ้าของ", balance.totalEquity], ["รวมหนี้สินและส่วนของเจ้าของ", balance.totalLiabilitiesAndEquity]);
  downloadCsvFile(`financial-statements-${fileStamp()}.csv`, toCsv(["รายการ", "จำนวนเงิน"], rows));
  toastSuccess("ส่งออกงบการเงินเรียบร้อย");
});

if (await load(["accounts", "entries"])) {
  if (state.settings.periodStart || state.settings.periodEnd) setRange(presetRange("period"), "period");
  else setRange({ from: "", to: "" }, "all");
  onDataRefresh(renderReports);
}

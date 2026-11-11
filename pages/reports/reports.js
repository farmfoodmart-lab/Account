import { AMOUNT_EPSILON, esc, fmt, fmtDateDMY, load, state } from "../../js/data.js";
import { buildBalanceSheet, buildIncomeStatement, collectTotals } from "../../js/reports.js";
import { downloadCsvFile, fileStamp, toastError, toastSuccess } from "../../js/ui.js";
import { toCsv } from "../../js/csv.js";

const reportDateRange = { from: "", to: "" };

function periodLabel() {
  if (!reportDateRange.from && !reportDateRange.to) return "ทั้งงวด";
  return `${reportDateRange.from ? fmtDateDMY(reportDateRange.from) : "เริ่มต้น"} - ${reportDateRange.to ? fmtDateDMY(reportDateRange.to) : "ปัจจุบัน"}`;
}

function moneyRow(label, amount, extraClass = "") {
  return `<tr class="${extraClass}"><td>${esc(label)}</td><td class="right">${fmt(amount)}</td></tr>`;
}

function reportGroup(rows) {
  return rows.filter((row) => Math.abs(row.amount) > AMOUNT_EPSILON)
    .map((row) => `<tr><td>${esc(row.account.code)} ${esc(row.account.name)}</td><td class="right">${fmt(row.amount)}</td></tr>`)
    .join("");
}

function reportData() {
  const totals = collectTotals(state.entries, reportDateRange);
  const income = buildIncomeStatement(state.accounts, totals);
  const balance = buildBalanceSheet(state.accounts, totals, income.profit);
  return { income, balance };
}

function renderReports() {
  const reportsContainer = document.getElementById("reports-view");
  if (!state.accounts.length) {
    reportsContainer.innerHTML = '<p class="empty-state">ยังไม่มีหมวดหมู่บัญชีให้สร้างรายงาน</p>';
    return;
  }
  const { income, balance } = reportData();
  const hasMovement = income.revenue.length || income.expense.length ||
    balance.assets.length || balance.liabilities.length || balance.equity.length;
  if (!hasMovement) {
    reportsContainer.innerHTML = '<p class="empty-state">ไม่มีการเคลื่อนไหวในช่วงเวลาที่เลือก</p>';
    return;
  }

  const company = state.settings.company || "กิจการของฉัน";
  const incomeBody =
    (income.revenue.length ? `<tr class="group-row"><td colspan="2">รายได้</td></tr>${reportGroup(income.revenue)}` : "") +
    `<tr class="total-row"><td>รายได้รวม</td><td class="right">${fmt(income.totalRevenue)}</td></tr>` +
    (income.expense.length ? `<tr class="group-row"><td colspan="2">ค่าใช้จ่าย</td></tr>${reportGroup(income.expense)}` : "") +
    `<tr class="total-row"><td>ค่าใช้จ่ายรวม</td><td class="right">${fmt(income.totalExpense)}</td></tr>` +
    moneyRow(income.profit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ", Math.abs(income.profit), "grand-total");
  const balanceBody =
    (balance.assets.length ? `<tr class="group-row"><td colspan="2">สินทรัพย์</td></tr>${reportGroup(balance.assets)}` : "") +
    `<tr class="total-row"><td>สินทรัพย์รวม</td><td class="right">${fmt(balance.totalAssets)}</td></tr>` +
    (balance.liabilities.length ? `<tr class="group-row"><td colspan="2">หนี้สิน</td></tr>${reportGroup(balance.liabilities)}` : "") +
    `<tr class="total-row"><td>หนี้สินรวม</td><td class="right">${fmt(balance.totalLiabilities)}</td></tr>` +
    (balance.equity.length ? `<tr class="group-row"><td colspan="2">ทุน</td></tr>${reportGroup(balance.equity)}` : "") +
    moneyRow("กำไร (ขาดทุน) งวดนี้", balance.profit) +
    `<tr class="total-row"><td>ส่วนของเจ้าของรวม</td><td class="right">${fmt(balance.totalEquity)}</td></tr>` +
    `<tr class="grand-total"><td>หนี้สิน + ส่วนของเจ้าของ</td><td class="right">${fmt(balance.totalLiabilitiesAndEquity)}</td></tr>`;
  const balanceNote = balance.isBalanced
    ? '<p class="hint balanced">งบดุลสมดุล</p>'
    : `<p class="hint unbalanced">งบดุลไม่สมดุล ต่างกัน ${fmt(Math.abs(balance.totalAssets - balance.totalLiabilitiesAndEquity))}</p>`;

  reportsContainer.innerHTML = `<div class="report-grid">
    <div class="report"><div class="report-head"><h3>งบกำไรขาดทุน</h3><div class="muted">${esc(company)} · ${periodLabel()}</div></div>
      <table><thead><tr><th>รายการ</th><th class="right">จำนวน (${esc(state.settings.currency || "THB")})</th></tr></thead><tbody>${incomeBody}</tbody></table>
      <p class="hint">คำนวณจากรายการบันทึกที่อยู่ในช่วงเวลาที่เลือก</p></div>
    <div class="report"><div class="report-head"><h3>งบดุล</h3><div class="muted">${esc(company)} · ${periodLabel()}</div></div>
      <table><thead><tr><th>รายการ</th><th class="right">จำนวน (${esc(state.settings.currency || "THB")})</th></tr></thead><tbody>${balanceBody}</tbody></table>${balanceNote}</div>
  </div>`;
}

document.getElementById("report-apply-filter").addEventListener("click", () => {
  const from = document.getElementById("report-start-date").value;
  const to = document.getElementById("report-end-date").value;
  if (from && to && from > to) {
    toastError("วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด");
    return;
  }
  reportDateRange.from = from;
  reportDateRange.to = to;
  renderReports();
});

document.getElementById("report-clear-filter").addEventListener("click", () => {
  document.getElementById("report-start-date").value = "";
  document.getElementById("report-end-date").value = "";
  reportDateRange.from = "";
  reportDateRange.to = "";
  renderReports();
});

document.getElementById("report-export").addEventListener("click", () => {
  const { income, balance } = reportData();
  const rows = [["งบกำไรขาดทุน", ""]];
  income.revenue.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
  rows.push(["รายได้รวม", income.totalRevenue]);
  income.expense.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
  rows.push(["ค่าใช้จ่ายรวม", income.totalExpense]);
  rows.push([income.profit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ", income.profit]);
  rows.push(["", ""], ["งบดุล", ""]);
  balance.assets.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
  rows.push(["สินทรัพย์รวม", balance.totalAssets]);
  balance.liabilities.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
  rows.push(["หนี้สินรวม", balance.totalLiabilities]);
  balance.equity.forEach((row) => rows.push([`${row.account.code} ${row.account.name}`, row.amount]));
  rows.push(["กำไร (ขาดทุน) งวดนี้", balance.profit], ["ส่วนของเจ้าของรวม", balance.totalEquity], ["หนี้สิน + ส่วนของเจ้าของ", balance.totalLiabilitiesAndEquity]);
  downloadCsvFile(`reports-${fileStamp()}.csv`, toCsv(["รายการ", "จำนวน"], rows));
  toastSuccess("ส่งออกรายงานเรียบร้อย");
});

if (await load(["accounts", "entries"])) renderReports();

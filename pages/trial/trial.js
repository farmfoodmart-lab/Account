import { esc, load, state, fmt } from "../../js/data.js";
import { buildTrialBalance, collectTotals } from "../../js/reports.js";

function renderTrial() {
  const trialContainer = document.getElementById("trial-view");
  if (!state.accounts.length) {
    trialContainer.innerHTML = '<p class="empty-state">ยังไม่มีหมวดหมู่บัญชี</p>';
    return;
  }
  const totals = collectTotals(state.entries);
  const { rows, totalDebit, totalCredit, isBalanced } = buildTrialBalance(state.accounts, totals);
  const body = rows.length
    ? rows.map((row) => `<tr><td>${esc(row.account.code)}</td><td>${esc(row.account.name)}</td><td class="right">${row.balanceDebit ? fmt(row.balanceDebit) : ""}</td><td class="right">${row.balanceCredit ? fmt(row.balanceCredit) : ""}</td></tr>`).join("")
    : '<tr><td colspan="4" class="muted">ยังไม่มียอดคงเหลือ</td></tr>';
  const statusClass = isBalanced ? "balanced" : "unbalanced";
  trialContainer.innerHTML = `<table><thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th class="right">เดบิต</th><th class="right">เครดิต</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th colspan="2">รวม</th><th class="right ${statusClass}">${fmt(totalDebit)}</th><th class="right ${statusClass}">${fmt(totalCredit)}</th></tr></tfoot></table><p style="margin-top:10px" class="${statusClass}">${isBalanced ? "งบทดลองดุล" : "งบทดลองไม่ดุล — ตรวจสอบรายการที่บันทึก"}</p>`;
}

if (await load(["accounts", "entries"])) renderTrial();

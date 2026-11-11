import { AMOUNT_EPSILON, accountBalance, entryTotal, esc, fmt, fmtInt, fmtDateDMY, load, state } from "../../js/data.js";
import { monthlySummary } from "../../js/reports.js";
import { todayIso } from "../../js/ui.js";

function renderChart(accounts, entries) {
  const monthlyBuckets = monthlySummary(accounts, entries, 6);
  const highestAmount = Math.max(1, ...monthlyBuckets.map((bucket) => Math.max(bucket.revenue, bucket.expense)));
  const chartColumns = monthlyBuckets.map((bucket) => {
    const revenueHeight = Math.round((Math.max(0, bucket.revenue) / highestAmount) * 100);
    const expenseHeight = Math.round((Math.max(0, bucket.expense) / highestAmount) * 100);
    return `<div class="chart-col" title="${esc(bucket.fullLabel)}: รายได้ ${fmt(bucket.revenue)} / ค่าใช้จ่าย ${fmt(bucket.expense)}">
      <div class="chart-bars">
        <div class="chart-bar revenue" style="height:${revenueHeight}%"></div>
        <div class="chart-bar expense" style="height:${expenseHeight}%"></div>
      </div>
      <div class="chart-label">${esc(bucket.label)}</div>
    </div>`;
  }).join("");
  return `<div class="chart">${chartColumns}</div><div class="chart-legend">
    <span><span class="legend-dot" style="background:var(--accent)"></span>รายได้</span>
    <span><span class="legend-dot" style="background:#c7d2d6"></span>ค่าใช้จ่าย</span>
  </div>`;
}

function renderDashboard() {
  const dashboardContainer = document.getElementById("dashboard-view");
  const totals = { revenue: 0, expense: 0, asset: 0, liability: 0, equity: 0 };
  state.accounts.forEach((account) => {
    const { net } = accountBalance(account);
    if (account.type in totals) totals[account.type] += net;
  });

  const profit = totals.revenue - totals.expense;
  const receivables = state.receivables || [];
  const outstanding = receivables.reduce(
    (total, receivable) => total + Math.max(0, (Number(receivable.amount) || 0) - (Number(receivable.paid) || 0)),
    0,
  );
  const currentDate = todayIso();
  const overdue = receivables.filter((receivable) => {
    const remainingAmount = (Number(receivable.amount) || 0) - (Number(receivable.paid) || 0);
    return remainingAmount > AMOUNT_EPSILON && receivable.due && receivable.due < currentDate;
  }).length;
  const recentEntries = state.entries.slice(-5).reverse();

  dashboardContainer.innerHTML = `<div class="cards">
      <div class="stat"><div class="muted">รายได้รวม</div><div class="stat-value">${fmt(totals.revenue)}</div></div>
      <div class="stat"><div class="muted">ค่าใช้จ่ายรวม</div><div class="stat-value">${fmt(totals.expense)}</div></div>
      <div class="stat"><div class="muted">กำไร (ขาดทุน) สุทธิ</div><div class="stat-value ${profit >= 0 ? "balanced" : "unbalanced"}">${fmt(profit)}</div></div>
      <div class="stat"><div class="muted">ลูกหนี้คงค้าง</div><div class="stat-value">${fmt(outstanding)}</div></div>
    </div>
    <div class="cards" style="margin-top:12px">
      <div class="stat"><div class="muted">สินทรัพย์</div><div class="stat-value">${fmt(totals.asset)}</div></div>
      <div class="stat"><div class="muted">หนี้สิน</div><div class="stat-value">${fmt(totals.liability)}</div></div>
      <div class="stat"><div class="muted">ส่วนของเจ้าของ</div><div class="stat-value">${fmt(totals.equity)}</div></div>
      <div class="stat"><div class="muted">รายการ / ลูกค้า</div><div class="stat-value">${fmtInt(state.entries.length)} / ${fmtInt(state.customers.length)}</div></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">รายได้และค่าใช้จ่าย 6 เดือนล่าสุด</h3>${renderChart(state.accounts, state.entries)}
    </div>
    <div class="card">
      <h3 style="margin-top:0">ภาพรวม</h3>
      <p><strong>กิจการ:</strong> ${esc(state.settings.company || "ยังไม่ได้ตั้งชื่อกิจการ")}</p>
      <p class="muted">หมวดหมู่บัญชี ${fmtInt(state.accounts.length)} บัญชี · รายการบันทึก ${fmtInt(state.entries.length)} รายการ · ลูกหนี้ค้างชำระ ${fmtInt(receivables.filter((receivable) => (Number(receivable.amount) || 0) - (Number(receivable.paid) || 0) > AMOUNT_EPSILON).length)} รายการ${overdue ? ` (เกินกำหนด ${fmtInt(overdue)})` : ""}</p>
      <p class="muted">รายชื่อลูกค้า(ไฟล์) ${fmtInt(state.customerNames.length)} ราย · ต้นทุน/ขาย ${fmtInt(state.customerCosts.length)} รายการ · เอกสารรับเข้า ${fmtInt(state.incomingDocs.length)} รายการ</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">รายการล่าสุด</h3>
      ${recentEntries.length
        ? `<table><thead><tr><th>วันที่</th><th>รายละเอียด</th><th class="right">จำนวน</th></tr></thead><tbody>${recentEntries.map((entry) => `<tr><td>${esc(fmtDateDMY(entry.date))}</td><td>${esc(entry.desc || "(ไม่มีคำอธิบาย)")}</td><td class="right">${fmt(entryTotal(entry))}</td></tr>`).join("")}</tbody></table>`
        : '<p class="muted">ยังไม่มีรายการบันทึก</p>'}
    </div>`;
}

if (await load(["accounts", "entries", "customers", "receivables", "customerNames", "customerCosts", "incomingDocs"])) renderDashboard();

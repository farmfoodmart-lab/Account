import {
  AMOUNT_EPSILON,
  ENTRY_KINDS,
  entryKind,
  entryTotal,
  esc,
  fmt,
  fmtAcc,
  fmtDateDMY,
  fmtInt,
  load,
  state, onDataRefresh
} from "../../js/data.js";
import {
  bookHealth,
  buildBalanceSheet,
  buildIncomeStatement,
  collectTotals,
  monthlySummary,
  receivableAging,
  toIsoDate,
} from "../../js/reports.js";
import { todayIso } from "../../js/ui.js";

const icon = (name) => (window.AppIcon ? window.AppIcon(name) : "");

function periodRange() {
  const { periodStart = "", periodEnd = "" } = state.settings || {};
  return { from: periodStart, to: periodEnd };
}

function periodText(range) {
  if (!range.from && !range.to) return "ข้อมูลทั้งหมด (ยังไม่ได้กำหนดงวดบัญชีในหน้าการตั้งค่า)";
  return `งวดบัญชี ${range.from ? fmtDateDMY(range.from) : "เริ่มต้น"} – ${range.to ? fmtDateDMY(range.to) : "ปัจจุบัน"}`;
}

function renderChart() {
  const buckets = monthlySummary(state.accounts, state.entries, 12);
  const highest = Math.max(1, ...buckets.map((bucket) => Math.max(bucket.revenue, bucket.expense)));
  const columns = buckets.map((bucket) => {
    const revenueHeight = Math.round((Math.max(0, bucket.revenue) / highest) * 100);
    const expenseHeight = Math.round((Math.max(0, bucket.expense) / highest) * 100);
    const tip = `${bucket.fullLabel}\nรายได้ ${fmt(bucket.revenue)}\nค่าใช้จ่าย ${fmt(bucket.expense)}\nกำไร ${fmt(bucket.revenue - bucket.expense)}`;
    return `<div class="chart-col" tabindex="0" title="${esc(tip)}" aria-label="${esc(tip)}">
      <div class="chart-bars"><div class="chart-bar revenue" style="height:${revenueHeight}%"></div><div class="chart-bar expense" style="height:${expenseHeight}%"></div></div>
    </div>`;
  }).join("");
  const labels = buckets.map((bucket) => `<span class="chart-label">${esc(bucket.label)}</span>`).join("");
  const totalRevenue = buckets.reduce((sum, bucket) => sum + bucket.revenue, 0);
  const totalExpense = buckets.reduce((sum, bucket) => sum + bucket.expense, 0);
  return `<div class="card">
    <div class="card-head"><h3>รายได้และค่าใช้จ่าย 12 เดือนล่าสุด</h3><span class="muted">กำไรสุทธิ 12 เดือน <strong class="${totalRevenue - totalExpense >= 0 ? "balanced" : "unbalanced"}">${fmtAcc(totalRevenue - totalExpense)}</strong></span></div>
    <div class="chart">${columns}</div><div class="chart-labels">${labels}</div>
    <div class="chart-legend"><span><span class="legend-dot" style="background:var(--type-revenue)"></span>รายได้ ${fmt(totalRevenue)}</span><span><span class="legend-dot" style="background:var(--type-expense)"></span>ค่าใช้จ่าย ${fmt(totalExpense)}</span></div>
  </div>`;
}

function renderHealth(health, balance) {
  const checks = [
    {
      ok: health.isBalanced,
      text: health.isBalanced ? "ยอดรวมเดบิตเท่ากับเครดิต (งบทดลองดุล)" : `ยอดรวมเดบิต/เครดิตต่างกัน ${fmt(Math.abs(health.totalDebit - health.totalCredit))}`,
      link: "../trial/trial.html",
    },
    {
      ok: !health.unbalanced,
      text: health.unbalanced ? `มี ${fmtInt(health.unbalanced)} รายการที่เดบิตไม่เท่ากับเครดิต` : "ทุกรายการบันทึกดุล",
      link: "../journal/journal.html",
    },
    {
      ok: !health.missingAccount,
      text: health.missingAccount ? `มี ${fmtInt(health.missingAccount)} บรรทัดอ้างอิงบัญชีที่ถูกลบ` : "ทุกบรรทัดอ้างอิงบัญชีที่มีอยู่",
      link: "../journal/journal.html",
    },
    {
      ok: balance.isBalanced,
      text: balance.isBalanced ? "สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ" : "สมการบัญชีไม่สมดุล",
      link: "../reports/reports.html",
    },
    {
      ok: !health.missingDate,
      warn: true,
      text: health.missingDate ? `มี ${fmtInt(health.missingDate)} รายการไม่มีวันที่` : "ทุกรายการมีวันที่",
      link: "../journal/journal.html",
    },
    {
      ok: !health.outsidePeriod,
      warn: true,
      text: health.outsidePeriod ? `มี ${fmtInt(health.outsidePeriod)} รายการอยู่นอกงวดบัญชี` : "ทุกรายการอยู่ในงวดบัญชี",
      link: "../journal/journal.html",
    },
  ];
  const problems = checks.filter((check) => !check.ok).length;
  return `<div class="card">
    <div class="card-head"><h3>ตรวจสุขภาพบัญชี</h3>${problems ? `<span class="badge danger">${fmtInt(problems)} จุดที่ต้องตรวจ</span>` : '<span class="badge success dot">ปกติ</span>'}</div>
    <ul class="check-list">${checks.map((check) => {
      const cls = check.ok ? "ok" : check.warn ? "warn" : "bad";
      const mark = check.ok ? "✓" : "!";
      return `<li class="${cls}"><span class="mark">${mark}</span><span>${check.ok ? esc(check.text) : `<a href="${check.link}">${esc(check.text)}</a>`}</span></li>`;
    }).join("")}</ul>
  </div>`;
}

function renderAging() {
  const buckets = receivableAging(state.receivables || [], todayIso());
  const total = buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
  const colors = ["var(--success)", "var(--warning)", "#d9822b", "var(--type-liability)", "var(--danger)"];
  if (total <= AMOUNT_EPSILON) {
    return `<div class="card"><div class="card-head"><h3>อายุลูกหนี้</h3><a href="../receivables/receivables.html" class="muted">ดูทั้งหมด</a></div><p class="muted">ไม่มีลูกหนี้คงค้าง</p></div>`;
  }
  return `<div class="card">
    <div class="card-head"><h3>อายุลูกหนี้</h3><a href="../receivables/receivables.html" class="muted">ดูทั้งหมด</a></div>
    <div class="meter" role="img" aria-label="สัดส่วนอายุลูกหนี้">${buckets.map((bucket, index) => bucket.amount > 0 ? `<span style="width:${(bucket.amount / total) * 100}%;background:${colors[index]}" title="${esc(bucket.label)} ${fmt(bucket.amount)}"></span>` : "").join("")}</div>
    <div class="legend-list">${buckets.map((bucket, index) => `<div><span><span class="legend-dot" style="background:${colors[index]}"></span>${esc(bucket.label)} <span class="muted">(${fmtInt(bucket.count)})</span></span><span class="num">${fmt(bucket.amount)}</span></div>`).join("")}
      <div style="border-top:1px solid var(--border);padding-top:6px"><strong>รวมคงค้าง</strong><strong class="num">${fmt(total)}</strong></div></div>
  </div>`;
}

function renderRecent() {
  const recent = state.entries
    .slice()
    .sort((left, right) => (toIsoDate(right.date) || "").localeCompare(toIsoDate(left.date) || ""))
    .slice(0, 8);
  if (!recent.length) {
    return `<div class="card"><div class="card-head"><h3>รายการล่าสุด</h3></div><div class="empty-state"><strong>ยังไม่มีรายการบันทึก</strong>เริ่มบันทึกรายการค้าแรกของกิจการ<br><a class="btn" href="../journal/journal.html#new">+ บันทึกรายการ</a></div></div>`;
  }
  return `<div class="card flush">
    <div class="card-head" style="padding-bottom:12px"><h3>รายการล่าสุด</h3><a href="../journal/journal.html" class="muted">ดูสมุดรายวัน</a></div>
    <div style="overflow-x:auto"><table><thead><tr><th class="col-date">วันที่</th><th>เลขที่</th><th>คำอธิบาย</th><th class="right col-amt">จำนวนเงิน</th></tr></thead>
    <tbody>${recent.map((entry) => {
      const kind = entryKind(entry);
      return `<tr><td class="nowrap">${esc(fmtDateDMY(entry.date))}</td><td class="nowrap code">${esc(entry.docNo || "-")}</td><td>${esc(entry.desc || "(ไม่มีคำอธิบาย)")}${kind !== "general" ? ` <span class="badge info">${ENTRY_KINDS[kind]}</span>` : ""}${entry.customerName ? `<span class="cell-sub">${esc(entry.customerName)}</span>` : ""}</td><td class="right">${fmt(entryTotal(entry))}</td></tr>`;
    }).join("")}</tbody></table></div>
  </div>`;
}

function renderDashboard() {
  const container = document.getElementById("dashboard-view");
  const range = periodRange();
  document.getElementById("dash-period").textContent = periodText(range);
  if (state.settings.company) document.getElementById("dash-company").textContent = state.settings.company;

  if (!state.accounts.length) {
    container.innerHTML = `<div class="empty-state"><strong>เริ่มต้นใช้งานระบบบัญชีคู่</strong>สร้างผังบัญชีก่อน แล้วจึงบันทึกรายการค้าในสมุดรายวัน<br>
      <a class="btn" href="../accounts/accounts.html">ไปที่ผังบัญชี</a> <a class="btn secondary" href="../import/import.html">นำเข้าจาก Excel</a></div>`;
    return;
  }

  const periodTotals = collectTotals(state.entries, { ...range, excludeKinds: ["closing"] });
  const income = buildIncomeStatement(state.accounts, periodTotals);
  const balanceTotals = collectTotals(state.entries, { to: range.to });
  const unclosed = buildIncomeStatement(state.accounts, balanceTotals).profit;
  const balance = buildBalanceSheet(state.accounts, balanceTotals, unclosed);
  const health = bookHealth(state.accounts, state.entries, { periodStart: range.from, periodEnd: range.to });

  const receivables = state.receivables || [];
  const outstanding = receivables.reduce((total, receivable) => total + Math.max(0, (Number(receivable.amount) || 0) - (Number(receivable.paid) || 0)), 0);
  const today = todayIso();
  const overdue = receivables.filter((receivable) => (Number(receivable.amount) || 0) - (Number(receivable.paid) || 0) > AMOUNT_EPSILON && receivable.due && toIsoDate(receivable.due) < today).length;
  const payables = state.payables || [];
  const payableOutstanding = payables.reduce((total, payable) => total + Math.max(0, (Number(payable.amount) || 0) - (Number(payable.paid) || 0)), 0);
  const payableOverdue = payables.filter((payable) => (Number(payable.amount) || 0) - (Number(payable.paid) || 0) > AMOUNT_EPSILON && payable.due && toIsoDate(payable.due) < today).length;
  const margin = income.totalRevenue > AMOUNT_EPSILON ? (income.profit / income.totalRevenue) * 100 : 0;

  container.innerHTML = `
    <div class="quick-actions">
      <a class="quick-action" href="../journal/journal.html#new">${icon("plus")}บันทึกรายการ</a>
      <a class="quick-action" href="../receivables/receivables.html#new">${icon("receipt")}เพิ่มลูกหนี้</a>
      <a class="quick-action" href="../payables/payables.html#new">${icon("wallet")}เพิ่มเจ้าหนี้</a>
      <a class="quick-action" href="../ledger/ledger.html">${icon("layers")}บัญชีแยกประเภท</a>
      <a class="quick-action" href="../trial/trial.html">${icon("scale")}งบทดลอง</a>
      <a class="quick-action" href="../import/import.html">${icon("upload")}นำเข้า Excel</a>
    </div>
    <div class="cards">
      <div class="stat accent-revenue"><div class="muted">รายได้</div><div class="stat-value">${fmt(income.totalRevenue)}</div><div class="stat-sub">${fmtInt(income.revenue.length)} บัญชีรายได้</div></div>
      <div class="stat accent-expense"><div class="muted">ค่าใช้จ่าย</div><div class="stat-value">${fmt(income.totalExpense)}</div><div class="stat-sub">${fmtInt(income.expense.length)} บัญชีค่าใช้จ่าย</div></div>
      <div class="stat"><div class="muted">${income.profit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}</div><div class="stat-value ${income.profit >= 0 ? "balanced" : "unbalanced"}">${fmt(Math.abs(income.profit))}</div><div class="stat-sub">อัตรากำไรสุทธิ ${margin.toFixed(1)}%</div></div>
      <div class="stat${overdue ? " is-alert" : ""}"><div class="muted">ลูกหนี้คงค้าง</div><div class="stat-value">${fmt(outstanding)}</div><div class="stat-sub">${overdue ? `<span class="unbalanced">เกินกำหนด ${fmtInt(overdue)} รายการ</span>` : "ไม่มีรายการเกินกำหนด"}</div></div>
      <div class="stat${payableOverdue ? " is-alert" : ""}"><div class="muted">เจ้าหนี้คงค้าง</div><div class="stat-value">${fmt(payableOutstanding)}</div><div class="stat-sub">${payableOverdue ? `<span class="unbalanced">เกินกำหนดชำระ ${fmtInt(payableOverdue)} รายการ</span>` : "ไม่มีรายการเกินกำหนด"}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>สมการบัญชี</h3><span class="badge ${balance.isBalanced ? "success" : "danger"} dot">${balance.isBalanced ? "สมดุล" : "ไม่สมดุล"}</span></div>
      <div class="equation">
        <div><small>สินทรัพย์</small><strong>${fmtAcc(balance.totalAssets)}</strong></div><span class="op">=</span>
        <div><small>หนี้สิน</small><strong>${fmtAcc(balance.totalLiabilities)}</strong></div><span class="op">+</span>
        <div><small>ส่วนของเจ้าของ (รวมกำไรที่ยังไม่ปิดบัญชี)</small><strong>${fmtAcc(balance.totalEquity)}</strong></div>
      </div>
    </div>
    <div class="grid-3">
      ${renderChart()}
      ${renderHealth(health, balance)}
    </div>
    <div class="grid-3" style="margin-top:18px">
      ${renderRecent()}
      <div class="stack-gap">
        ${renderAging()}
        <div class="card"><div class="card-head"><h3>ข้อมูลในระบบ</h3></div><div class="kv">
          <div><small>ผังบัญชี</small><strong>${fmtInt(state.accounts.length)}</strong></div>
          <div><small>รายการบันทึก</small><strong>${fmtInt(state.entries.length)}</strong></div>
          <div><small>ลูกค้า</small><strong>${fmtInt(state.customers.length + state.customerNames.length)}</strong></div>
          <div><small>เอกสารรับเข้า</small><strong>${fmtInt(state.incomingDocs.length)}</strong></div>
        </div></div>
      </div>
    </div>`;
}

if (await load(["accounts", "entries", "customers", "receivables", "payables", "customerNames", "customerCosts", "incomingDocs"])) {
  renderDashboard();
  onDataRefresh(renderDashboard);
}

/**
 * @file หน้า "แดชบอร์ด" — ภาพรวมผลการดำเนินงาน ฐานะการเงิน และสุขภาพของบัญชี
 *
 * ช่วงเวลาที่ใช้คำนวณเลือกได้จากตัวกรองด้านบน (ค่าเริ่มต้น = เดือนล่าสุดที่มีรายการ)
 * - รายได้/ค่าใช้จ่าย/กำไร: เฉพาะในช่วง
 * - สมการบัญชี: ยอดสะสม ณ วันสิ้นช่วง
 * - กราฟ 12 เดือน: นับย้อนจากเดือนของวันสิ้นช่วง
 */
import { loadData, onDataRefresh, state } from "../../src/core/store.js";
import { AMOUNT_EPSILON, ENTRY_KIND_LABELS } from "../../src/accounting/constants.js";
import { calculateEntryTotal, getEntryKind } from "../../src/accounting/rules.js";
import {
  buildAgingBuckets,
  buildBalanceSheet,
  buildIncomeStatement,
  checkBookHealth,
  sumMovementsByAccount,
  summarizeMonthlyIncome,
} from "../../src/accounting/statements.js";
import { buildSubledger } from "../../src/accounting/subledger.js";
import { createMonthFilter, getInitialMonthRange } from "../../src/components/month-filter.js";
import { getLatestMonthRange, getTodayIso, toIsoDate } from "../../src/utils/date.js";
import { byId } from "../../src/utils/dom.js";
import { escapeHtml, formatAccounting, formatDate, formatMoney, formatNumber } from "../../src/utils/format.js";

/** สีของแต่ละช่วงอายุลูกหนี้ (ลำดับตรงกับ buildAgingBuckets) */
const AGING_COLORS = ["var(--success)", "var(--warning)", "#d9822b", "var(--type-liability)", "var(--danger)"];

/** จำนวนรายการล่าสุดที่แสดง */
const RECENT_ENTRY_LIMIT = 8;

/** ไอคอน SVG จาก app-shell.js */
const renderIcon = (iconName) => (window.AppIcon ? window.AppIcon(iconName) : "");

const fromDateInput = byId("dash-from");
const toDateInput = byId("dash-to");

/** ช่วงวันที่ตามปุ่มลัด */
function getPresetPeriod(presetName) {
  if (presetName === "latest") return getLatestMonthRange(state.entries);
  if (presetName === "period") {
    const { periodStart = "", periodEnd = "" } = state.settings || {};
    return { from: periodStart, to: periodEnd };
  }
  return { from: "", to: "" };
}

/** ช่วงวันที่ที่เลือกอยู่ */
function getSelectedPeriod() {
  return { from: fromDateInput.value, to: toDateInput.value };
}

/** ไฮไลต์ปุ่มลัดที่ตรงกับช่วงปัจจุบัน */
function highlightPreset() {
  const period = getSelectedPeriod();
  document.querySelectorAll("#dash-presets [data-preset]").forEach((chip) => {
    const presetPeriod = getPresetPeriod(chip.dataset.preset);
    const isMatch = presetPeriod.from === period.from && presetPeriod.to === period.to
      && (chip.dataset.preset !== "period" || Boolean(period.from || period.to));
    chip.setAttribute("aria-pressed", String(isMatch));
  });
}

function describePeriod(period) {
  if (!period.from && !period.to) return "ข้อมูลทั้งหมด";
  return `ช่วง ${period.from ? formatDate(period.from) : "เริ่มต้น"} – ${period.to ? formatDate(period.to) : "ปัจจุบัน"}`;
}

/**
 * ยอดคงค้างและจำนวนเอกสารเกินกำหนด ของลูกหนี้หรือเจ้าหนี้ (จากทะเบียนที่สร้างจากสมุดรายวัน)
 * @param {Array<{ outstanding: number, due?: string }>} documents
 * @param {string} today
 */
function summarizeOpenBalances(documents, today) {
  let outstandingTotal = 0;
  let overdueCount = 0;
  documents.forEach((subledgerDocument) => {
    if (subledgerDocument.outstanding < AMOUNT_EPSILON) return;
    outstandingTotal += subledgerDocument.outstanding;
    if (subledgerDocument.due && subledgerDocument.due < today) overdueCount += 1;
  });
  return { outstandingTotal, overdueCount };
}

/** กราฟแท่งรายได้/ค่าใช้จ่าย 12 เดือน (วาดด้วย CSS ไม่ต้องใช้ไลบรารี) */
function renderIncomeChart() {
  // กราฟนับย้อน 12 เดือนจากเดือนของวันสิ้นช่วง (ไม่ระบุ = เดือนล่าสุดที่มีรายการ)
  const referenceIso = toDateInput.value || getLatestMonthRange(state.entries).to;
  const [referenceYear, referenceMonth] = referenceIso.split("-").map(Number);
  const months = summarizeMonthlyIncome(state.accounts, state.entries, 12, new Date(referenceYear, referenceMonth - 1, 1));
  const highestAmount = Math.max(1, ...months.map((month) => Math.max(month.revenue, month.expense)));
  const toBarHeight = (amount) => Math.round((Math.max(0, amount) / highestAmount) * 100);

  const columns = months.map((month) => {
    const tooltip = `${month.fullLabel}\nรายได้ ${formatMoney(month.revenue)}\nค่าใช้จ่าย ${formatMoney(month.expense)}\nกำไร ${formatMoney(month.revenue - month.expense)}`;
    return `<div class="chart-col" tabindex="0" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">
      <div class="chart-bars">
        <div class="chart-bar revenue" style="height:${toBarHeight(month.revenue)}%"></div>
        <div class="chart-bar expense" style="height:${toBarHeight(month.expense)}%"></div>
      </div>
    </div>`;
  }).join("");
  const labels = months.map((month) => `<span class="chart-label">${escapeHtml(month.label)}</span>`).join("");
  const totalRevenue = months.reduce((total, month) => total + month.revenue, 0);
  const totalExpense = months.reduce((total, month) => total + month.expense, 0);
  const netProfit = totalRevenue - totalExpense;

  return `<div class="card">
    <div class="card-head"><h3>รายได้และค่าใช้จ่าย 12 เดือนล่าสุด</h3><span class="muted">กำไรสุทธิ 12 เดือน <strong class="${netProfit >= 0 ? "balanced" : "unbalanced"}">${formatAccounting(netProfit)}</strong></span></div>
    <div class="chart">${columns}</div><div class="chart-labels">${labels}</div>
    <div class="chart-legend">
      <span><span class="legend-dot" style="background:var(--type-revenue)"></span>รายได้ ${formatMoney(totalRevenue)}</span>
      <span><span class="legend-dot" style="background:var(--type-expense)"></span>ค่าใช้จ่าย ${formatMoney(totalExpense)}</span>
    </div>
  </div>`;
}

/**
 * การ์ดตรวจสุขภาพบัญชี
 * level: "error" = ผิดหลักบัญชี (สีแดง), "warning" = ควรตรวจสอบ (สีเหลือง)
 */
function renderHealthCheck(health, balanceSheet) {
  const checks = [
    {
      passed: health.isBalanced,
      level: "error",
      message: health.isBalanced
        ? "ยอดรวมเดบิตเท่ากับเครดิต (งบทดลองดุล)"
        : `ยอดรวมเดบิต/เครดิตต่างกัน ${formatMoney(Math.abs(health.totalDebit - health.totalCredit))}`,
      link: "../trial/trial.html",
    },
    {
      passed: !health.unbalancedEntries,
      level: "error",
      message: health.unbalancedEntries ? `มี ${formatNumber(health.unbalancedEntries)} รายการที่เดบิตไม่เท่ากับเครดิต` : "ทุกรายการบันทึกดุล",
      link: "../journal/journal.html",
    },
    {
      passed: !health.linesWithMissingAccount,
      level: "error",
      message: health.linesWithMissingAccount ? `มี ${formatNumber(health.linesWithMissingAccount)} บรรทัดอ้างอิงบัญชีที่ถูกลบ` : "ทุกบรรทัดอ้างอิงบัญชีที่มีอยู่",
      link: "../journal/journal.html",
    },
    {
      passed: balanceSheet.isBalanced,
      level: "error",
      message: balanceSheet.isBalanced ? "สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ" : "สมการบัญชีไม่สมดุล",
      link: "../reports/reports.html",
    },
    {
      passed: !health.entriesWithoutDate,
      level: "warning",
      message: health.entriesWithoutDate ? `มี ${formatNumber(health.entriesWithoutDate)} รายการไม่มีวันที่` : "ทุกรายการมีวันที่",
      link: "../journal/journal.html",
    },
    {
      passed: !health.entriesOutsidePeriod,
      level: "warning",
      message: health.entriesOutsidePeriod ? `มี ${formatNumber(health.entriesOutsidePeriod)} รายการอยู่นอกงวดบัญชี` : "ทุกรายการอยู่ในงวดบัญชี",
      link: "../journal/journal.html",
    },
  ];

  const failedCount = checks.filter((check) => !check.passed).length;
  const statusBadge = failedCount
    ? `<span class="badge danger">${formatNumber(failedCount)} จุดที่ต้องตรวจ</span>`
    : '<span class="badge success dot">ปกติ</span>';
  const items = checks.map((check) => {
    let itemClass = "ok";
    if (!check.passed) itemClass = check.level === "warning" ? "warn" : "bad";
    const text = check.passed ? escapeHtml(check.message) : `<a href="${check.link}">${escapeHtml(check.message)}</a>`;
    return `<li class="${itemClass}"><span class="mark">${check.passed ? "✓" : "!"}</span><span>${text}</span></li>`;
  }).join("");

  return `<div class="card">
    <div class="card-head"><h3>ตรวจสุขภาพบัญชี</h3>${statusBadge}</div>
    <ul class="check-list">${items}</ul>
  </div>`;
}

/** การ์ดอายุลูกหนี้ */
function renderReceivableAging(receivableDocuments) {
  const buckets = buildAgingBuckets(receivableDocuments, getTodayIso());
  const totalOutstanding = buckets.reduce((total, bucket) => total + bucket.amount, 0);
  const header = '<div class="card-head"><h3>อายุลูกหนี้</h3><a href="../receivables/receivables.html" class="muted">ดูทั้งหมด</a></div>';
  if (totalOutstanding <= AMOUNT_EPSILON) {
    return `<div class="card">${header}<p class="muted">ไม่มีลูกหนี้คงค้าง</p></div>`;
  }

  const meterSegments = buckets.map((bucket, index) => (bucket.amount > 0
    ? `<span style="width:${(bucket.amount / totalOutstanding) * 100}%;background:${AGING_COLORS[index]}" title="${escapeHtml(bucket.label)} ${formatMoney(bucket.amount)}"></span>`
    : "")).join("");
  const legendRows = buckets.map((bucket, index) => `<div>
    <span><span class="legend-dot" style="background:${AGING_COLORS[index]}"></span>${escapeHtml(bucket.label)} <span class="muted">(${formatNumber(bucket.count)})</span></span>
    <span class="num">${formatMoney(bucket.amount)}</span>
  </div>`).join("");

  return `<div class="card">
    ${header}
    <div class="meter" role="img" aria-label="สัดส่วนอายุลูกหนี้">${meterSegments}</div>
    <div class="legend-list">${legendRows}
      <div style="border-top:1px solid var(--border);padding-top:6px"><strong>รวมคงค้าง</strong><strong class="num">${formatMoney(totalOutstanding)}</strong></div>
    </div>
  </div>`;
}

/** ตารางรายการล่าสุดในสมุดรายวัน */
function renderRecentEntries() {
  const recentEntries = state.entries
    .slice()
    .sort((leftEntry, rightEntry) => (toIsoDate(rightEntry.date) || "").localeCompare(toIsoDate(leftEntry.date) || ""))
    .slice(0, RECENT_ENTRY_LIMIT);

  if (!recentEntries.length) {
    return `<div class="card"><div class="card-head"><h3>รายการล่าสุด</h3></div>
      <div class="empty-state"><strong>ยังไม่มีรายการบันทึก</strong>เริ่มบันทึกรายการค้าแรกของกิจการ<br><a class="btn" href="../journal/journal.html#new">+ บันทึกรายการ</a></div></div>`;
  }

  const rows = recentEntries.map((entry) => {
    const entryKind = getEntryKind(entry);
    const kindBadge = entryKind !== "general" ? ` <span class="badge info">${ENTRY_KIND_LABELS[entryKind]}</span>` : "";
    const customerLine = entry.customerName ? `<span class="cell-sub">${escapeHtml(entry.customerName)}</span>` : "";
    return `<tr>
      <td class="nowrap">${escapeHtml(formatDate(entry.date))}</td>
      <td class="nowrap code">${escapeHtml(entry.docNo || "-")}</td>
      <td>${escapeHtml(entry.desc || "(ไม่มีคำอธิบาย)")}${kindBadge}${customerLine}</td>
      <td class="right">${formatMoney(calculateEntryTotal(entry))}</td>
    </tr>`;
  }).join("");

  return `<div class="card flush">
    <div class="card-head" style="padding-bottom:12px"><h3>รายการล่าสุด</h3><a href="../journal/journal.html" class="muted">ดูสมุดรายวัน</a></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th class="col-date">วันที่</th><th>เลขที่</th><th>คำอธิบาย</th><th class="right col-amount">จำนวนเงิน</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function renderSystemCounts() {
  return `<div class="card"><div class="card-head"><h3>ข้อมูลในระบบ</h3></div><div class="info-grid">
    <div><small>ผังบัญชี</small><strong>${formatNumber(state.accounts.length)}</strong></div>
    <div><small>รายการบันทึก</small><strong>${formatNumber(state.entries.length)}</strong></div>
    <div><small>ลูกค้า</small><strong>${formatNumber(state.customers.length + state.customerNames.length)}</strong></div>
    <div><small>เอกสารรับเข้า</small><strong>${formatNumber(state.incomingDocs.length)}</strong></div>
  </div></div>`;
}

function renderDashboard() {
  const container = byId("dashboard-view");
  const period = getSelectedPeriod();
  if (period.from && period.to && period.from > period.to) {
    container.innerHTML = '<div class="banner bad">วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด</div>';
    return;
  }
  byId("dash-period").textContent = describePeriod(period);
  highlightPreset();
  if (state.settings.company) byId("dash-company").textContent = state.settings.company;

  if (!state.accounts.length) {
    container.innerHTML = `<div class="empty-state"><strong>เริ่มต้นใช้งานระบบบัญชีคู่</strong>สร้างผังบัญชีก่อน แล้วจึงบันทึกรายการค้าในสมุดรายวัน<br>
      <a class="btn" href="../accounts/accounts.html">ไปที่ผังบัญชี</a> <a class="btn secondary" href="../import/import.html">นำเข้าจาก Excel</a></div>`;
    return;
  }

  // งบกำไรขาดทุนของงวด (ไม่รวมรายการปิดบัญชี) และงบดุล ณ วันสิ้นงวด
  const periodMovements = sumMovementsByAccount(state.entries, { ...period, excludeKinds: ["closing"] });
  const incomeStatement = buildIncomeStatement(state.accounts, periodMovements);
  const cumulativeMovements = sumMovementsByAccount(state.entries, { to: period.to });
  const unclosedProfit = buildIncomeStatement(state.accounts, cumulativeMovements).profit;
  const balanceSheet = buildBalanceSheet(state.accounts, cumulativeMovements, unclosedProfit);
  // ตรวจสุขภาพบัญชีเทียบกับงวดบัญชีในการตั้งค่า (ไม่ใช่ช่วงที่เลือกดู)
  const health = checkBookHealth(state.accounts, state.entries, { periodStart: state.settings.periodStart || "", periodEnd: state.settings.periodEnd || "" });

  const today = getTodayIso();
  const receivableDocuments = buildSubledger("receivable").documents;
  const receivableSummary = summarizeOpenBalances(receivableDocuments, today);
  const payableSummary = summarizeOpenBalances(buildSubledger("payable").documents, today);
  const isProfit = incomeStatement.profit >= 0;
  const profitMargin = incomeStatement.totalRevenue > AMOUNT_EPSILON
    ? (incomeStatement.profit / incomeStatement.totalRevenue) * 100
    : 0;
  const overdueText = (count, label) => (count
    ? `<span class="unbalanced">${label} ${formatNumber(count)} รายการ</span>`
    : "ไม่มีรายการเกินกำหนด");

  container.innerHTML = `
    <div class="quick-actions">
      <a class="quick-action" href="../journal/journal.html#new">${renderIcon("plus")}บันทึกรายการ</a>
      <a class="quick-action" href="../receivables/receivables.html">${renderIcon("receipt")}ทะเบียนลูกหนี้</a>
      <a class="quick-action" href="../payables/payables.html">${renderIcon("wallet")}ทะเบียนเจ้าหนี้</a>
      <a class="quick-action" href="../ledger/ledger.html">${renderIcon("layers")}บัญชีแยกประเภท</a>
      <a class="quick-action" href="../trial/trial.html">${renderIcon("scale")}งบทดลอง</a>
      <a class="quick-action" href="../import/import.html">${renderIcon("upload")}นำเข้า Excel</a>
    </div>
    <div class="cards">
      <div class="stat accent-revenue"><div class="muted">รายได้</div><div class="stat-value">${formatMoney(incomeStatement.totalRevenue)}</div><div class="stat-sub">${formatNumber(incomeStatement.revenue.length)} บัญชีรายได้</div></div>
      <div class="stat accent-expense"><div class="muted">ค่าใช้จ่าย</div><div class="stat-value">${formatMoney(incomeStatement.totalExpense)}</div><div class="stat-sub">${formatNumber(incomeStatement.expense.length)} บัญชีค่าใช้จ่าย</div></div>
      <div class="stat"><div class="muted">${isProfit ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}</div><div class="stat-value ${isProfit ? "balanced" : "unbalanced"}">${formatMoney(Math.abs(incomeStatement.profit))}</div><div class="stat-sub">อัตรากำไรสุทธิ ${profitMargin.toFixed(1)}%</div></div>
      <div class="stat${receivableSummary.overdueCount ? " is-alert" : ""}"><div class="muted">ลูกหนี้คงค้าง</div><div class="stat-value">${formatMoney(receivableSummary.outstandingTotal)}</div><div class="stat-sub">${overdueText(receivableSummary.overdueCount, "เกินกำหนด")}</div></div>
      <div class="stat${payableSummary.overdueCount ? " is-alert" : ""}"><div class="muted">เจ้าหนี้คงค้าง</div><div class="stat-value">${formatMoney(payableSummary.outstandingTotal)}</div><div class="stat-sub">${overdueText(payableSummary.overdueCount, "เกินกำหนดชำระ")}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>สมการบัญชี</h3><span class="badge ${balanceSheet.isBalanced ? "success" : "danger"} dot">${balanceSheet.isBalanced ? "สมดุล" : "ไม่สมดุล"}</span></div>
      <div class="equation">
        <div><small>สินทรัพย์</small><strong>${formatAccounting(balanceSheet.totalAssets)}</strong></div><span class="op">=</span>
        <div><small>หนี้สิน</small><strong>${formatAccounting(balanceSheet.totalLiabilities)}</strong></div><span class="op">+</span>
        <div><small>ส่วนของเจ้าของ (รวมกำไรที่ยังไม่ปิดบัญชี)</small><strong>${formatAccounting(balanceSheet.totalEquity)}</strong></div>
      </div>
    </div>
    <div class="grid-3">
      ${renderIncomeChart()}
      ${renderHealthCheck(health, balanceSheet)}
    </div>
    <div class="grid-3" style="margin-top:18px">
      ${renderRecentEntries()}
      <div class="stack-gap">
        ${renderReceivableAging(receivableDocuments)}
        ${renderSystemCounts()}
      </div>
    </div>`;
}

const DASHBOARD_COLLECTIONS = ["accounts", "entries", "customers", "customerNames", "customerCosts", "incomingDocs"];
byId("dash-presets").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-preset]");
  if (!chip) return;
  const period = getPresetPeriod(chip.dataset.preset);
  if (chip.dataset.preset === "period" && !period.from && !period.to) {
    byId("dash-period").textContent = "ยังไม่ได้กำหนดงวดบัญชีในหน้าการตั้งค่า";
    return;
  }
  fromDateInput.value = period.from;
  toDateInput.value = period.to;
  renderDashboard();
});
[fromDateInput, toDateInput].forEach((input) => input.addEventListener("change", renderDashboard));

if (await loadData(DASHBOARD_COLLECTIONS)) {
  const monthFilter = createMonthFilter({
    fromInput: fromDateInput,
    toInput: toDateInput,
    getRecords: () => state.entries,
    onSelect: renderDashboard,
  });
  // ค่าเริ่มต้น: เดือนล่าสุดที่มีรายการ
  // เดือนที่เลือกไว้ในหน้าอื่น (ถ้ามี) ไม่เช่นนั้นเดือนล่าสุดที่มีรายการ
  const latestMonth = getInitialMonthRange(state.entries);
  fromDateInput.value = latestMonth.from;
  toDateInput.value = latestMonth.to;
  renderDashboard();
  onDataRefresh(() => {
    monthFilter.refresh();
    renderDashboard();
  });
}

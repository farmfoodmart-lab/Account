/**
 * @file หน้า "ภาษีซื้อ-ภาษีขาย" — สรุปภาษีมูลค่าเพิ่มรายเดือน และรายงานภาษีซื้อ/ขายสำหรับยื่น ภ.พ.30
 *
 * ทุกตัวเลขมาจากสมุดรายวันทั่วไป:
 * - ภาษีขาย = รายการที่มีบรรทัดเครดิตบัญชีภาษีขาย; มูลค่า = ผลรวมบรรทัดเครดิตอื่นในรายการเดียวกัน (เช่น รายได้)
 * - ภาษีซื้อ = รายการที่มีบรรทัดเดบิตบัญชีภาษีซื้อ; มูลค่า = ผลรวมบรรทัดเดบิตอื่นในรายการเดียวกัน (เช่น ค่าใช้จ่าย)
 * - ชื่อและเลขผู้เสียภาษีมาจากคู่ค้าของรายการ (เลขผู้เสียภาษีจากทะเบียนลูกค้า)
 */
import { loadData, onDataRefresh, state } from "../../src/core/store.js";
import { AMOUNT_EPSILON } from "../../src/accounting/constants.js";
import { findAccountForRole, formatAccountLabel } from "../../src/accounting/accounts.js";
import { findCustomerById, getCustomerDisplayName } from "../../src/accounting/customers.js";
import { roundMoney } from "../../src/accounting/posting.js";
import { notifyError, notifySuccess } from "../../src/components/notifications.js";
import { buildCsv } from "../../src/utils/csv.js";
import { getFileDateStamp, getTodayIso, toIsoDate } from "../../src/utils/date.js";
import { getInitialMonthRange, rememberSelectedMonth } from "../../src/components/month-filter.js";
import { byId } from "../../src/utils/dom.js";
import { downloadCsv } from "../../src/utils/download.js";
import { escapeHtml, formatDate, formatMoney, formatNumber } from "../../src/utils/format.js";

const yearSelect = byId("vat-year");
const monthSelect = byId("vat-month");

const THAI_MONTH_NAMES = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** ปี ค.ศ. → พ.ศ. */
const toBuddhistYear = (gregorianYear) => Number(gregorianYear) + 543;

/** "01".."12" */
const toMonthValue = (monthIndex) => String(monthIndex + 1).padStart(2, "0");

/** ชื่อเดือนที่เลือกอยู่ */
const getSelectedMonthName = () => THAI_MONTH_NAMES[Number(monthSelect.value) - 1];

/** ยอดติดลบแสดงในวงเล็บ ยอดศูนย์แสดงขีด */
function formatSignedAmount(amount) {
  if (Math.abs(amount) < AMOUNT_EPSILON) return "-";
  return amount > 0 ? formatMoney(amount) : `(${formatMoney(-amount)})`;
}

/**
 * ภาษีขาย/ภาษีซื้อรายเดือนจากบัญชีแยกประเภท ของปีที่เลือก
 * @param {string} year "YYYY"
 */
function summarizeVatByMonth(year) {
  const outputVatAccount = findAccountForRole("vatOutput");
  const inputVatAccount = findAccountForRole("vatInput");
  const months = THAI_MONTH_NAMES.map(() => ({ outputVat: 0, inputVat: 0 }));

  state.entries.forEach((entry) => {
    const isoDate = toIsoDate(entry.date);
    if (!isoDate.startsWith(`${year}-`)) return;
    const month = months[Number(isoDate.slice(5, 7)) - 1];
    entry.lines.forEach((line) => {
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      // ภาษีขายเป็นหนี้สิน (ด้านเครดิต) ภาษีซื้อเป็นสินทรัพย์ (ด้านเดบิต)
      if (outputVatAccount && line.accountId === outputVatAccount.id) month.outputVat += credit - debit;
      if (inputVatAccount && line.accountId === inputVatAccount.id) month.inputVat += debit - credit;
    });
  });
  return { outputVatAccount, inputVatAccount, months };
}

/**
 * แยกรายการหนึ่งรายการเป็น มูลค่า + VAT ตามบัญชีภาษีที่กำหนด
 * @param {object} entry รายการในสมุดรายวัน
 * @param {object} vatAccount บัญชีภาษีขายหรือภาษีซื้อ
 * @param {"credit" | "debit"} vatSide ด้านปกติของภาษี (ภาษีขาย = credit, ภาษีซื้อ = debit)
 * @returns {{ net: number, vat: number } | null} null ถ้ารายการนี้ไม่มีภาษี
 */
function splitVatEntry(entry, vatAccount, vatSide) {
  const otherSide = vatSide === "credit" ? "debit" : "credit";
  let vat = 0;
  let net = 0;
  entry.lines.forEach((line) => {
    const sideAmount = Number(line[vatSide]) || 0;
    if (line.accountId === vatAccount.id) vat += sideAmount - (Number(line[otherSide]) || 0);
    else net += sideAmount;
  });
  if (Math.abs(vat) < AMOUNT_EPSILON) return null;
  return { net: roundMoney(net), vat: roundMoney(vat) };
}

/**
 * เอกสารขาย/ซื้อที่มี VAT ในเดือนที่กำหนด (จากสมุดรายวัน)
 * @param {string} yearMonth "YYYY-MM"
 */
function getVatDocuments(yearMonth) {
  const outputVatAccount = findAccountForRole("vatOutput");
  const inputVatAccount = findAccountForRole("vatInput");
  const entriesInMonth = state.entries.filter((entry) => (toIsoDate(entry.date) || "").startsWith(yearMonth));
  const byDate = (left, right) => String(toIsoDate(left.record.date)).localeCompare(String(toIsoDate(right.record.date)));

  /** แปลงรายการเป็นแถวรายงาน (ข้ามรายการที่ไม่มีภาษี) */
  const toReportRows = (vatAccount, vatSide) => (vatAccount ? entriesInMonth : [])
    .map((entry) => {
      const amounts = splitVatEntry(entry, vatAccount, vatSide);
      if (!amounts) return null;
      const customer = entry.customerId ? findCustomerById(entry.customerId) : null;
      return {
        record: entry,
        partyName: entry.customerId || entry.customerName ? getCustomerDisplayName(entry) : "-",
        taxId: customer?.tax || "",
        ...amounts,
      };
    })
    .filter(Boolean)
    .sort(byDate);

  return {
    salesDocuments: toReportRows(outputVatAccount, "credit"),
    purchaseDocuments: toReportRows(inputVatAccount, "debit"),
  };
}

/** ตารางรายงานภาษี (ขายหรือซื้อ) แบบที่ใช้ยื่นสรรพากร */
function renderVatReport(title, documents, emptyMessage) {
  const totalNet = documents.reduce((total, row) => total + row.net, 0);
  const totalVat = documents.reduce((total, row) => total + row.vat, 0);
  const companyTaxId = state.settings.taxId ? ` · เลขผู้เสียภาษี ${escapeHtml(state.settings.taxId)}` : "";
  const bodyRows = documents.length
    ? documents.map((row, index) => `<tr>
        <td>${index + 1}</td>
        <td class="nowrap">${escapeHtml(formatDate(row.record.date))}</td>
        <td class="nowrap">${escapeHtml(row.record.docNo || "")}</td>
        <td>${escapeHtml(row.partyName)}</td>
        <td class="code">${escapeHtml(row.taxId)}</td>
        <td class="right">${formatMoney(row.net)}</td>
        <td class="right">${formatMoney(row.vat)}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="muted">${emptyMessage}</td></tr>`;

  return `<div class="report">
    <div class="report-head">
      <div class="company">${escapeHtml(state.settings.company || "กิจการของฉัน")}${companyTaxId}</div>
      <h3>${title}</h3>
      <div class="muted">เดือน${getSelectedMonthName()} ${toBuddhistYear(yearSelect.value)}</div>
    </div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th style="width:44px">ลำดับ</th><th class="col-date">วันที่</th><th>เลขที่</th><th>ชื่อ</th><th>เลขผู้เสียภาษี</th><th class="right col-amount">มูลค่าสินค้า/บริการ</th><th class="right col-amount">ภาษีมูลค่าเพิ่ม</th></tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot><tr class="grand-total"><td colspan="5"><strong>รวม ${formatNumber(documents.length)} รายการ</strong></td><td class="right"><strong>${formatMoney(totalNet)}</strong></td><td class="right"><strong>${formatMoney(totalVat)}</strong></td></tr></tfoot>
    </table></div>
  </div>`;
}

/** ตารางสรุป 12 เดือน (คลิกแถวเพื่อเลือกเดือน) */
function renderMonthlySummary(year, months) {
  const yearOutputVat = months.reduce((total, month) => total + month.outputVat, 0);
  const yearInputVat = months.reduce((total, month) => total + month.inputVat, 0);
  const rows = months.map((month, monthIndex) => {
    const netVat = month.outputVat - month.inputVat;
    const isSelected = toMonthValue(monthIndex) === monthSelect.value;
    return `<tr data-month="${toMonthValue(monthIndex)}" style="cursor:pointer${isSelected ? ";background:var(--accent-soft)" : ""}">
      <td>${THAI_MONTH_NAMES[monthIndex]}</td>
      <td class="right">${month.outputVat ? formatMoney(month.outputVat) : "-"}</td>
      <td class="right">${month.inputVat ? formatMoney(month.inputVat) : "-"}</td>
      <td class="right ${netVat > 0 ? "" : "balanced"}">${formatSignedAmount(netVat)}</td>
    </tr>`;
  }).join("");

  return `<div class="card flush" style="margin-bottom:18px">
    <div class="card-head" style="padding-bottom:12px"><h3>สรุปรายเดือน ปี ${toBuddhistYear(year)}</h3><span class="muted">คลิกเดือนเพื่อดูรายละเอียด</span></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>เดือน</th><th class="right">ภาษีขาย</th><th class="right">ภาษีซื้อ</th><th class="right">ต้องชำระ / (ชำระเกิน)</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>รวมทั้งปี</th><th class="right">${formatMoney(yearOutputVat)}</th><th class="right">${formatMoney(yearInputVat)}</th><th class="right">${formatSignedAmount(yearOutputVat - yearInputVat)}</th></tr></tfoot>
    </table></div>
  </div>`;
}

function renderVatPage() {
  const container = byId("vat-view");
  const year = yearSelect.value;
  const { outputVatAccount, inputVatAccount, months } = summarizeVatByMonth(year);
  if (!outputVatAccount && !inputVatAccount) {
    container.innerHTML = '<div class="empty-state"><strong>ยังไม่มีบัญชีภาษีขาย/ภาษีซื้อ</strong>เพิ่มบัญชี 2103 ภาษีขาย และ 1107 ภาษีซื้อ ในผังบัญชี (หรือกด “เพิ่มผังบัญชีมาตรฐาน”) แล้วกำหนดที่หน้าการตั้งค่า<br><a class="btn" href="../accounts/accounts.html">ไปที่ผังบัญชี</a></div>';
    return;
  }

  const selectedMonth = months[Number(monthSelect.value) - 1];
  const netVat = selectedMonth.outputVat - selectedMonth.inputVat;
  const { salesDocuments, purchaseDocuments } = getVatDocuments(`${year}-${monthSelect.value}`);

  container.innerHTML = `
    <div class="cards">
      <div class="stat accent-liability"><div class="muted">ภาษีขาย (${getSelectedMonthName()})</div><div class="stat-value">${formatMoney(selectedMonth.outputVat)}</div><div class="stat-sub">${escapeHtml(outputVatAccount ? formatAccountLabel(outputVatAccount) : "ไม่มีบัญชี")}</div></div>
      <div class="stat accent-asset"><div class="muted">ภาษีซื้อ</div><div class="stat-value">${formatMoney(selectedMonth.inputVat)}</div><div class="stat-sub">${escapeHtml(inputVatAccount ? formatAccountLabel(inputVatAccount) : "ไม่มีบัญชี")}</div></div>
      <div class="stat${netVat > 0 ? " is-alert" : ""}"><div class="muted">${netVat >= 0 ? "ภาษีที่ต้องชำระ" : "ภาษีชำระเกิน (ขอคืน/ยกไป)"}</div><div class="stat-value ${netVat > 0 ? "unbalanced" : "balanced"}">${formatMoney(Math.abs(netVat))}</div><div class="stat-sub">ยื่น ภ.พ.30 ภายในวันที่ 15 ของเดือนถัดไป</div></div>
    </div>
    ${renderMonthlySummary(year, months)}
    <div class="stack-gap">
      ${renderVatReport("รายงานภาษีขาย", salesDocuments, "ไม่มีรายการขายที่มี VAT ในเดือนนี้")}
      ${renderVatReport("รายงานภาษีซื้อ", purchaseDocuments, "ไม่มีรายการซื้อที่มี VAT ในเดือนนี้")}
    </div>`;
}

function exportCsv() {
  const { salesDocuments, purchaseDocuments } = getVatDocuments(`${yearSelect.value}-${monthSelect.value}`);
  if (!salesDocuments.length && !purchaseDocuments.length) {
    notifyError("ไม่มีเอกสารในเดือนนี้");
    return;
  }
  const toRow = (reportType) => (row) => [reportType, formatDate(row.record.date), row.record.docNo || "", row.partyName, row.taxId, row.net, row.vat];
  const rows = [...salesDocuments.map(toRow("ภาษีขาย")), ...purchaseDocuments.map(toRow("ภาษีซื้อ"))];
  const headers = ["ประเภท", "วันที่", "เลขที่", "ชื่อ", "เลขผู้เสียภาษี", "มูลค่า", "VAT"];
  downloadCsv(`vat-${yearSelect.value}${monthSelect.value}-${getFileDateStamp()}.csv`, buildCsv(headers, rows));
  notifySuccess("ส่งออกรายงานภาษีเรียบร้อย");
}

/** ตัวเลือกปี (ทุกปีที่มีรายการ + ปีปัจจุบัน) และเดือน โดยเลือกเดือนล่าสุดที่มีรายการไว้ */
function renderPeriodPickers() {
  const today = getTodayIso();
  const years = new Set([today.slice(0, 4)]);
  state.entries.forEach((entry) => {
    const isoDate = toIsoDate(entry.date);
    if (isoDate) years.add(isoDate.slice(0, 4));
  });
  yearSelect.innerHTML = [...years].sort().reverse()
    .map((year) => `<option value="${year}">${toBuddhistYear(year)} (${year})</option>`).join("");
  monthSelect.innerHTML = THAI_MONTH_NAMES
    .map((monthName, monthIndex) => `<option value="${toMonthValue(monthIndex)}">${monthName}</option>`).join("");
  // เดือนที่เลือกไว้ในหน้าอื่น (ถ้ามี) ไม่เช่นนั้นเดือนล่าสุดที่มีรายการ
  const latestMonth = getInitialMonthRange(state.entries).from;
  if (![...yearSelect.options].some((option) => option.value === latestMonth.slice(0, 4))) {
    yearSelect.add(new Option(`${toBuddhistYear(latestMonth.slice(0, 4))} (${latestMonth.slice(0, 4)})`, latestMonth.slice(0, 4)));
  }
  yearSelect.value = latestMonth.slice(0, 4);
  monthSelect.value = latestMonth.slice(5, 7);
}

byId("vat-view").addEventListener("click", (event) => {
  const monthRow = event.target.closest("[data-month]");
  if (!monthRow) return;
  monthSelect.value = monthRow.dataset.month;
  handlePeriodChange();
});
/** จำเดือนที่เลือกให้หน้าอื่นใช้ร่วมกัน แล้ววาดใหม่ */
function handlePeriodChange() {
  rememberSelectedMonth(`${yearSelect.value}-${monthSelect.value}`);
  renderVatPage();
}
yearSelect.addEventListener("change", handlePeriodChange);
monthSelect.addEventListener("change", handlePeriodChange);
byId("vat-export").addEventListener("click", exportCsv);

if (await loadData(["accounts", "entries", "customers", "suppliers"])) {
  renderPeriodPickers();
  renderVatPage();
  onDataRefresh(renderVatPage);
}

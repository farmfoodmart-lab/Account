import {
  AMOUNT_EPSILON,
  accountLabel,
  customerLabel,
  esc,
  fmt,
  fmtDateDMY,
  fmtInt,
  getCustomer,
  load,
  onDataRefresh,
  roleAccount,
  state,
} from "../../js/data.js";
import { toIsoDate } from "../../js/reports.js";
import { docAmounts } from "../../js/posting.js";
import { downloadCsvFile, fileStamp, todayIso, toastError, toastSuccess } from "../../js/ui.js";
import { toCsv } from "../../js/csv.js";

const $ = (id) => document.getElementById(id);
const yearSelect = $("vat-year");
const monthSelect = $("vat-month");
const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** Monthly VAT movement from the general ledger for one year. */
function ledgerByMonth(year) {
  const output = roleAccount("vatOutput");
  const input = roleAccount("vatInput");
  const months = MONTHS.map(() => ({ output: 0, input: 0 }));
  state.entries.forEach((entry) => {
    const iso = toIsoDate(entry.date);
    if (!iso.startsWith(`${year}-`)) return;
    const bucket = months[Number(iso.slice(5, 7)) - 1];
    entry.lines.forEach((line) => {
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      if (output && line.accountId === output.id) bucket.output += credit - debit;
      if (input && line.accountId === input.id) bucket.input += debit - credit;
    });
  });
  return { output, input, months };
}

function documentsFor(month) {
  const inMonth = (record) => (toIsoDate(record.date) || "").startsWith(month);
  const sales = state.receivables.filter((record) => inMonth(record) && docAmounts(record).vat > AMOUNT_EPSILON).map((record) => {
    const customer = getCustomer(record.customerId);
    return { record, name: customer ? customerLabel(customer) : "-", taxId: customer?.tax || "", ...docAmounts(record) };
  });
  const purchases = state.payables.filter((record) => inMonth(record) && docAmounts(record).vat > AMOUNT_EPSILON).map((record) => ({
    record, name: record.vendorName || "-", taxId: record.vendorTaxId || "", ...docAmounts(record),
  }));
  const byDate = (left, right) => String(toIsoDate(left.record.date)).localeCompare(String(toIsoDate(right.record.date)));
  return { sales: sales.sort(byDate), purchases: purchases.sort(byDate) };
}

function docTable(title, rows, emptyText) {
  const totalNet = rows.reduce((sum, row) => sum + row.net, 0);
  const totalVat = rows.reduce((sum, row) => sum + row.vat, 0);
  return `<div class="report">
    <div class="report-head"><div class="company">${esc(state.settings.company || "กิจการของฉัน")}${state.settings.taxId ? ` · เลขผู้เสียภาษี ${esc(state.settings.taxId)}` : ""}</div><h3>${title}</h3><div class="muted">เดือน${MONTHS[Number(monthSelect.value) - 1]} ${Number(yearSelect.value) + 543}</div></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th style="width:44px">ลำดับ</th><th class="col-date">วันที่</th><th>เลขที่</th><th>ชื่อ</th><th>เลขผู้เสียภาษี</th><th class="right col-amt">มูลค่าสินค้า/บริการ</th><th class="right col-amt">ภาษีมูลค่าเพิ่ม</th></tr></thead>
      <tbody>${rows.length ? rows.map((row, index) => `<tr><td>${index + 1}</td><td class="nowrap">${esc(fmtDateDMY(row.record.date))}</td><td class="nowrap">${esc(row.record.docNo || "")}</td><td>${esc(row.name)}</td><td class="code">${esc(row.taxId)}</td><td class="right">${fmt(row.net)}</td><td class="right">${fmt(row.vat)}</td></tr>`).join("") : `<tr><td colspan="7" class="muted">${emptyText}</td></tr>`}</tbody>
      <tfoot><tr class="grand-total"><td colspan="5"><strong>รวม ${fmtInt(rows.length)} รายการ</strong></td><td class="right"><strong>${fmt(totalNet)}</strong></td><td class="right"><strong>${fmt(totalVat)}</strong></td></tr></tfoot>
    </table></div>
  </div>`;
}

function render() {
  const container = $("vat-view");
  const year = yearSelect.value;
  const month = `${year}-${monthSelect.value}`;
  const { output, input, months } = ledgerByMonth(year);
  if (!output && !input) {
    container.innerHTML = '<div class="empty-state"><strong>ยังไม่มีบัญชีภาษีขาย/ภาษีซื้อ</strong>เพิ่มบัญชี 2103 ภาษีขาย และ 1107 ภาษีซื้อ ในผังบัญชี (หรือกด “เพิ่มผังบัญชีมาตรฐาน”) แล้วกำหนดที่หน้าการตั้งค่า<br><a class="btn" href="../accounts/accounts.html">ไปที่ผังบัญชี</a></div>';
    return;
  }
  const selected = months[Number(monthSelect.value) - 1];
  const net = selected.output - selected.input;
  const yearOutput = months.reduce((sum, item) => sum + item.output, 0);
  const yearInput = months.reduce((sum, item) => sum + item.input, 0);
  const { sales, purchases } = documentsFor(month);
  const docOutput = sales.reduce((sum, row) => sum + row.vat, 0);
  const docInput = purchases.reduce((sum, row) => sum + row.vat, 0);
  const mismatch = Math.abs(docOutput - selected.output) >= AMOUNT_EPSILON || Math.abs(docInput - selected.input) >= AMOUNT_EPSILON;

  container.innerHTML = `
    <div class="cards">
      <div class="stat accent-liability"><div class="muted">ภาษีขาย (${MONTHS[Number(monthSelect.value) - 1]})</div><div class="stat-value">${fmt(selected.output)}</div><div class="stat-sub">${esc(output ? accountLabel(output) : "ไม่มีบัญชี")}</div></div>
      <div class="stat accent-asset"><div class="muted">ภาษีซื้อ</div><div class="stat-value">${fmt(selected.input)}</div><div class="stat-sub">${esc(input ? accountLabel(input) : "ไม่มีบัญชี")}</div></div>
      <div class="stat${net > 0 ? " is-alert" : ""}"><div class="muted">${net >= 0 ? "ภาษีที่ต้องชำระ" : "ภาษีชำระเกิน (ขอคืน/ยกไป)"}</div><div class="stat-value ${net > 0 ? "unbalanced" : "balanced"}">${fmt(Math.abs(net))}</div><div class="stat-sub">ยื่น ภ.พ.30 ภายในวันที่ 15 ของเดือนถัดไป</div></div>
    </div>
    ${mismatch ? `<div class="banner warn">ยอดจากเอกสารลูกหนี้/เจ้าหนี้ (ขาย ${fmt(docOutput)} · ซื้อ ${fmt(docInput)}) ไม่ตรงกับบัญชีแยกประเภท — อาจมีรายการภาษีที่บันทึกในสมุดรายวันโดยตรง</div>` : ""}
    <div class="card flush" style="margin-bottom:18px">
      <div class="card-head" style="padding-bottom:12px"><h3>สรุปรายเดือน ปี ${Number(year) + 543}</h3><span class="muted">คลิกเดือนเพื่อดูรายละเอียด</span></div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>เดือน</th><th class="right">ภาษีขาย</th><th class="right">ภาษีซื้อ</th><th class="right">ต้องชำระ / (ชำระเกิน)</th></tr></thead>
        <tbody>${months.map((item, index) => {
          const diff = item.output - item.input;
          const active = String(index + 1).padStart(2, "0") === monthSelect.value;
          return `<tr data-month="${String(index + 1).padStart(2, "0")}" style="cursor:pointer${active ? ";background:var(--accent-soft)" : ""}"><td>${MONTHS[index]}</td><td class="right">${item.output ? fmt(item.output) : "-"}</td><td class="right">${item.input ? fmt(item.input) : "-"}</td><td class="right ${diff > 0 ? "" : "balanced"}">${Math.abs(diff) < AMOUNT_EPSILON ? "-" : diff > 0 ? fmt(diff) : `(${fmt(-diff)})`}</td></tr>`;
        }).join("")}</tbody>
        <tfoot><tr><th>รวมทั้งปี</th><th class="right">${fmt(yearOutput)}</th><th class="right">${fmt(yearInput)}</th><th class="right">${yearOutput - yearInput < 0 ? `(${fmt(yearInput - yearOutput)})` : fmt(yearOutput - yearInput)}</th></tr></tfoot>
      </table></div>
    </div>
    <div class="stack-gap">
      ${docTable("รายงานภาษีขาย", sales, "ไม่มีเอกสารขายที่มี VAT ในเดือนนี้")}
      ${docTable("รายงานภาษีซื้อ", purchases, "ไม่มีเอกสารซื้อที่มี VAT ในเดือนนี้")}
    </div>`;
}

$("vat-view").addEventListener("click", (event) => {
  const row = event.target.closest("[data-month]");
  if (!row) return;
  monthSelect.value = row.dataset.month;
  render();
});
yearSelect.addEventListener("change", render);
monthSelect.addEventListener("change", render);

$("vat-export").addEventListener("click", () => {
  const { sales, purchases } = documentsFor(`${yearSelect.value}-${monthSelect.value}`);
  if (!sales.length && !purchases.length) return toastError("ไม่มีเอกสารในเดือนนี้");
  const rows = [
    ...sales.map((row) => ["ภาษีขาย", fmtDateDMY(row.record.date), row.record.docNo || "", row.name, row.taxId, row.net, row.vat]),
    ...purchases.map((row) => ["ภาษีซื้อ", fmtDateDMY(row.record.date), row.record.docNo || "", row.name, row.taxId, row.net, row.vat]),
  ];
  downloadCsvFile(`vat-${yearSelect.value}${monthSelect.value}-${fileStamp()}.csv`, toCsv(["ประเภท", "วันที่", "เลขที่", "ชื่อ", "เลขผู้เสียภาษี", "มูลค่า", "VAT"], rows));
  toastSuccess("ส่งออกรายงานภาษีเรียบร้อย");
});

function setupPickers() {
  const today = todayIso();
  const years = new Set([today.slice(0, 4)]);
  state.entries.forEach((entry) => {
    const iso = toIsoDate(entry.date);
    if (iso) years.add(iso.slice(0, 4));
  });
  yearSelect.innerHTML = [...years].sort().reverse().map((year) => `<option value="${year}">${Number(year) + 543} (${year})</option>`).join("");
  monthSelect.innerHTML = MONTHS.map((name, index) => `<option value="${String(index + 1).padStart(2, "0")}">${name}</option>`).join("");
  yearSelect.value = today.slice(0, 4);
  monthSelect.value = today.slice(5, 7);
}

if (await load(["accounts", "entries", "receivables", "payables", "customers"])) {
  setupPickers();
  render();
  onDataRefresh(render);
}

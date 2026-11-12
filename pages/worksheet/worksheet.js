import { AMOUNT_EPSILON, compareAccounts, esc, fmt, fmtDateDMY, load, state, onDataRefresh } from "../../js/data.js";
import { collectTotals, totalsFor } from "../../js/reports.js";
import { downloadCsvFile, fileStamp, toastSuccess } from "../../js/ui.js";
import { toCsv } from "../../js/csv.js";

const $ = (id) => document.getElementById(id);
const toInput = $("worksheet-to");

/** Split a signed debit-minus-credit amount into debit/credit columns. */
function split(debitMinusCredit) {
  return {
    debit: debitMinusCredit > AMOUNT_EPSILON ? debitMinusCredit : 0,
    credit: debitMinusCredit < -AMOUNT_EPSILON ? -debitMinusCredit : 0,
  };
}

function compute() {
  const to = toInput.value;
  const trialTotals = collectTotals(state.entries, { to, kinds: ["general"] });
  const adjustTotals = collectTotals(state.entries, { to, kinds: ["adjusting"] });
  const rows = [];
  const sum = { tbD: 0, tbC: 0, adjD: 0, adjC: 0, atbD: 0, atbC: 0, isD: 0, isC: 0, bsD: 0, bsC: 0 };

  state.accounts.slice().sort(compareAccounts).forEach((account) => {
    const trial = totalsFor(trialTotals, account.id);
    const adjust = totalsFor(adjustTotals, account.id);
    if (!trial.debit && !trial.credit && !adjust.debit && !adjust.credit) return;
    const tb = split(trial.debit - trial.credit);
    const atb = split(trial.debit - trial.credit + adjust.debit - adjust.credit);
    const isIncome = account.type === "revenue" || account.type === "expense";
    const row = {
      account,
      tbD: tb.debit, tbC: tb.credit,
      adjD: adjust.debit, adjC: adjust.credit,
      atbD: atb.debit, atbC: atb.credit,
      isD: isIncome ? atb.debit : 0, isC: isIncome ? atb.credit : 0,
      bsD: isIncome ? 0 : atb.debit, bsC: isIncome ? 0 : atb.credit,
    };
    Object.keys(sum).forEach((key) => { sum[key] += row[key]; });
    rows.push(row);
  });

  const netProfit = sum.isC - sum.isD;
  return { rows, sum, netProfit };
}

function cell(value, band = false) {
  return `<td class="right${band ? " band" : ""}">${value ? fmt(value) : ""}</td>`;
}

function renderWorksheet() {
  const container = $("worksheet-view");
  if (!state.accounts.length) {
    container.innerHTML = '<div class="empty-state"><strong>ยังไม่มีผังบัญชี</strong><a class="btn" href="../accounts/accounts.html">สร้างผังบัญชี</a></div>';
    return;
  }
  const { rows, sum, netProfit } = compute();
  const balanced = (a, b) => Math.abs(a - b) < AMOUNT_EPSILON;
  const checks = [
    ["งบทดลอง", balanced(sum.tbD, sum.tbC)],
    ["รายการปรับปรุง", balanced(sum.adjD, sum.adjC)],
    ["งบทดลองหลังปรับปรุง", balanced(sum.atbD, sum.atbC)],
  ];
  const allOk = checks.every(([, ok]) => ok);
  const profitD = Math.max(0, netProfit);
  const profitC = Math.max(0, -netProfit);

  const body = rows.map((row) => `<tr>
    <td class="code">${esc(row.account.code)}</td><td>${esc(row.account.name)}</td>
    ${cell(row.tbD, true)}${cell(row.tbC)}${cell(row.adjD, true)}${cell(row.adjC)}${cell(row.atbD, true)}${cell(row.atbC)}${cell(row.isD, true)}${cell(row.isC)}${cell(row.bsD, true)}${cell(row.bsC)}
  </tr>`).join("") || '<tr><td colspan="12" class="muted">ยังไม่มียอดคงเหลือ</td></tr>';

  container.innerHTML = `
    <div class="banner ${allOk ? "ok" : "bad"}">
      ${checks.map(([label, ok]) => `<span>${ok ? "✓" : "✕"} ${label}${ok ? "ดุล" : "ไม่ดุล"}</span>`).join("")}
      <span style="margin-left:auto"><strong>${netProfit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"} ${fmt(Math.abs(netProfit))}</strong></span>
    </div>
    <div class="table-wrap tall"><table class="ws-table" style="min-width:1180px">
    <thead>
      <tr><th rowspan="2" class="col-code">รหัส</th><th rowspan="2">ชื่อบัญชี</th><th colspan="2" class="band">งบทดลอง</th><th colspan="2" class="band">รายการปรับปรุง</th><th colspan="2" class="band">งบทดลองหลังปรับปรุง</th><th colspan="2" class="band">งบกำไรขาดทุน</th><th colspan="2" class="band">งบแสดงฐานะการเงิน</th></tr>
      <tr>${'<th class="right band">เดบิต</th><th class="right">เครดิต</th>'.repeat(5)}</tr>
    </thead>
    <tbody>${body}</tbody>
    <tfoot>
      <tr><th colspan="2">รวม</th>${["tbD", "tbC", "adjD", "adjC", "atbD", "atbC", "isD", "isC", "bsD", "bsC"].map((key, index) => `<th class="right${index % 2 === 0 ? " band" : ""}">${fmt(sum[key])}</th>`).join("")}</tr>
      <tr><th colspan="8">${netProfit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}</th><th class="right band">${profitD ? fmt(profitD) : ""}</th><th class="right">${profitC ? fmt(profitC) : ""}</th><th class="right band">${profitC ? fmt(profitC) : ""}</th><th class="right">${profitD ? fmt(profitD) : ""}</th></tr>
      <tr><th colspan="8">รวมทั้งสิ้น</th><th class="right band">${fmt(sum.isD + profitD)}</th><th class="right">${fmt(sum.isC + profitC)}</th><th class="right band">${fmt(sum.bsD + profitC)}</th><th class="right">${fmt(sum.bsC + profitD)}</th></tr>
    </tfoot>
  </table></div>
  <p class="table-meta">${toInput.value ? `ณ วันที่ ${esc(fmtDateDMY(toInput.value))}` : "รวมทุกรายการ"} · ไม่รวมรายการปิดบัญชี</p>`;
}

$("worksheet-export").addEventListener("click", () => {
  const { rows, sum } = compute();
  const keys = ["tbD", "tbC", "adjD", "adjC", "atbD", "atbC", "isD", "isC", "bsD", "bsC"];
  const csvRows = rows.map((row) => [row.account.code, row.account.name, ...keys.map((key) => row[key])]);
  csvRows.push(["", "รวม", ...keys.map((key) => sum[key])]);
  downloadCsvFile(`worksheet-${fileStamp()}.csv`, toCsv(["รหัส", "ชื่อบัญชี", "งบทดลอง Dr", "งบทดลอง Cr", "ปรับปรุง Dr", "ปรับปรุง Cr", "หลังปรับปรุง Dr", "หลังปรับปรุง Cr", "กำไรขาดทุน Dr", "กำไรขาดทุน Cr", "ฐานะการเงิน Dr", "ฐานะการเงิน Cr"], csvRows));
  toastSuccess("ส่งออกกระดาษทำการเรียบร้อย");
});

toInput.addEventListener("change", renderWorksheet);

if (await load(["accounts", "entries"])) {
  renderWorksheet();
  onDataRefresh(renderWorksheet);
}

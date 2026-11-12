import { TYPES, TYPE_ORDER, compareAccounts, esc, fmt, fmtDateDMY, fmtInt, load, state, onDataRefresh } from "../../js/data.js";
import { buildTrialBalance, collectTotals } from "../../js/reports.js";
import { downloadCsvFile, fileStamp, toastSuccess } from "../../js/ui.js";
import { toCsv } from "../../js/csv.js";

const $ = (id) => document.getElementById(id);
const toInput = $("trial-to");
const groupInput = $("trial-group");
const movementInput = $("trial-movement");

function compute() {
  const totals = collectTotals(state.entries, { to: toInput.value });
  const accounts = state.accounts.slice().sort(compareAccounts);
  return buildTrialBalance(accounts, totals);
}

function amount(value) {
  return value ? fmt(value) : "";
}

function renderTrial() {
  const container = $("trial-view");
  if (!state.accounts.length) {
    container.innerHTML = '<div class="empty-state"><strong>ยังไม่มีผังบัญชี</strong><a class="btn" href="../accounts/accounts.html">สร้างผังบัญชี</a></div>';
    return;
  }
  const { rows, totalDebit, totalCredit, isBalanced } = compute();
  const showMovement = movementInput.checked;
  const columns = showMovement ? 7 : 5;
  const asAt = toInput.value ? `ณ วันที่ ${fmtDateDMY(toInput.value)}` : "ณ ปัจจุบัน (ทุกรายการ)";

  const rowHtml = (row) => `<tr>
    <td class="code">${esc(row.account.code)}</td>
    <td><a href="../ledger/ledger.html?account=${encodeURIComponent(row.account.id)}" title="ดูบัญชีแยกประเภท">${esc(row.account.name)}</a></td>
    ${showMovement ? `<td class="right muted">${amount(row.debit)}</td><td class="right muted">${amount(row.credit)}</td>` : ""}
    <td class="right">${amount(row.balanceDebit)}</td>
    <td class="right">${amount(row.balanceCredit)}</td>
    <td>${!row.balanceDebit && !row.balanceCredit ? '<span class="badge">ยอดเป็นศูนย์</span>' : ""}</td>
  </tr>`;

  let body = "";
  if (!rows.length) {
    body = `<tr><td colspan="${columns}" class="muted">ยังไม่มียอดคงเหลือ</td></tr>`;
  } else if (groupInput.checked) {
    const types = [...TYPE_ORDER, ...new Set(rows.map((row) => row.account.type).filter((type) => !TYPE_ORDER.includes(type)))];
    types.forEach((type) => {
      const groupRows = rows.filter((row) => row.account.type === type);
      if (!groupRows.length) return;
      const debit = groupRows.reduce((sum, row) => sum + row.balanceDebit, 0);
      const credit = groupRows.reduce((sum, row) => sum + row.balanceCredit, 0);
      body += `<tr class="group-head"><td colspan="${columns}"><span class="badge type-${esc(type)}">${esc(TYPES[type] || "อื่น ๆ")}</span></td></tr>`;
      body += groupRows.map(rowHtml).join("");
      body += `<tr class="subtotal"><td></td><td>รวม${esc(TYPES[type] || "")}</td>${showMovement ? "<td></td><td></td>" : ""}<td class="right">${amount(debit)}</td><td class="right">${amount(credit)}</td><td></td></tr>`;
    });
  } else {
    body = rows.map(rowHtml).join("");
  }

  const difference = Math.abs(totalDebit - totalCredit);
  const statusClass = isBalanced ? "balanced" : "unbalanced";
  container.innerHTML = `
    <div class="banner ${isBalanced ? "ok" : "bad"}">
      <strong>${isBalanced ? "✓ งบทดลองดุล" : "✕ งบทดลองไม่ดุล"}</strong>
      <span>${isBalanced ? `ยอดเดบิตและเครดิตเท่ากัน ${fmt(totalDebit)}` : `ผลต่าง ${fmt(difference)} — ตรวจสอบรายการที่บันทึกในสมุดรายวัน`}</span>
      <span style="margin-left:auto" class="muted">${fmtInt(rows.length)} บัญชี · ${esc(asAt)}</span>
    </div>
    <div class="report" style="margin-bottom:0">
      <div class="report-head"><div class="company">${esc(state.settings.company || "กิจการของฉัน")}</div><h3>งบทดลอง</h3><div class="muted">${esc(asAt)}</div></div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th class="col-code">รหัส</th><th>ชื่อบัญชี</th>${showMovement ? '<th class="right col-amt">ยอดเคลื่อนไหวเดบิต</th><th class="right col-amt">ยอดเคลื่อนไหวเครดิต</th>' : ""}<th class="right col-amt">เดบิต</th><th class="right col-amt">เครดิต</th><th class="col-act"></th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr class="grand-total"><td colspan="${showMovement ? 4 : 2}"><strong>รวม</strong></td><td class="right ${statusClass}"><strong>${fmt(totalDebit)}</strong></td><td class="right ${statusClass}"><strong>${fmt(totalCredit)}</strong></td><td></td></tr></tfoot>
      </table></div>
    </div>`;
}

$("trial-export").addEventListener("click", () => {
  const { rows, totalDebit, totalCredit } = compute();
  const csvRows = rows.map((row) => [row.account.code, row.account.name, TYPES[row.account.type] || row.account.type || "", row.debit, row.credit, row.balanceDebit, row.balanceCredit]);
  csvRows.push(["", "รวม", "", "", "", totalDebit, totalCredit]);
  downloadCsvFile(`trial-balance-${fileStamp()}.csv`, toCsv(["รหัส", "ชื่อบัญชี", "หมวด", "เคลื่อนไหวเดบิต", "เคลื่อนไหวเครดิต", "ยอดคงเหลือเดบิต", "ยอดคงเหลือเครดิต"], csvRows));
  toastSuccess("ส่งออกงบทดลองเรียบร้อย");
});

[toInput, groupInput, movementInput].forEach((input) => input.addEventListener("change", renderTrial));

if (await load(["accounts", "entries"])) {
  renderTrial();
  onDataRefresh(renderTrial);
}

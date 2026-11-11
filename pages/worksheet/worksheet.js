import { accountBalance, balanceColumns, esc, fmt, load, state } from "../../js/data.js";

function renderWorksheet() {
  const worksheetContainer = document.getElementById("worksheet-view");
  if (!state.accounts.length) {
    worksheetContainer.innerHTML = '<p class="empty-state">ยังไม่มีหมวดหมู่บัญชี</p>';
    return;
  }

  let totalTrialDebit = 0;
  let totalTrialCredit = 0;
  let totalIncomeDebit = 0;
  let totalIncomeCredit = 0;
  let totalBalanceDebit = 0;
  let totalBalanceCredit = 0;
  const worksheetRows = [];

  state.accounts.forEach((account) => {
    const { debit, credit, net } = accountBalance(account);
    const trialBalanceColumns = balanceColumns(account, net);
    if (!trialBalanceColumns.debit && !trialBalanceColumns.credit && !debit && !credit) return;
    totalTrialDebit += trialBalanceColumns.debit;
    totalTrialCredit += trialBalanceColumns.credit;
    const isIncomeStatementAccount = account.type === "revenue" || account.type === "expense";
    const incomeDebit = isIncomeStatementAccount ? trialBalanceColumns.debit : 0;
    const incomeCredit = isIncomeStatementAccount ? trialBalanceColumns.credit : 0;
    const balanceDebit = isIncomeStatementAccount ? 0 : trialBalanceColumns.debit;
    const balanceCredit = isIncomeStatementAccount ? 0 : trialBalanceColumns.credit;
    totalIncomeDebit += incomeDebit;
    totalIncomeCredit += incomeCredit;
    totalBalanceDebit += balanceDebit;
    totalBalanceCredit += balanceCredit;
    worksheetRows.push(`<tr><td>${esc(account.code)}</td><td>${esc(account.name)}</td><td class="right">${trialBalanceColumns.debit ? fmt(trialBalanceColumns.debit) : ""}</td><td class="right">${trialBalanceColumns.credit ? fmt(trialBalanceColumns.credit) : ""}</td><td class="right"></td><td class="right"></td><td class="right">${trialBalanceColumns.debit ? fmt(trialBalanceColumns.debit) : ""}</td><td class="right">${trialBalanceColumns.credit ? fmt(trialBalanceColumns.credit) : ""}</td><td class="right">${incomeDebit ? fmt(incomeDebit) : ""}</td><td class="right">${incomeCredit ? fmt(incomeCredit) : ""}</td><td class="right">${balanceDebit ? fmt(balanceDebit) : ""}</td><td class="right">${balanceCredit ? fmt(balanceCredit) : ""}</td></tr>`);
  });

  const netProfit = totalIncomeCredit - totalIncomeDebit;
  const incomeDebitTotal = totalIncomeDebit + Math.max(0, netProfit);
  const incomeCreditTotal = totalIncomeCredit + Math.max(0, -netProfit);
  const balanceDebitTotal = totalBalanceDebit + Math.max(0, -netProfit);
  const balanceCreditTotal = totalBalanceCredit + Math.max(0, netProfit);
  worksheetContainer.innerHTML = `<div class="table-wrap animate-fade-up"><table>
    <thead><tr><th rowspan="2">รหัส</th><th rowspan="2">ชื่อบัญชี</th><th colspan="2">งบทดลอง</th><th colspan="2">ปรับปรุง</th><th colspan="2">หลังปรับปรุง</th><th colspan="2">งบกำไรขาดทุน</th><th colspan="2">งบดุล</th></tr><tr><th class="right">เดบิต</th><th class="right">เครดิต</th><th class="right">เดบิต</th><th class="right">เครดิต</th><th class="right">เดบิต</th><th class="right">เครดิต</th><th class="right">เดบิต</th><th class="right">เครดิต</th><th class="right">เดบิต</th><th class="right">เครดิต</th></tr></thead>
    <tbody>${worksheetRows.join("") || '<tr><td colspan="12" class="muted">ยังไม่มียอดคงเหลือ</td></tr>'}</tbody>
    <tfoot><tr><th colspan="2">รวม</th><th class="right">${fmt(totalTrialDebit)}</th><th class="right">${fmt(totalTrialCredit)}</th><th class="right">-</th><th class="right">-</th><th class="right">${fmt(totalTrialDebit)}</th><th class="right">${fmt(totalTrialCredit)}</th><th class="right">${fmt(totalIncomeDebit)}</th><th class="right">${fmt(totalIncomeCredit)}</th><th class="right">${fmt(totalBalanceDebit)}</th><th class="right">${fmt(totalBalanceCredit)}</th></tr>
    <tr><th colspan="8">กำไร (ขาดทุน) สุทธิ</th><th class="right">${netProfit >= 0 ? fmt(netProfit) : ""}</th><th class="right">${netProfit < 0 ? fmt(-netProfit) : ""}</th><th class="right">${netProfit < 0 ? fmt(-netProfit) : ""}</th><th class="right">${netProfit >= 0 ? fmt(netProfit) : ""}</th></tr>
    <tr><th colspan="8">รวมหลังปิดบัญชี</th><th class="right">${fmt(incomeDebitTotal)}</th><th class="right">${fmt(incomeCreditTotal)}</th><th class="right">${fmt(balanceDebitTotal)}</th><th class="right">${fmt(balanceCreditTotal)}</th></tr></tfoot>
  </table></div>`;
}

if (await load(["accounts", "entries"])) renderWorksheet();

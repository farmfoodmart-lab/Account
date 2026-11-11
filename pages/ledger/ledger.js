import { esc, fmt, fmtDateDMY, fmtInt, load, normalDebit, state, TYPES } from "../../js/data.js";

const typeSelect = document.getElementById("ledger-type");
const accountSelect = document.getElementById("ledger-account");
const ledgerContainer = document.getElementById("ledger-view");

function getLedgerGroups(accounts) {
  const knownTypes = Object.keys(TYPES);
  const extraTypes = [...new Set(accounts.map((account) => account.type || "other"))]
    .filter((type) => !knownTypes.includes(type));
  return [...knownTypes, ...extraTypes]
    .map((type) => ({
      type,
      label: TYPES[type] || (type === "other" ? "อื่น ๆ" : type),
      accounts: accounts
        .filter((account) => (account.type || "other") === type)
        .sort((leftAccount, rightAccount) => String(leftAccount.code || "").localeCompare(String(rightAccount.code || ""), "th-TH", { numeric: true })),
    }))
    .filter((group) => group.accounts.length);
}

function renderAccount(account) {
  const entries = state.entries
    .filter((entry) => entry.lines.some((line) => line.accountId === account.id))
    .sort((earlierEntry, laterEntry) => (earlierEntry.date || "").localeCompare(laterEntry.date || ""));
  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = [];

  entries.forEach((entry) => entry.lines.forEach((line) => {
    if (line.accountId !== account.id) return;
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    running += normalDebit(account.type) ? debit - credit : credit - debit;
    totalDebit += debit;
    totalCredit += credit;
    rows.push(`<tr><td>${esc(fmtDateDMY(entry.date))}</td><td>${esc(entry.desc || "")}</td><td class="right">${debit ? fmt(debit) : ""}</td><td class="right">${credit ? fmt(credit) : ""}</td><td class="right">${fmt(running)}</td></tr>`);
  }));

  const details = entries.length
    ? `<div class="table-wrap ledger-table-wrap"><table><thead><tr><th>วันที่</th><th>รายละเอียด</th><th class="right">เดบิต</th><th class="right">เครดิต</th><th class="right">คงเหลือ</th></tr></thead><tbody>${rows.join("")}</tbody><tfoot><tr><th colspan="2">รวม</th><th class="right">${fmt(totalDebit)}</th><th class="right">${fmt(totalCredit)}</th><th class="right">${fmt(running)}</th></tr></tfoot></table></div>`
    : '<p class="ledger-empty muted">ไม่มีการเคลื่อนไหวในบัญชีนี้</p>';
  return `<article class="ledger-account card"><div class="ledger-account-head"><h4>${esc(account.code)} - ${esc(account.name)}</h4><span class="ledger-balance">คงเหลือ ${fmt(running)}</span></div><div class="ledger-detail"><span class="ledger-detail-label">รายละเอียด</span>${details}</div></article>`;
}

function renderLedger() {
  const type = typeSelect.value;
  const accountId = accountSelect.value;
  const accounts = state.accounts.filter((account) =>
    (!type || (account.type || "other") === type) && (!accountId || account.id === accountId),
  );
  if (!accounts.length) {
    ledgerContainer.innerHTML = state.accounts.length
      ? '<p class="empty-state">ไม่พบบัญชีในตัวกรองนี้</p>'
      : '<p class="empty-state">ยังไม่มีหมวดหมู่บัญชี</p>';
    return;
  }
  ledgerContainer.innerHTML = getLedgerGroups(accounts).map((group) =>
    `<section class="ledger-group"><div class="ledger-group-head"><h3>${esc(group.label)}</h3><span>${fmtInt(group.accounts.length)} บัญชี</span></div><div class="ledger-group-accounts">${group.accounts.map(renderAccount).join("")}</div></section>`,
  ).join("");
}

function renderFilters() {
  const groups = getLedgerGroups(state.accounts);
  const currentType = typeSelect.value;
  const currentAccount = accountSelect.value;
  typeSelect.innerHTML = '<option value="">ทุกหมวด</option>' +
    groups.map((group) => `<option value="${esc(group.type)}">${esc(group.label)}</option>`).join("");
  typeSelect.value = groups.some((group) => group.type === currentType) ? currentType : "";
  const availableGroups = typeSelect.value
    ? groups.filter((group) => group.type === typeSelect.value)
    : groups;
  const accounts = availableGroups.flatMap((group) => group.accounts);
  accountSelect.innerHTML = `<option value="">${typeSelect.value ? "ทุกบัญชีในหมวดนี้" : "ทุกบัญชี"}</option>` +
    availableGroups.map((group) =>
      `<optgroup label="${esc(group.label)}">${group.accounts.map((account) => `<option value="${esc(account.id)}">${esc(account.code)} - ${esc(account.name)}</option>`).join("")}</optgroup>`,
    ).join("");
  accountSelect.value = accounts.some((account) => account.id === currentAccount) ? currentAccount : "";
  renderLedger();
}

typeSelect.addEventListener("change", renderFilters);
accountSelect.addEventListener("change", renderLedger);
if (await load(["accounts", "entries"])) renderFilters();

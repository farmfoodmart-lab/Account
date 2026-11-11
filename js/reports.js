/**
 * Pure accounting calculations for the report screens.
 * No DOM access and no global state - everything is passed in.
 */

export const BALANCE_EPSILON = 0.005;

const DEBIT_NORMAL_TYPES = new Set(["asset", "expense"]);

export function isDebitNormal(type) {
  return DEBIT_NORMAL_TYPES.has(type);
}

/**
 * Normalise the date shapes the app can hold (ISO or DMY text) to YYYY-MM-DD.
 * Returns an empty string when the value is unusable.
 */
export function toIsoDate(value) {
  if (value == null || value === "") return "";
  const text = String(value).trim();

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return (
      iso[1] + "-" + iso[2].padStart(2, "0") + "-" + iso[3].padStart(2, "0")
    );
  }

  const dmy = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) {
    return (
      dmy[3] + "-" + dmy[2].padStart(2, "0") + "-" + dmy[1].padStart(2, "0")
    );
  }

  return "";
}

export function inDateRange(date, from = "", to = "") {
  const iso = toIsoDate(date);
  if (!iso) return !from && !to;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

function plus(a, b) {
  return a + b;
}

function sumAmounts(rows) {
  return rows.map((row) => row.amount).reduce(plus, 0);
}

/**
 * Sum debit/credit movement per account for the entries inside the range.
 * Returns a Map of accountId to { debit, credit }.
 */
export function collectTotals(entries, { from = "", to = "" } = {}) {
  const totals = new Map();

  entries.forEach((entry) => {
    if (!inDateRange(entry.date, from, to)) return;
    (entry.lines || []).forEach((line) => {
      if (!line || !line.accountId) return;
      const current = totals.get(line.accountId) || { debit: 0, credit: 0 };
      current.debit += Number(line.debit) || 0;
      current.credit += Number(line.credit) || 0;
      totals.set(line.accountId, current);
    });
  });

  return totals;
}

export function totalsFor(totals, accountId) {
  return totals.get(accountId) || { debit: 0, credit: 0 };
}

/**
 * Signed balance in the account's normal direction (positive = normal side).
 */
export function accountNet(account, totals) {
  const movement = totalsFor(totals, account.id);
  return isDebitNormal(account.type)
    ? movement.debit - movement.credit
    : movement.credit - movement.debit;
}

/**
 * Split a balance into its presentation columns.
 */
export function splitBalance(account, totals) {
  const net = accountNet(account, totals);
  const debitSide = isDebitNormal(account.type) ? net : -net;

  return {
    net,
    balanceDebit: debitSide > BALANCE_EPSILON ? debitSide : 0,
    balanceCredit: debitSide < -BALANCE_EPSILON ? -debitSide : 0,
  };
}
/**
 * Trial balance: only accounts with movement, split into debit/credit columns.
 */
export function buildTrialBalance(accounts, totals) {
  const rows = [];
  let totalDebit = 0;
  let totalCredit = 0;

  accounts.forEach((account) => {
    const movement = totalsFor(totals, account.id);
    if (movement.debit === 0 && movement.credit === 0) return;

    const split = splitBalance(account, totals);
    totalDebit += split.balanceDebit;
    totalCredit += split.balanceCredit;

    rows.push({
      account,
      debit: movement.debit,
      credit: movement.credit,
      balanceDebit: split.balanceDebit,
      balanceCredit: split.balanceCredit,
    });
  });

  return {
    rows,
    totalDebit,
    totalCredit,
    isBalanced: Math.abs(totalDebit - totalCredit) < BALANCE_EPSILON,
  };
}

/**
 * Income statement for the selected period.
 */
export function buildIncomeStatement(accounts, totals) {
  const revenue = [];
  const expense = [];

  accounts.forEach((account) => {
    const movement = totalsFor(totals, account.id);
    if (movement.debit === 0 && movement.credit === 0) return;

    if (account.type === "revenue") {
      revenue.push({ account, amount: movement.credit - movement.debit });
    } else if (account.type === "expense") {
      expense.push({ account, amount: movement.debit - movement.credit });
    }
  });

  const totalRevenue = sumAmounts(revenue);
  const totalExpense = sumAmounts(expense);

  return {
    revenue,
    expense,
    totalRevenue,
    totalExpense,
    profit: totalRevenue - totalExpense,
  };
}

/**
 * Balance sheet at the end of the selected period. Profit for the period is
 * presented as part of equity so the statement stays in balance.
 */
export function buildBalanceSheet(accounts, totals, profit = 0) {
  const assets = [];
  const liabilities = [];
  const equity = [];

  accounts.forEach((account) => {
    const movement = totalsFor(totals, account.id);
    if (movement.debit === 0 && movement.credit === 0) return;

    if (account.type === "asset") {
      assets.push({ account, amount: movement.debit - movement.credit });
    } else if (account.type === "liability") {
      liabilities.push({ account, amount: movement.credit - movement.debit });
    } else if (account.type === "equity") {
      equity.push({ account, amount: movement.credit - movement.debit });
    }
  });

  const totalAssets = sumAmounts(assets);
  const totalLiabilities = sumAmounts(liabilities);
  const totalEquity = sumAmounts(equity) + profit;

  return {
    assets,
    liabilities,
    equity,
    profit,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    isBalanced:
      Math.abs(totalAssets - (totalLiabilities + totalEquity)) <
      BALANCE_EPSILON,
  };
}

/**
 * Revenue and expense per calendar month, for the dashboard chart.
 */
export function monthlySummary(
  accounts,
  entries,
  months = 6,
  referenceDate = new Date(),
) {
  const typeByAccountId = new Map(
    accounts.map((account) => [account.id, account.type]),
  );
  const buckets = [];

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth() - offset,
      1,
    );
    buckets.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("th-TH", { month: "short" }),
      fullLabel: date.toLocaleDateString("th-TH", {
        month: "long",
        year: "numeric",
      }),
      revenue: 0,
      expense: 0,
    });
  }

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  entries.forEach((entry) => {
    const iso = toIsoDate(entry.date);
    if (iso.length < 7) return;

    const bucket = byKey.get(iso.slice(0, 7));
    if (!bucket) return;

    (entry.lines || []).forEach((line) => {
      const type = typeByAccountId.get(line.accountId);
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      if (type === "revenue") bucket.revenue += credit - debit;
      else if (type === "expense") bucket.expense += debit - credit;
    });
  });

  return buckets;
}

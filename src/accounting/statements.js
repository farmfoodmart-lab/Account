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

/** Journal entry kind: "general" (default), "adjusting" or "closing". */
export function entryKindOf(entry) {
  const kind = entry && entry.kind;
  return kind === "adjusting" || kind === "closing" ? kind : "general";
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
export function collectTotals(entries, { from = "", to = "", kinds = null, excludeKinds = null } = {}) {
  const totals = new Map();

  entries.forEach((entry) => {
    if (!inDateRange(entry.date, from, to)) return;
    const kind = entryKindOf(entry);
    if (kinds && !kinds.includes(kind)) return;
    if (excludeKinds && excludeKinds.includes(kind)) return;
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
    if (entryKindOf(entry) === "closing") return;
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

/**
 * Receivable aging buckets by days past due at `today` (YYYY-MM-DD).
 */
export function receivableAging(receivables, today) {
  const buckets = [
    { key: "current", label: "ยังไม่ถึงกำหนด", amount: 0, count: 0 },
    { key: "d30", label: "เกิน 1-30 วัน", amount: 0, count: 0 },
    { key: "d60", label: "เกิน 31-60 วัน", amount: 0, count: 0 },
    { key: "d90", label: "เกิน 61-90 วัน", amount: 0, count: 0 },
    { key: "d90p", label: "เกิน 90 วัน", amount: 0, count: 0 },
  ];
  const todayTime = Date.parse(today);
  receivables.forEach((receivable) => {
    const remaining = (Number(receivable.amount) || 0) - (Number(receivable.paid) || 0);
    if (remaining <= BALANCE_EPSILON) return;
    const due = toIsoDate(receivable.due);
    const days = due ? Math.floor((todayTime - Date.parse(due)) / 86400000) : 0;
    const index = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    buckets[index].amount += remaining;
    buckets[index].count += 1;
  });
  return buckets;
}

/**
 * Integrity checks for the books. Returns counts the dashboard can surface.
 */
export function bookHealth(accounts, entries, { periodStart = "", periodEnd = "" } = {}) {
  const accountIds = new Set(accounts.map((account) => account.id));
  let unbalanced = 0;
  let missingAccount = 0;
  let missingDate = 0;
  let outsidePeriod = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  entries.forEach((entry) => {
    let debit = 0;
    let credit = 0;
    (entry.lines || []).forEach((line) => {
      debit += Number(line.debit) || 0;
      credit += Number(line.credit) || 0;
      if (!accountIds.has(line.accountId)) missingAccount += 1;
    });
    totalDebit += debit;
    totalCredit += credit;
    if (Math.abs(debit - credit) >= BALANCE_EPSILON) unbalanced += 1;
    const iso = toIsoDate(entry.date);
    if (!iso) missingDate += 1;
    else if ((periodStart && iso < periodStart) || (periodEnd && iso > periodEnd)) outsidePeriod += 1;
  });
  return {
    unbalanced,
    missingAccount,
    missingDate,
    outsidePeriod,
    totalDebit,
    totalCredit,
    isBalanced: Math.abs(totalDebit - totalCredit) < BALANCE_EPSILON,
  };
}

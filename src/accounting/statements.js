/**
 * @file การคำนวณงบการเงินและรายงานทางบัญชี
 *
 * ทุกฟังก์ชันในไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ (pure): ไม่อ่าน state และไม่แตะ DOM
 * รับข้อมูลเข้าทางพารามิเตอร์ทั้งหมด จึงทดสอบได้ง่ายและนำไปใช้ซ้ำได้ทุกหน้า
 *
 * คำศัพท์ที่ใช้ในไฟล์นี้
 * - movement (ยอดเคลื่อนไหว)  = ผลรวมเดบิตและเครดิตของบัญชีในช่วงเวลาหนึ่ง { debit, credit }
 * - net balance (ยอดสุทธิ)     = ยอดคงเหลือในด้านปกติของบัญชี (บวก = อยู่ด้านปกติ)
 */
import { AMOUNT_EPSILON } from "./constants.js";
import { getEntryKind, isDebitNormal } from "./rules.js";
import { daysBetween, isDateInRange, toIsoDate } from "../utils/date.js";

/** @typedef {{ debit: number, credit: number }} Movement */
/** @typedef {Map<string, Movement>} MovementMap ยอดเคลื่อนไหวแยกตาม accountId */

const ZERO_MOVEMENT = Object.freeze({ debit: 0, credit: 0 });

const sumAmounts = (rows) => rows.reduce((total, row) => total + row.amount, 0);

/**
 * รวมยอดเดบิต/เครดิตของแต่ละบัญชี จากรายการในช่วงวันที่และประเภทที่กำหนด
 * @param {Array<object>} entries รายการในสมุดรายวัน
 * @param {object} [filter]
 * @param {string} [filter.from=""] ตั้งแต่วันที่ "YYYY-MM-DD"
 * @param {string} [filter.to=""] ถึงวันที่ "YYYY-MM-DD"
 * @param {string[] | null} [filter.kinds=null] นับเฉพาะประเภทรายการเหล่านี้
 * @param {string[] | null} [filter.excludeKinds=null] ไม่นับประเภทรายการเหล่านี้
 * @returns {MovementMap}
 */
export function sumMovementsByAccount(entries, { from = "", to = "", kinds = null, excludeKinds = null } = {}) {
  const movements = new Map();
  entries.forEach((entry) => {
    if (!isDateInRange(entry.date, from, to)) return;
    const kind = getEntryKind(entry);
    if (kinds && !kinds.includes(kind)) return;
    if (excludeKinds && excludeKinds.includes(kind)) return;

    (entry.lines || []).forEach((line) => {
      if (!line || !line.accountId) return;
      const movement = movements.get(line.accountId) || { debit: 0, credit: 0 };
      movement.debit += Number(line.debit) || 0;
      movement.credit += Number(line.credit) || 0;
      movements.set(line.accountId, movement);
    });
  });
  return movements;
}

/**
 * ยอดเคลื่อนไหวของบัญชีเดียว (ไม่มีรายการ = ศูนย์)
 * @param {MovementMap} movements
 * @param {string} accountId
 * @returns {Movement}
 */
export function getAccountMovement(movements, accountId) {
  return movements.get(accountId) || ZERO_MOVEMENT;
}

/**
 * ยอดคงเหลือสุทธิในด้านปกติของบัญชี
 * @param {{ id: string, type: string }} account
 * @param {MovementMap} movements
 * @returns {number} บวก = อยู่ด้านปกติ, ลบ = ผิดด้าน
 */
export function calculateNetBalance(account, movements) {
  const { debit, credit } = getAccountMovement(movements, account.id);
  return isDebitNormal(account.type) ? debit - credit : credit - debit;
}

/**
 * งบทดลอง: แสดงเฉพาะบัญชีที่มีความเคลื่อนไหว แยกยอดคงเหลือเป็นช่องเดบิต/เครดิต
 * @param {Array<object>} accounts
 * @param {MovementMap} movements
 */
export function buildTrialBalance(accounts, movements) {
  const rows = [];
  let totalDebit = 0;
  let totalCredit = 0;

  accounts.forEach((account) => {
    const movement = getAccountMovement(movements, account.id);
    if (movement.debit === 0 && movement.credit === 0) return;

    const netBalance = calculateNetBalance(account, movements);
    const debitSideAmount = isDebitNormal(account.type) ? netBalance : -netBalance;
    const balanceDebit = debitSideAmount > AMOUNT_EPSILON ? debitSideAmount : 0;
    const balanceCredit = debitSideAmount < -AMOUNT_EPSILON ? -debitSideAmount : 0;
    totalDebit += balanceDebit;
    totalCredit += balanceCredit;

    rows.push({ account, debit: movement.debit, credit: movement.credit, balanceDebit, balanceCredit });
  });

  return {
    rows,
    totalDebit,
    totalCredit,
    isBalanced: Math.abs(totalDebit - totalCredit) < AMOUNT_EPSILON,
  };
}

/**
 * งบกำไรขาดทุน จากยอดเคลื่อนไหวที่ส่งเข้ามา
 * (ผู้เรียกควรตัดรายการปิดบัญชีออกก่อน ไม่เช่นนั้นรายได้/ค่าใช้จ่ายจะเป็นศูนย์)
 * @param {Array<object>} accounts
 * @param {MovementMap} movements
 */
export function buildIncomeStatement(accounts, movements) {
  const revenue = [];
  const expense = [];

  accounts.forEach((account) => {
    const { debit, credit } = getAccountMovement(movements, account.id);
    if (debit === 0 && credit === 0) return;
    if (account.type === "revenue") revenue.push({ account, amount: credit - debit });
    else if (account.type === "expense") expense.push({ account, amount: debit - credit });
  });

  const totalRevenue = sumAmounts(revenue);
  const totalExpense = sumAmounts(expense);
  return { revenue, expense, totalRevenue, totalExpense, profit: totalRevenue - totalExpense };
}

/**
 * งบแสดงฐานะการเงิน (งบดุล)
 * @param {Array<object>} accounts
 * @param {MovementMap} movements ยอดสะสมตั้งแต่ต้นจนถึงวันสิ้นงวด
 * @param {number} [unclosedProfit=0] กำไรที่ยังไม่ได้ปิดเข้าทุน แสดงเป็นส่วนหนึ่งของส่วนของเจ้าของ
 *        เพื่อให้ สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
 */
export function buildBalanceSheet(accounts, movements, unclosedProfit = 0) {
  const assets = [];
  const liabilities = [];
  const equity = [];

  accounts.forEach((account) => {
    const { debit, credit } = getAccountMovement(movements, account.id);
    if (debit === 0 && credit === 0) return;
    if (account.type === "asset") assets.push({ account, amount: debit - credit });
    else if (account.type === "liability") liabilities.push({ account, amount: credit - debit });
    else if (account.type === "equity") equity.push({ account, amount: credit - debit });
  });

  const totalAssets = sumAmounts(assets);
  const totalLiabilities = sumAmounts(liabilities);
  const totalEquity = sumAmounts(equity) + unclosedProfit;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

  return {
    assets,
    liabilities,
    equity,
    profit: unclosedProfit,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < AMOUNT_EPSILON,
  };
}

/**
 * รายได้และค่าใช้จ่ายรายเดือน ย้อนหลัง `monthCount` เดือน (สำหรับกราฟในแดชบอร์ด)
 * ไม่นับรายการปิดบัญชี
 * @param {Array<object>} accounts
 * @param {Array<object>} entries
 * @param {number} [monthCount=6]
 * @param {Date} [referenceDate=new Date()] เดือนล่าสุดของกราฟ
 * @returns {Array<{ key: string, label: string, fullLabel: string, revenue: number, expense: number }>}
 */
export function summarizeMonthlyIncome(accounts, entries, monthCount = 6, referenceDate = new Date()) {
  const accountTypeById = new Map(accounts.map((account) => [account.id, account.type]));
  const months = [];
  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - offset, 1);
    months.push({
      key: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`,
      label: monthStart.toLocaleDateString("th-TH", { month: "short" }),
      fullLabel: monthStart.toLocaleDateString("th-TH", { month: "long", year: "numeric" }),
      revenue: 0,
      expense: 0,
    });
  }
  const monthByKey = new Map(months.map((month) => [month.key, month]));

  entries.forEach((entry) => {
    if (getEntryKind(entry) === "closing") return;
    const month = monthByKey.get(toIsoDate(entry.date).slice(0, 7));
    if (!month) return;
    (entry.lines || []).forEach((line) => {
      const accountType = accountTypeById.get(line.accountId);
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      if (accountType === "revenue") month.revenue += credit - debit;
      else if (accountType === "expense") month.expense += debit - credit;
    });
  });
  return months;
}

/**
 * วิเคราะห์อายุหนี้ (ใช้ได้ทั้งลูกหนี้และเจ้าหนี้) แบ่งตามจำนวนวันที่เกินกำหนดชำระ
 * @param {Array<{ amount: number, paid?: number, due?: string }>} subledgerRecords
 * @param {string} today "YYYY-MM-DD"
 * @returns {Array<{ key: string, label: string, amount: number, count: number }>}
 */
export function buildAgingBuckets(subledgerRecords, today) {
  const buckets = [
    { key: "current", label: "ยังไม่ถึงกำหนด", amount: 0, count: 0 },
    { key: "overdue30", label: "เกิน 1-30 วัน", amount: 0, count: 0 },
    { key: "overdue60", label: "เกิน 31-60 วัน", amount: 0, count: 0 },
    { key: "overdue90", label: "เกิน 61-90 วัน", amount: 0, count: 0 },
    { key: "overdue90plus", label: "เกิน 90 วัน", amount: 0, count: 0 },
  ];
  subledgerRecords.forEach((subledgerRecord) => {
    const outstanding = (Number(subledgerRecord.amount) || 0) - (Number(subledgerRecord.paid) || 0);
    if (outstanding <= AMOUNT_EPSILON) return;
    const dueDate = toIsoDate(subledgerRecord.due);
    const daysOverdue = dueDate ? daysBetween(dueDate, today) : 0;
    let bucketIndex = 4;
    if (daysOverdue <= 0) bucketIndex = 0;
    else if (daysOverdue <= 30) bucketIndex = 1;
    else if (daysOverdue <= 60) bucketIndex = 2;
    else if (daysOverdue <= 90) bucketIndex = 3;
    buckets[bucketIndex].amount += outstanding;
    buckets[bucketIndex].count += 1;
  });
  return buckets;
}

/**
 * ตรวจความถูกต้องของสมุดบัญชี (แสดงในการ์ด "ตรวจสุขภาพบัญชี" ของแดชบอร์ด)
 * @param {Array<object>} accounts
 * @param {Array<object>} entries
 * @param {{ periodStart?: string, periodEnd?: string }} [period]
 * @returns {{ unbalancedEntries: number, linesWithMissingAccount: number, entriesWithoutDate: number,
 *             entriesOutsidePeriod: number, totalDebit: number, totalCredit: number, isBalanced: boolean }}
 */
export function checkBookHealth(accounts, entries, { periodStart = "", periodEnd = "" } = {}) {
  const existingAccountIds = new Set(accounts.map((account) => account.id));
  const result = {
    unbalancedEntries: 0,
    linesWithMissingAccount: 0,
    entriesWithoutDate: 0,
    entriesOutsidePeriod: 0,
    totalDebit: 0,
    totalCredit: 0,
    isBalanced: true,
  };

  entries.forEach((entry) => {
    let entryDebit = 0;
    let entryCredit = 0;
    (entry.lines || []).forEach((line) => {
      entryDebit += Number(line.debit) || 0;
      entryCredit += Number(line.credit) || 0;
      if (!existingAccountIds.has(line.accountId)) result.linesWithMissingAccount += 1;
    });
    result.totalDebit += entryDebit;
    result.totalCredit += entryCredit;
    if (Math.abs(entryDebit - entryCredit) >= AMOUNT_EPSILON) result.unbalancedEntries += 1;

    const isoDate = toIsoDate(entry.date);
    if (!isoDate) result.entriesWithoutDate += 1;
    else if ((periodStart && isoDate < periodStart) || (periodEnd && isoDate > periodEnd)) result.entriesOutsidePeriod += 1;
  });

  result.isBalanced = Math.abs(result.totalDebit - result.totalCredit) < AMOUNT_EPSILON;
  return result;
}

/**
 * ยอดคงเหลือสำหรับงบทดลอง/กระดาษทำการแบบเลือกช่วงวันที่ (ตั้งแต่ from ถึง to)
 * - บัญชีงบดุล (สินทรัพย์ หนี้สิน ทุน): ยอดสะสมจนถึง to (รวมยอดยกมาก่อน from)
 * - บัญชีรายได้/ค่าใช้จ่าย: เฉพาะรายการในช่วง from–to
 * - กำไร (ขาดทุน) ก่อน from ที่ยังไม่ได้ปิดบัญชี ย้ายไปรวมในบัญชีกำไรสะสม เพื่อให้งบทดลองยังดุล
 * ถ้าไม่ระบุ from หรือไม่พบบัญชีกำไรสะสม จะคืนยอดสะสมตามปกติ
 * @param {Array<{ id: string, type: string }>} accounts
 * @param {Array<object>} entries
 * @param {{ from?: string, to?: string, excludeKinds?: string[] | null, retainedAccountId?: string }} options
 * @returns {{ balances: MovementMap, periodMovements: MovementMap, carriedProfit: number }}
 *   balances = ใช้คำนวณยอดคงเหลือ, periodMovements = ยอดเคลื่อนไหวในช่วง,
 *   carriedProfit = กำไรก่อนช่วงที่ย้ายไปกำไรสะสม (บวก = กำไร)
 */
export function sumBalancesForPeriod(accounts, entries, { from = "", to = "", excludeKinds = null, retainedAccountId = "" } = {}) {
  const cumulative = sumMovementsByAccount(entries, { to, excludeKinds });
  const periodMovements = sumMovementsByAccount(entries, { from, to, excludeKinds });
  if (!from || !retainedAccountId) return { balances: cumulative, periodMovements, carriedProfit: 0 };

  const balances = new Map();
  cumulative.forEach((movement, accountId) => balances.set(accountId, { ...movement }));
  // ผลรวม (เดบิต - เครดิต) ของบัญชีรายได้/ค่าใช้จ่ายก่อน from: ติดลบ = กำไร
  let carriedDebitMinusCredit = 0;
  accounts.forEach((account) => {
    if (account.type !== "revenue" && account.type !== "expense") return;
    const total = getAccountMovement(cumulative, account.id);
    const inPeriod = getAccountMovement(periodMovements, account.id);
    carriedDebitMinusCredit += (total.debit - inPeriod.debit) - (total.credit - inPeriod.credit);
    if (total.debit || total.credit) balances.set(account.id, { ...inPeriod });
  });
  if (Math.abs(carriedDebitMinusCredit) > AMOUNT_EPSILON) {
    const retained = { ...getAccountMovement(balances, retainedAccountId) };
    if (carriedDebitMinusCredit > 0) retained.debit += carriedDebitMinusCredit;
    else retained.credit -= carriedDebitMinusCredit;
    balances.set(retainedAccountId, retained);
  }
  return { balances, periodMovements, carriedProfit: -carriedDebitMinusCredit };
}

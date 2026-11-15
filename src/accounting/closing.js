/**
 * @file การปิดบัญชีสิ้นงวด
 *
 * ปิดบัญชีรายได้และค่าใช้จ่ายทุกบัญชีให้เป็นศูนย์ แล้วโอนผลต่าง (กำไรหรือขาดทุนสุทธิ) เข้าบัญชีกำไรสะสม
 *   Dr รายได้ (ยอดคงเหลือ)       Cr ค่าใช้จ่าย (ยอดคงเหลือ)
 *   ผลต่าง: กำไร → Cr กำไรสะสม / ขาดทุน → Dr กำไรสะสม
 */
import { AMOUNT_EPSILON } from "./constants.js";
import { roundMoney } from "./posting.js";
import { calculateNetBalance, sumMovementsByAccount } from "./statements.js";

/**
 * ยอดคงเหลือของบัญชีรายได้/ค่าใช้จ่ายที่จะถูกปิด ณ วันที่กำหนด
 * (นับรวมรายการปิดบัญชีครั้งก่อน ๆ ด้วย จึงไม่ปิดซ้ำยอดที่เคยปิดไปแล้ว)
 * @param {Array<object>} accounts
 * @param {Array<object>} entries
 * @param {string} closingDate "YYYY-MM-DD"
 * @returns {{ balances: Array<{ account: object, netBalance: number }>, netProfit: number }}
 */
export function calculateClosingBalances(accounts, entries, closingDate) {
  const movements = sumMovementsByAccount(entries, { to: closingDate });
  const balances = accounts
    .filter((account) => account.type === "revenue" || account.type === "expense")
    .map((account) => ({ account, netBalance: roundMoney(calculateNetBalance(account, movements)) }))
    .filter((row) => Math.abs(row.netBalance) >= AMOUNT_EPSILON);

  const netProfit = balances.reduce(
    (total, row) => total + (row.account.type === "revenue" ? row.netBalance : -row.netBalance),
    0,
  );
  return { balances, netProfit: roundMoney(netProfit) };
}

/**
 * บรรทัดบัญชีของรายการปิดบัญชี
 * @param {Array<{ account: object, netBalance: number }>} balances จาก calculateClosingBalances
 * @param {number} netProfit
 * @param {string} retainedEarningsAccountId บัญชีกำไรสะสม
 * @returns {Array<{ accountId: string, debit: number, credit: number }>}
 */
export function buildClosingLines(balances, netProfit, retainedEarningsAccountId) {
  const lines = balances.map(({ account, netBalance }) => {
    // ปิดบัญชี = บันทึกด้านตรงข้ามกับยอดคงเหลือ
    // รายได้ (ด้านปกติเครดิต) → เดบิต, ค่าใช้จ่าย (ด้านปกติเดบิต) → เครดิต; ยอดติดลบกลับด้าน
    const debitAmount = account.type === "revenue" ? netBalance : -netBalance;
    return debitAmount > 0
      ? { accountId: account.id, debit: debitAmount, credit: 0 }
      : { accountId: account.id, debit: 0, credit: -debitAmount };
  });
  if (netProfit > 0) lines.push({ accountId: retainedEarningsAccountId, debit: 0, credit: netProfit });
  else if (netProfit < 0) lines.push({ accountId: retainedEarningsAccountId, debit: -netProfit, credit: 0 });
  return lines;
}

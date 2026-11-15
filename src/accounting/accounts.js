/**
 * @file ผังบัญชี: ค้นหา เรียงลำดับ แสดงผล และคำนวณยอดคงเหลือของบัญชี
 */
import { state } from "../core/store.js";
import { escapeHtml } from "../utils/format.js";
import { ACCOUNT_ROLES, ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER, AMOUNT_EPSILON } from "./constants.js";
import { isDebitNormal } from "./rules.js";

/**
 * ตัวเปรียบเทียบสำหรับเรียงบัญชี: ตามหมวด (สินทรัพย์ → ค่าใช้จ่าย) แล้วตามรหัสบัญชี
 * @param {{ type: string, code: string }} leftAccount
 * @param {{ type: string, code: string }} rightAccount
 * @returns {number}
 */
export function compareAccounts(leftAccount, rightAccount) {
  const typeRank = (type) => {
    const rank = ACCOUNT_TYPE_ORDER.indexOf(type);
    return rank < 0 ? ACCOUNT_TYPE_ORDER.length : rank; // หมวดที่ไม่รู้จักไว้ท้ายสุด
  };
  const typeDifference = typeRank(leftAccount.type) - typeRank(rightAccount.type);
  if (typeDifference) return typeDifference;
  return String(leftAccount.code || "").localeCompare(String(rightAccount.code || ""), "th-TH", { numeric: true });
}

/** สำเนาผังบัญชีที่เรียงแล้ว */
export function getSortedAccounts() {
  return state.accounts.slice().sort(compareAccounts);
}

/**
 * @param {string} accountId
 * @returns {object | undefined}
 */
export function findAccountById(accountId) {
  return state.accounts.find((account) => account.id === accountId);
}

/**
 * ข้อความ "รหัส ชื่อบัญชี" สำหรับแสดงผล
 * @param {object | undefined} account
 * @returns {string}
 */
export function formatAccountLabel(account) {
  if (!account) return "(บัญชีถูกลบ)";
  return `${account.code || ""} ${account.name || ""}`.trim();
}

/**
 * HTML <option> ของทุกบัญชี จัดกลุ่มตามหมวดด้วย <optgroup>
 * @param {string} [selectedAccountId=""] บัญชีที่เลือกไว้
 * @param {string} [placeholder="-- เลือกบัญชี --"] ข้อความตัวเลือกแรก (ค่าว่าง)
 * @returns {string}
 */
export function renderAccountOptions(selectedAccountId = "", placeholder = "-- เลือกบัญชี --") {
  const accounts = getSortedAccounts();
  const groups = ACCOUNT_TYPE_ORDER.map((type) => ({ type, accounts: accounts.filter((account) => account.type === type) }));
  const otherAccounts = accounts.filter((account) => !ACCOUNT_TYPE_ORDER.includes(account.type));
  if (otherAccounts.length) groups.push({ type: "other", accounts: otherAccounts });

  const optionGroups = groups
    .filter((group) => group.accounts.length)
    .map((group) => {
      const options = group.accounts.map((account) => {
        const selected = account.id === selectedAccountId ? " selected" : "";
        return `<option value="${escapeHtml(account.id)}"${selected}>${escapeHtml(account.code)} · ${escapeHtml(account.name)}</option>`;
      }).join("");
      return `<optgroup label="${escapeHtml(ACCOUNT_TYPE_LABELS[group.type] || "อื่น ๆ")}">${options}</optgroup>`;
    })
    .join("");
  return `<option value="">${escapeHtml(placeholder)}</option>${optionGroups}`;
}

/**
 * ป้ายสีของหมวดบัญชี
 * @param {string} accountType
 * @returns {string} HTML
 */
export function renderAccountTypeBadge(accountType) {
  const label = ACCOUNT_TYPE_LABELS[accountType] || accountType || "อื่น ๆ";
  return `<span class="badge type-${escapeHtml(accountType)}">${escapeHtml(label)}</span>`;
}

/**
 * หาบัญชีที่ใช้สำหรับบทบาทหนึ่ง ๆ ในการลงบัญชีอัตโนมัติ
 * ลำดับการค้นหา: บัญชีที่ผู้ใช้กำหนดในหน้าการตั้งค่า → รหัสมาตรฐาน → ชื่อบัญชี
 * @param {keyof typeof ACCOUNT_ROLES} role เช่น "cash", "receivable", "vatOutput"
 * @returns {object | null}
 */
export function findAccountForRole(role) {
  const roleConfig = ACCOUNT_ROLES[role];
  const configuredId = state.settings.accountMap && state.settings.accountMap[role];
  if (configuredId) {
    const configuredAccount = findAccountById(configuredId);
    if (configuredAccount) return configuredAccount;
  }
  if (!roleConfig) return null;

  for (const code of roleConfig.codes) {
    const account = state.accounts.find((item) => String(item.code) === code && item.type === roleConfig.type);
    if (account) return account;
  }
  for (const name of roleConfig.names) {
    const account = state.accounts.find((item) => item.type === roleConfig.type && String(item.name || "").includes(name));
    if (account) return account;
  }
  return null;
}

/**
 * ยอดรวมเดบิต เครดิต และยอดคงเหลือสุทธิของบัญชี จากทุกรายการในสมุดรายวัน
 * @param {{ id: string, type: string }} account
 * @returns {{ debit: number, credit: number, net: number }} net เป็นบวกเมื่ออยู่ด้านปกติของบัญชี
 */
export function calculateAccountBalance(account) {
  let debit = 0;
  let credit = 0;
  state.entries.forEach((entry) => {
    entry.lines.forEach((line) => {
      if (line.accountId !== account.id) return;
      debit += Number(line.debit) || 0;
      credit += Number(line.credit) || 0;
    });
  });
  const net = isDebitNormal(account.type) ? debit - credit : credit - debit;
  return { debit, credit, net };
}

/**
 * แยกยอดคงเหลือสุทธิออกเป็นช่องเดบิต/เครดิต (ใช้ในงบทดลอง)
 * @param {{ type: string }} account
 * @param {number} netBalance ยอดสุทธิในด้านปกติของบัญชี
 * @returns {{ debit: number, credit: number }}
 */
export function splitIntoDebitCredit(account, netBalance) {
  const debitSideAmount = isDebitNormal(account.type) ? netBalance : -netBalance;
  return {
    debit: debitSideAmount > AMOUNT_EPSILON ? debitSideAmount : 0,
    credit: debitSideAmount < -AMOUNT_EPSILON ? -debitSideAmount : 0,
  };
}

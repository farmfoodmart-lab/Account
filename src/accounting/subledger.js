/**
 * @file ทะเบียนลูกหนี้/เจ้าหนี้ ที่สร้างจากสมุดรายวันทั่วไป
 *
 * ไม่มีการบันทึกลูกหนี้/เจ้าหนี้แยกต่างหาก — ทุกอย่างมาจากรายการในสมุดรายวันที่ใช้ "บัญชีคุม"
 *   ลูกหนี้ (บัญชีลูกหนี้การค้า): เดบิต = ตั้งหนี้ (ใบแจ้งหนี้), เครดิต = รับชำระ
 *   เจ้าหนี้ (บัญชีเจ้าหนี้การค้า): เครดิต = ตั้งหนี้,           เดบิต = จ่ายชำระ
 *
 * คู่ค้าของแต่ละรายการมาจากช่อง "คู่ค้า" ในสมุดรายวัน (entry.customerId / entry.customerName)
 * วันครบกำหนดมาจาก entry.due ถ้าไม่ระบุ ใช้ วันที่ + เครดิตเทอมของคู่ค้า (ทะเบียนเจ้าหนี้) หรือ settings.creditDays
 *
 * การจับคู่การชำระกับเอกสาร
 * 1. รายการชำระที่ระบุเอกสาร (entry.appliesTo = id ของรายการตั้งหนี้) ตัดเอกสารนั้นก่อน
 * 2. ยอดที่เหลือตัดเอกสารที่เก่าที่สุดของคู่ค้ารายเดียวกันก่อน (FIFO)
 * 3. ชำระเกินยอดหนี้ → เก็บเป็น "ยอดชำระล่วงหน้า/เครดิตคงเหลือ" ของคู่ค้า
 */
import { state } from "../core/store.js";
import { toIsoDate, formatIsoDate } from "../utils/date.js";
import { AMOUNT_EPSILON } from "./constants.js";
import { findAccountForRole } from "./accounts.js";
import { findCustomerById, getCustomerDisplayName } from "./customers.js";
import { roundMoney } from "./posting.js";

/** เครดิตเทอมเริ่มต้น (วัน) เมื่อไม่ได้ตั้งค่าไว้ */
export const DEFAULT_CREDIT_DAYS = 30;

/** ชื่อแสดงเมื่อรายการไม่ได้ระบุคู่ค้า */
export const UNSPECIFIED_PARTY_NAME = "(ไม่ระบุคู่ค้า)";

const SUBLEDGER_SETTINGS = {
  receivable: { controlRole: "receivable", increasesOnDebit: true },
  payable: { controlRole: "payable", increasesOnDebit: false },
};

/**
 * คีย์ระบุคู่ค้าของรายการ (ใช้จัดกลุ่ม)
 * @param {{ customerId?: string, customerName?: string }} entry
 */
export function getPartyKey(entry) {
  if (entry.customerId) return `id:${entry.customerId}`;
  if (entry.customerName) return `name:${entry.customerName}`;
  return "none";
}

/** วันครบกำหนดของเอกสาร */
function getDueDate(entry, creditDays) {
  const explicitDue = toIsoDate(entry.due);
  if (explicitDue) return explicitDue;
  const documentDate = toIsoDate(entry.date);
  if (!documentDate) return "";
  const [year, month, day] = documentDate.split("-").map(Number);
  return formatIsoDate(new Date(year, month - 1, day + creditDays));
}

/**
 * @typedef {object} SubledgerDocument เอกสารตั้งหนี้หนึ่งใบ
 * @property {string} entryId     id ของรายการในสมุดรายวัน
 * @property {string} docNo
 * @property {string} date
 * @property {string} due
 * @property {string} desc
 * @property {string} partyKey
 * @property {string} partyName
 * @property {string} [customerId]
 * @property {string} [customerName]
 * @property {number} amount      ยอดตั้งหนี้
 * @property {number} paid        ยอดที่ชำระแล้ว (จากการจับคู่)
 * @property {number} outstanding ยอดคงค้าง
 * @property {Array<{ entryId: string, docNo: string, date: string, amount: number }>} payments
 */

/**
 * สร้างทะเบียนลูกหนี้หรือเจ้าหนี้จากสมุดรายวัน
 * @param {"receivable" | "payable"} subledgerType
 * @param {Array<object>} [entries=state.entries]
 * @returns {{ controlAccount: object | null, documents: SubledgerDocument[],
 *             parties: Array<{ partyKey: string, partyName: string, invoiced: number, paid: number, outstanding: number, unappliedCredit: number, documentCount: number }> }}
 */
export function buildSubledger(subledgerType, entries = state.entries) {
  const settings = SUBLEDGER_SETTINGS[subledgerType];
  const controlAccount = findAccountForRole(settings.controlRole);
  if (!controlAccount) return { controlAccount: null, documents: [], parties: [] };
  const creditDays = Number(state.settings.creditDays) || DEFAULT_CREDIT_DAYS;

  const documents = [];
  const settlements = [];
  entries.forEach((entry) => {
    // ยอดสุทธิของบัญชีคุมในรายการนี้ (บวก = เพิ่มหนี้, ลบ = ชำระหนี้)
    const netChange = roundMoney(entry.lines.reduce((total, line) => {
      if (line.accountId !== controlAccount.id) return total;
      const debitMinusCredit = (Number(line.debit) || 0) - (Number(line.credit) || 0);
      return total + (settings.increasesOnDebit ? debitMinusCredit : -debitMinusCredit);
    }, 0));
    if (Math.abs(netChange) < AMOUNT_EPSILON) return;

    const common = {
      entryId: entry.id,
      docNo: entry.docNo || "",
      date: toIsoDate(entry.date) || String(entry.date || ""),
      desc: entry.desc || "",
      partyKey: getPartyKey(entry),
      partyName: entry.customerId || entry.customerName ? getCustomerDisplayName(entry) : UNSPECIFIED_PARTY_NAME,
      customerId: entry.customerId || "",
      customerName: entry.customerName || "",
    };
    if (netChange > 0) {
      // เครดิตเทอมเฉพาะคู่ค้า (ถ้ากำหนดไว้ในทะเบียน) มาก่อนค่ากลางในการตั้งค่า
      const party = entry.customerId ? findCustomerById(entry.customerId) : null;
      const partyCreditDays = party && party.creditDays !== "" && party.creditDays != null ? Number(party.creditDays) : NaN;
      const dueCreditDays = Number.isFinite(partyCreditDays) && partyCreditDays >= 0 ? partyCreditDays : creditDays;
      documents.push({ ...common, due: getDueDate(entry, dueCreditDays), amount: netChange, paid: 0, outstanding: netChange, payments: [] });
    } else {
      settlements.push({ ...common, amount: -netChange, appliesTo: entry.appliesTo || "" });
    }
  });

  const byDateThenNumber = (left, right) =>
    left.date.localeCompare(right.date) || left.docNo.localeCompare(right.docNo, "th-TH", { numeric: true });
  documents.sort(byDateThenNumber);
  settlements.sort(byDateThenNumber);

  const documentByEntryId = new Map(documents.map((subledgerDocument) => [subledgerDocument.entryId, subledgerDocument]));
  const unappliedCreditByParty = new Map();

  /** ตัดยอดชำระเข้าเอกสาร คืนยอดที่ตัดได้ */
  const applyToDocument = (subledgerDocument, settlement, amount) => {
    const appliedAmount = roundMoney(Math.min(amount, subledgerDocument.outstanding));
    if (appliedAmount <= 0) return 0;
    subledgerDocument.paid = roundMoney(subledgerDocument.paid + appliedAmount);
    subledgerDocument.outstanding = roundMoney(subledgerDocument.outstanding - appliedAmount);
    subledgerDocument.payments.push({ entryId: settlement.entryId, docNo: settlement.docNo, date: settlement.date, amount: appliedAmount });
    return appliedAmount;
  };

  settlements.forEach((settlement) => {
    let remaining = settlement.amount;
    // 1) เอกสารที่ระบุไว้
    const targetDocument = settlement.appliesTo ? documentByEntryId.get(settlement.appliesTo) : null;
    if (targetDocument) remaining = roundMoney(remaining - applyToDocument(targetDocument, settlement, remaining));
    // 2) เอกสารเก่าสุดของคู่ค้ารายเดียวกัน
    for (const subledgerDocument of documents) {
      if (remaining < AMOUNT_EPSILON) break;
      if (subledgerDocument.partyKey !== settlement.partyKey || subledgerDocument.outstanding < AMOUNT_EPSILON) continue;
      remaining = roundMoney(remaining - applyToDocument(subledgerDocument, settlement, remaining));
    }
    // 3) ชำระเกิน
    if (remaining >= AMOUNT_EPSILON) {
      unappliedCreditByParty.set(settlement.partyKey, roundMoney((unappliedCreditByParty.get(settlement.partyKey) || 0) + remaining));
    }
  });

  // สรุปรายคู่ค้า
  const partyByKey = new Map();
  const getParty = (partyKey, partyName) => {
    if (!partyByKey.has(partyKey)) {
      partyByKey.set(partyKey, { partyKey, partyName, invoiced: 0, paid: 0, outstanding: 0, unappliedCredit: 0, documentCount: 0 });
    }
    return partyByKey.get(partyKey);
  };
  documents.forEach((subledgerDocument) => {
    const party = getParty(subledgerDocument.partyKey, subledgerDocument.partyName);
    party.invoiced = roundMoney(party.invoiced + subledgerDocument.amount);
    party.paid = roundMoney(party.paid + subledgerDocument.paid);
    party.outstanding = roundMoney(party.outstanding + subledgerDocument.outstanding);
    party.documentCount += 1;
  });
  settlements.forEach((settlement) => getParty(settlement.partyKey, settlement.partyName));
  unappliedCreditByParty.forEach((amount, partyKey) => { partyByKey.get(partyKey).unappliedCredit = amount; });

  const parties = [...partyByKey.values()].sort((left, right) => right.outstanding - left.outstanding);
  return { controlAccount, documents, parties };
}

/**
 * บัญชีนี้เป็นบัญชีคุมลูกหนี้หรือเจ้าหนี้หรือไม่ (ใช้บังคับให้ระบุคู่ค้าในสมุดรายวัน)
 * @param {string} accountId
 * @returns {"receivable" | "payable" | null}
 */
export function getControlAccountType(accountId) {
  if (findAccountForRole("receivable")?.id === accountId) return "receivable";
  if (findAccountForRole("payable")?.id === accountId) return "payable";
  return null;
}

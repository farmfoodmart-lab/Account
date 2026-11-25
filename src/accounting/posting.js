/**
 * @file สร้างรายการในสมุดรายวันให้อัตโนมัติ
 *
 * - buildSettlementLines : รับชำระ/จ่ายชำระจากหน้าลูกหนี้/เจ้าหนี้
 * - buildDocumentLines   : ตั้งหนี้จากข้อมูลลูกหนี้/เจ้าหนี้ระบบเดิม (ใช้ตอนย้ายข้อมูล)
 * - buildCreditSaleWithCostLines : ขายเชื่อพร้อมตัดต้นทุน จากไฟล์รายชื่อลูกค้าพร้อมต้นทุน
 * - upsertJournalEntry   : เพิ่ม/แก้ไขรายการในสมุดรายวัน (ใช้ร่วมกับการปิดบัญชี)
 */
import { state } from "../core/store.js";
import { createId } from "../utils/id.js";
import { AMOUNT_EPSILON } from "./constants.js";
import { findAccountById, findAccountForRole } from "./accounts.js";
import { createDocumentNumber, getEntryDocumentPrefix } from "./journal.js";

/**
 * ปัดเศษเป็นทศนิยม 2 ตำแหน่ง (หน่วยสตางค์)
 * @param {unknown} amount
 * @returns {number}
 */
export function roundMoney(amount) {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

/**
 * แยกยอดเอกสารเป็น มูลค่าก่อน VAT / VAT / ยอดรวม
 * เอกสารรุ่นเก่ามีแค่ amount (ยอดรวม) จะถือว่าไม่มี VAT
 * @param {{ amount: number, net?: number, vat?: number }} subledgerRecord
 * @returns {{ net: number, vat: number, total: number }}
 */
export function getDocumentAmounts(subledgerRecord) {
  const total = roundMoney(subledgerRecord.amount);
  if (subledgerRecord.net == null || subledgerRecord.net === "") return { net: total, vat: 0, total };
  const net = roundMoney(subledgerRecord.net);
  const vat = roundMoney(subledgerRecord.vat);
  return { net, vat, total: roundMoney(net + vat) };
}

/**
 * การตั้งค่าของทะเบียนแต่ละชนิด
 * - controlRole บัญชีคุม (ลูกหนี้การค้า / เจ้าหนี้การค้า)
 * - counterRole บัญชีคู่ตรงข้ามเริ่มต้น (รายได้ / ค่าใช้จ่าย)
 * - vatRole     บัญชีภาษี (ภาษีขาย / ภาษีซื้อ)
 */
export const SUBLEDGER_TYPES = {
  receivable: {
    label: "ลูกหนี้",
    controlRole: "receivable",
    counterRole: "revenue",
    vatRole: "vatOutput",
    settlementSource: "receipt",
  },
  payable: {
    label: "เจ้าหนี้",
    controlRole: "payable",
    counterRole: "expense",
    vatRole: "vatInput",
    settlementSource: "payment",
  },
};

/**
 * @typedef {{ accountId: string, debit: number, credit: number }} JournalLine
 * @typedef {{ lines: JournalLine[] } | { error: string }} PostingResult
 */

/**
 * บรรทัดบัญชีของการตั้งหนี้
 *   ลูกหนี้: Dr ลูกหนี้การค้า (ยอดรวม) / Cr รายได้ (ก่อน VAT) / Cr ภาษีขาย (VAT)
 *   เจ้าหนี้: Dr ค่าใช้จ่าย (ก่อน VAT) / Dr ภาษีซื้อ (VAT) / Cr เจ้าหนี้การค้า (ยอดรวม)
 * @param {"receivable" | "payable"} subledgerType
 * @param {object} subledgerRecord เอกสารลูกหนี้/เจ้าหนี้
 * @returns {PostingResult}
 */
export function buildDocumentLines(subledgerType, subledgerRecord) {
  const config = SUBLEDGER_TYPES[subledgerType];
  const isReceivable = subledgerType === "receivable";
  const controlAccount = findAccountForRole(config.controlRole);
  const counterAccount = findAccountById(subledgerRecord.counterAccountId) || findAccountForRole(config.counterRole);
  const { net, vat, total } = getDocumentAmounts(subledgerRecord);

  if (!controlAccount) {
    return { error: `ยังไม่ได้กำหนดบัญชี${isReceivable ? "ลูกหนี้การค้า" : "เจ้าหนี้การค้า"} (ตั้งค่าได้ที่หน้าการตั้งค่า > บัญชีสำหรับลงบัญชีอัตโนมัติ)` };
  }
  if (!counterAccount) return { error: `เลือกบัญชี${isReceivable ? "รายได้" : "ค่าใช้จ่าย"}ก่อน` };

  let vatAccount = null;
  if (vat > AMOUNT_EPSILON) {
    vatAccount = findAccountForRole(config.vatRole);
    if (!vatAccount) return { error: `ยังไม่ได้กำหนดบัญชี${isReceivable ? "ภาษีขาย" : "ภาษีซื้อ"} (ตั้งค่าได้ที่หน้าการตั้งค่า)` };
  }

  const vatLines = vatAccount
    ? [{ accountId: vatAccount.id, debit: isReceivable ? 0 : vat, credit: isReceivable ? vat : 0 }]
    : [];
  const lines = isReceivable
    ? [
      { accountId: controlAccount.id, debit: total, credit: 0 },
      { accountId: counterAccount.id, debit: 0, credit: net },
      ...vatLines,
    ]
    : [
      { accountId: counterAccount.id, debit: net, credit: 0 },
      ...vatLines,
      { accountId: controlAccount.id, debit: 0, credit: total },
    ];
  return { lines };
}

/**
 * บรรทัดบัญชีของการรับ/จ่ายชำระ
 *   รับชำระลูกหนี้: Dr เงินสด/ธนาคาร / Cr ลูกหนี้การค้า
 *   จ่ายชำระเจ้าหนี้: Dr เจ้าหนี้การค้า / Cr เงินสด/ธนาคาร
 * @param {"receivable" | "payable"} subledgerType
 * @param {{ accountId: string, amount: number }} settlement การชำระหนึ่งครั้ง
 * @returns {PostingResult}
 */
export function buildSettlementLines(subledgerType, settlement) {
  const controlAccount = findAccountForRole(SUBLEDGER_TYPES[subledgerType].controlRole);
  const cashAccount = findAccountById(settlement.accountId);
  if (!controlAccount) return { error: "ยังไม่ได้กำหนดบัญชีคุม (ตั้งค่าได้ที่หน้าการตั้งค่า)" };
  if (!cashAccount) return { error: "เลือกบัญชีเงินสด/ธนาคาร" };

  const amount = roundMoney(settlement.amount);
  const lines = subledgerType === "receivable"
    ? [
      { accountId: cashAccount.id, debit: amount, credit: 0 },
      { accountId: controlAccount.id, debit: 0, credit: amount },
    ]
    : [
      { accountId: controlAccount.id, debit: amount, credit: 0 },
      { accountId: cashAccount.id, debit: 0, credit: amount },
    ];
  return { lines };
}

/**
 * สร้างหรือแก้ไขรายการในสมุดรายวัน (แก้ไขในอาร์เรย์ `entries` ที่ส่งเข้ามา ผู้เรียกต้องบันทึกเอง)
 * @param {Array<object>} entries สำเนาของ state.entries
 * @param {object} entryData
 * @param {string} [entryData.entryId] ถ้ามี = แก้ไขรายการเดิม (คงเลขที่เอกสารเดิม)
 * @param {string} entryData.date
 * @param {string} entryData.desc คำอธิบายรายการ
 * @param {JournalLine[]} entryData.lines
 * @param {{ type: string, id: string, docNo?: string }} entryData.source ที่มาของรายการ
 * @param {string} [entryData.customerId]
 * @param {string} [entryData.customerName]
 * @returns {string} id ของรายการ
 */
export function upsertJournalEntry(entries, { entryId, date, desc, lines, source, customerId, customerName }) {
  const now = new Date().toISOString();
  // ใส่เฉพาะฟิลด์ที่มีค่า: Firestore ไม่รับค่า undefined
  const optionalFields = {
    ...(source ? { source } : {}),
    ...(customerId ? { customerId } : {}),
    ...(customerName ? { customerName } : {}),
  };

  const existingIndex = entryId ? entries.findIndex((entry) => entry.id === entryId) : -1;
  if (existingIndex >= 0) {
    const existingEntry = entries[existingIndex];
    entries[existingIndex] = { ...existingEntry, date, desc, lines, updatedAt: now, ...optionalFields };
    return existingEntry.id;
  }

  const newEntryId = createId();
  entries.push({
    id: newEntryId,
    date,
    docNo: createDocumentNumber(entries, getEntryDocumentPrefix(lines), date), // รหัสเอกสารตามบัญชีบรรทัดที่ 1
    kind: "general",
    desc,
    lines,
    createdAt: now,
    ...optionalFields,
  });
  return newEntryId;
}

/**
 * เรียงรายการตามวันที่ (ถ้าวันเดียวกัน เรียงตาม id ซึ่งสะท้อนลำดับการสร้าง)
 * @param {Array<object>} entries
 * @returns {Array<object>} อาร์เรย์เดิม (เรียงในที่)
 */
export function sortEntriesByDate(entries) {
  return entries.sort((leftEntry, rightEntry) =>
    String(leftEntry.date || "").localeCompare(String(rightEntry.date || ""))
    || String(leftEntry.id).localeCompare(String(rightEntry.id)));
}

/**
 * บรรทัดบัญชีของการขายเชื่อพร้อมตัดต้นทุน (ใช้ตอนนำเข้าไฟล์ "รายชื่อลูกค้าพร้อมต้นทุน")
 *   Dr ลูกหนี้การค้า (ราคาขาย)   Cr รายได้ (ราคาขาย)
 *   Dr ต้นทุนขาย (ราคาทุน)       Cr สินค้าคงเหลือ (ราคาทุน)
 * ส่วนที่เป็นศูนย์จะไม่สร้างบรรทัด
 * @param {{ price: number, cost: number }} amounts
 * @returns {PostingResult}
 */
export function buildCreditSaleWithCostLines({ price, cost }) {
  const salePrice = roundMoney(price);
  const costPrice = roundMoney(cost);
  const roleNames = { receivable: "ลูกหนี้การค้า", revenue: "รายได้", costOfSales: "ต้นทุนขาย", inventory: "สินค้าคงเหลือ" };
  const requiredRoles = [
    ...(salePrice > 0 ? ["receivable", "revenue"] : []),
    ...(costPrice > 0 ? ["costOfSales", "inventory"] : []),
  ];
  const accounts = {};
  const missingNames = [];
  requiredRoles.forEach((role) => {
    accounts[role] = findAccountForRole(role);
    if (!accounts[role]) missingNames.push(roleNames[role]);
  });
  if (missingNames.length) {
    return { error: `ยังไม่มีบัญชี ${missingNames.join(", ")} — กด “เพิ่มผังบัญชีมาตรฐาน” ในหน้าผังบัญชี หรือกำหนดในหน้าการตั้งค่า` };
  }

  const lines = [];
  if (salePrice > 0) {
    lines.push({ accountId: accounts.receivable.id, debit: salePrice, credit: 0 });
    lines.push({ accountId: accounts.revenue.id, debit: 0, credit: salePrice });
  }
  if (costPrice > 0) {
    lines.push({ accountId: accounts.costOfSales.id, debit: costPrice, credit: 0 });
    lines.push({ accountId: accounts.inventory.id, debit: 0, credit: costPrice });
  }
  return { lines };
}

/**
 * ตัวเลือกบัญชีเงินสด/ธนาคารสำหรับกล่องรับ/จ่ายชำระ (แสดงบัญชีสินทรัพย์ทั้งหมด)
 * @returns {{ options: Array<{ value: string, label: string }>, defaultAccountId: string }}
 */
export function getCashAccountOptions() {
  const preferredAccount = findAccountForRole("cash");
  const assetAccounts = state.accounts
    .filter((account) => account.type === "asset")
    .sort((leftAccount, rightAccount) =>
      String(leftAccount.code).localeCompare(String(rightAccount.code), "th-TH", { numeric: true }));
  return {
    options: assetAccounts.map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` })),
    defaultAccountId: preferredAccount ? preferredAccount.id : assetAccounts[0]?.id || "",
  };
}

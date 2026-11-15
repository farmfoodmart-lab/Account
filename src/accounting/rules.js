/**
 * @file กฎพื้นฐานของบัญชีคู่ (ฟังก์ชันบริสุทธิ์ ไม่อ่าน state)
 */
import { ENTRY_KIND_LABELS } from "./constants.js";

/**
 * บัญชีมียอดคงเหลือปกติด้านเดบิตหรือไม่
 * - ด้านเดบิต: สินทรัพย์ และ ค่าใช้จ่าย
 * - ด้านเครดิต: หนี้สิน ทุน และ รายได้
 * @param {string} accountType
 * @returns {boolean}
 */
export function isDebitNormal(accountType) {
  return accountType === "asset" || accountType === "expense";
}

/**
 * ประเภทของรายการในสมุดรายวัน (ข้อมูลเก่าที่ไม่มีฟิลด์ kind ถือเป็นรายการทั่วไป)
 * @param {{ kind?: string } | null | undefined} entry
 * @returns {"general" | "adjusting" | "closing"}
 */
export function getEntryKind(entry) {
  const kind = entry && entry.kind;
  return typeof kind === "string" && Object.hasOwn(ENTRY_KIND_LABELS, kind) ? kind : "general";
}

/**
 * ยอดรวมของรายการ (ผลรวมด้านเดบิต ซึ่งเท่ากับด้านเครดิตเมื่อรายการดุล)
 * @param {{ lines: Array<{ debit?: number }> }} entry
 * @returns {number}
 */
export function calculateEntryTotal(entry) {
  return entry.lines.reduce((total, line) => total + (Number(line.debit) || 0), 0);
}

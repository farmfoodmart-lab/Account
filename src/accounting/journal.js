/**
 * @file กฎของสมุดรายวัน: เลขที่เอกสาร และการล็อกงวดบัญชี
 */
import { state } from "../core/store.js";
import { toIsoDate } from "../utils/date.js";
import { formatDate } from "../utils/format.js";

/**
 * สร้างเลขที่เอกสารถัดไปในรูปแบบ PREFIX-YYYYMM-0001 (รันใหม่ทุกเดือน)
 * @param {Array<{ id?: string, docNo?: string }>} records เอกสารที่มีอยู่ ใช้หาเลขล่าสุด
 * @param {string} prefix เช่น "JV" (สมุดรายวัน), "INV" (ลูกหนี้), "AP" (เจ้าหนี้)
 * @param {unknown} date วันที่ของเอกสาร (ใช้กำหนดปี-เดือน)
 * @param {string} [ignoreRecordId=""] ไม่นับเอกสารนี้ (ใช้ตอนแก้ไขเอกสารเดิม)
 * @param {Set<string> | null} [reservedNumbers=null] เลขที่จองไว้แล้วในรอบเดียวกัน
 *        (ใช้ตอนสร้างหลายเอกสารพร้อมกัน เช่น การนำเข้า) — เลขใหม่จะถูกเพิ่มเข้าไปในชุดนี้ด้วย
 * @returns {string} เช่น "JV-202611-0007"
 */
export function createDocumentNumber(records, prefix, date, ignoreRecordId = "", reservedNumbers = null) {
  const isoDate = toIsoDate(date) || new Date().toISOString().slice(0, 10);
  const numberPrefix = `${prefix}-${isoDate.slice(0, 7).replace("-", "")}-`;

  let highestSequence = 0;
  const considerNumber = (documentNumber) => {
    if (!documentNumber || !String(documentNumber).startsWith(numberPrefix)) return;
    const sequence = parseInt(String(documentNumber).slice(numberPrefix.length), 10);
    if (sequence > highestSequence) highestSequence = sequence;
  };
  records.forEach((record) => {
    if (record.id !== ignoreRecordId) considerNumber(record.docNo);
  });
  if (reservedNumbers) reservedNumbers.forEach(considerNumber);

  const documentNumber = `${numberPrefix}${String(highestSequence + 1).padStart(4, "0")}`;
  if (reservedNumbers) reservedNumbers.add(documentNumber);
  return documentNumber;
}

/**
 * เลขที่ใบสำคัญถัดไปของสมุดรายวัน (JV-YYYYMM-####)
 * @param {unknown} date
 * @param {string} [ignoreEntryId=""]
 * @returns {string}
 */
export function createJournalNumber(date, ignoreEntryId = "") {
  return createDocumentNumber(state.entries, "JV", date, ignoreEntryId);
}

/**
 * วันที่นี้อยู่ในงวดที่ปิดแล้วหรือไม่ (ลงวันที่ถึง settings.lockDate)
 * @param {unknown} date
 * @returns {boolean}
 */
export function isDateLocked(date) {
  const lockDate = state.settings.lockDate;
  const isoDate = toIsoDate(date);
  return Boolean(lockDate && isoDate && isoDate <= lockDate);
}

/** ข้อความแจ้งเตือนเมื่อพยายามแก้ไขรายการในงวดที่ปิดแล้ว */
export function getLockedPeriodMessage() {
  return `งวดบัญชีถึงวันที่ ${formatDate(state.settings.lockDate)} ถูกปิดแล้ว แก้ไขหรือเพิ่มรายการในช่วงนี้ไม่ได้ (ปลดล็อกได้ที่หน้าการตั้งค่า)`;
}

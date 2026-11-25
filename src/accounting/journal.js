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

/* ------------------------------------------------------------------ */
/* ซ่อมแซมลำดับเลขที่เอกสาร                                              */
/* ------------------------------------------------------------------ */

/** เลขที่ใบสำคัญมาตรฐาน JV-YYYYMM-#### (กลุ่ม 1 = ปีเดือน, กลุ่ม 2 = ลำดับ) */
const JOURNAL_NUMBER_PATTERN = /^JV-(\d{6})-(\d+)$/;
/** เลขที่ใบสำคัญที่เขียนอยู่ในข้อความ (เช่น คำอธิบาย "รับชำระ JV-202602-0015 ...") */
const JOURNAL_NUMBER_IN_TEXT_PATTERN = /JV-\d{6}-\d{4,}/g;

/**
 * วางแผนเรียงเลขที่ใบสำคัญใหม่ ให้แต่ละเดือนเรียงตามวันที่ เริ่ม 0001 ต่อเนื่องไม่ข้าม
 * - รายการเรียงตาม วันที่ → ลำดับเดิม (วันเดียวกันคงลำดับเดิม) → เวลาที่สร้าง
 * - เดือนตามวันที่ของรายการ (เลขที่ปีเดือนไม่ตรงกับวันที่ จะได้เลขของเดือนที่ถูกต้อง)
 * - รายการที่ยังไม่มีเลขที่ ได้เลขที่ด้วย
 * - ไม่แตะ: เลขที่รูปแบบอื่นที่ผู้ใช้พิมพ์เอง และทั้งเดือนที่มีรายการอยู่ในงวดที่ปิดแล้ว
 * - เลขที่ที่เขียนอยู่ในคำอธิบายของรายการอื่น (เช่น รับชำระ/กลับรายการ) เปลี่ยนตามเลขใหม่
 * ฟังก์ชันนี้ไม่แก้ state — คืนอาร์เรย์ใหม่สำหรับบันทึก
 * @param {object[]} entries
 * @returns {{ entries: object[], changedCount: number, monthCount: number, skippedLockedMonths: string[],
 *             descriptionUpdates: number }}
 */
export function planDocumentNumberRepair(entries) {
  const monthOf = (entry) => (toIsoDate(entry.date) || "").slice(0, 7).replace("-", "");
  const isRenumberable = (entry) => !entry.docNo || JOURNAL_NUMBER_PATTERN.test(String(entry.docNo));

  // จัดกลุ่มตามเดือนของวันที่ / เดือนที่มีรายการในงวดที่ปิดแล้ว → ข้ามทั้งเดือน
  const groups = new Map();
  const lockedMonths = new Set();
  entries.forEach((entry, index) => {
    const month = monthOf(entry);
    if (!month || !isRenumberable(entry)) return;
    if (isDateLocked(entry.date)) lockedMonths.add(month);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push({ entry, index });
  });

  // เลขที่ที่ไม่ได้อยู่ในชุดที่เรียงใหม่ (เดือนที่ล็อก / รูปแบบอื่น) → ห้ามซ้ำ
  const renumberedIndexes = new Set();
  groups.forEach((items, month) => {
    if (!lockedMonths.has(month)) items.forEach((item) => renumberedIndexes.add(item.index));
  });
  const reservedNumbers = new Set(entries
    .filter((entry, index) => !renumberedIndexes.has(index) && entry.docNo)
    .map((entry) => String(entry.docNo)));

  const sequenceOf = (entry, month) => {
    const match = String(entry.docNo || "").match(JOURNAL_NUMBER_PATTERN);
    return match && match[1] === month ? parseInt(match[2], 10) : Number.MAX_SAFE_INTEGER;
  };
  const newNumbers = new Map(); // index → เลขที่ใหม่
  const renamedNumbers = new Map(); // เลขที่เดิม → เลขที่ใหม่ (ใช้แก้ข้อความคำอธิบาย)
  let monthCount = 0;
  groups.forEach((items, month) => {
    if (lockedMonths.has(month)) return;
    items.sort((left, right) => (toIsoDate(left.entry.date) || "").localeCompare(toIsoDate(right.entry.date) || "")
      || sequenceOf(left.entry, month) - sequenceOf(right.entry, month)
      || String(left.entry.createdAt || "").localeCompare(String(right.entry.createdAt || ""))
      || left.index - right.index);
    let sequence = 0;
    let isMonthChanged = false;
    items.forEach(({ entry, index }) => {
      let documentNumber;
      do {
        sequence += 1;
        documentNumber = `JV-${month}-${String(sequence).padStart(4, "0")}`;
      } while (reservedNumbers.has(documentNumber));
      if (documentNumber !== entry.docNo) {
        newNumbers.set(index, documentNumber);
        if (entry.docNo) renamedNumbers.set(String(entry.docNo), documentNumber);
        isMonthChanged = true;
      }
    });
    if (isMonthChanged) monthCount += 1;
  });

  let descriptionUpdates = 0;
  const nextEntries = entries.map((entry, index) => {
    const documentNumber = newNumbers.get(index);
    let { desc } = entry;
    // แก้เลขที่ในคำอธิบาย (แทนทีเดียวทั้งข้อความ จึงไม่แทนซ้ำซ้อน) — ไม่แตะรายการในงวดที่ปิดแล้ว
    if (renamedNumbers.size && desc && !isDateLocked(entry.date)) {
      const updatedDesc = String(desc).replace(JOURNAL_NUMBER_IN_TEXT_PATTERN, (number) => renamedNumbers.get(number) || number);
      if (updatedDesc !== desc) {
        desc = updatedDesc;
        descriptionUpdates += 1;
      }
    }
    if (!documentNumber && desc === entry.desc) return entry;
    return { ...entry, ...(documentNumber ? { docNo: documentNumber } : {}), desc };
  });

  return {
    entries: nextEntries,
    changedCount: newNumbers.size,
    monthCount,
    skippedLockedMonths: [...lockedMonths].filter((month) => groups.has(month)).sort(),
    descriptionUpdates,
  };
}

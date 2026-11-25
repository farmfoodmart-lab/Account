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

/* ------------------------------------------------------------------ */
/* รหัสเอกสาร (ขึ้นต้นเลขที่) — กรอกที่ผังบัญชี ใช้ตามบัญชีบรรทัดที่ 1 ของรายการ */
/* ------------------------------------------------------------------ */

/** รหัสเอกสารเมื่อบัญชีบรรทัดที่ 1 ไม่ได้กำหนดไว้ */
export const DEFAULT_DOCUMENT_PREFIX = "JV";

/** รหัสเอกสารใช้ได้เฉพาะ A-Z และ 0-9 (ตัวพิมพ์ใหญ่) ยาวไม่เกิน 10 ตัว */
export function normalizeDocumentPrefix(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

/**
 * รหัสเอกสารของรายการ: รหัสของบัญชีบรรทัดที่ 1 (ไม่ได้กำหนด → JV)
 * @param {Array<{ accountId?: string }>} [lines]
 */
export function getEntryDocumentPrefix(lines = []) {
  const firstAccountId = lines?.[0]?.accountId;
  const account = firstAccountId ? state.accounts.find((item) => item.id === firstAccountId) : null;
  return normalizeDocumentPrefix(account?.docPrefix) || DEFAULT_DOCUMENT_PREFIX;
}

/** รหัสเอกสารที่ระบบรู้จัก (จากผังบัญชี + JV) เรียงยาวก่อน เพื่อให้ regex จับตัวที่ยาวกว่าก่อน */
function getKnownPrefixes() {
  const prefixes = new Set([DEFAULT_DOCUMENT_PREFIX]);
  state.accounts.forEach((account) => {
    const prefix = normalizeDocumentPrefix(account.docPrefix);
    if (prefix) prefixes.add(prefix);
  });
  return [...prefixes].sort((left, right) => right.length - left.length);
}

/**
 * แยกเลขที่อัตโนมัติ PREFIX-YYYYMM-#### (เฉพาะรหัสเอกสารที่ระบบรู้จัก)
 * @returns {{ prefix: string, month: string, sequence: number } | null}
 */
export function parseAutoDocumentNumber(documentNumber) {
  const match = String(documentNumber || "").match(new RegExp(`^(${getKnownPrefixes().join("|")})-(\\d{6})-(\\d+)$`));
  return match ? { prefix: match[1], month: match[2], sequence: parseInt(match[3], 10) } : null;
}

/**
 * เลขที่ใบสำคัญถัดไปของสมุดรายวัน (PREFIX-YYYYMM-#### รันแยกตามรหัสเอกสาร)
 * @param {unknown} date
 * @param {string} [ignoreEntryId=""]
 * @param {Array<{ accountId?: string }>} [lines] บรรทัดของรายการ (รหัสเอกสารตามบัญชีบรรทัดที่ 1)
 * @returns {string}
 */
export function createJournalNumber(date, ignoreEntryId = "", lines = []) {
  return createDocumentNumber(state.entries, getEntryDocumentPrefix(lines), date, ignoreEntryId);
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

/**
 * วางแผนเรียงเลขที่ใบสำคัญใหม่ ให้แต่ละชุด (รหัสเอกสาร + เดือน) เรียงตามวันที่ เริ่ม 0001 ต่อเนื่องไม่ข้าม
 * - รหัสเอกสาร (JV และที่กรอกในผังบัญชี เช่น CUS / SUB) รันเลขแยกกัน และคงรหัสเดิมของแต่ละรายการ
 * - รายการเรียงตาม วันที่ → ลำดับเดิม (วันเดียวกันคงลำดับเดิม) → เวลาที่สร้าง
 * - เดือนตามวันที่ของรายการ (เลขที่ปีเดือนไม่ตรงกับวันที่ จะได้เลขของเดือนที่ถูกต้อง)
 * - รายการที่ยังไม่มีเลขที่ ได้เลขที่ด้วย (รหัสเอกสารตามบัญชีบรรทัดที่ 1)
 * - ไม่แตะ: เลขที่รูปแบบอื่นที่ผู้ใช้พิมพ์เอง และทั้งเดือนที่มีรายการอยู่ในงวดที่ปิดแล้ว
 * - เลขที่ที่เขียนอยู่ในคำอธิบายของรายการอื่น (เช่น รับชำระ/กลับรายการ) เปลี่ยนตามเลขใหม่
 * ฟังก์ชันนี้ไม่แก้ state — คืนอาร์เรย์ใหม่สำหรับบันทึก
 * @param {object[]} entries
 * @returns {{ entries: object[], changedCount: number, monthCount: number, skippedLockedMonths: string[],
 *             descriptionUpdates: number }}
 */
export function planDocumentNumberRepair(entries) {
  const monthOf = (entry) => (toIsoDate(entry.date) || "").slice(0, 7).replace("-", "");
  /** รหัสเอกสารของรายการ: ยังไม่มีเลขที่ / เลขอัตโนมัติ → ตามบัญชีบรรทัดที่ 1 (แก้ JV ที่ควรเป็น CUS/SUB) / เลขรูปแบบอื่น → null (ไม่แตะ) */
  const prefixOf = (entry) => {
    if (!entry.docNo || parseAutoDocumentNumber(entry.docNo)) return getEntryDocumentPrefix(entry.lines);
    return null;
  };

  // จัดกลุ่มตาม รหัสเอกสาร + เดือนของวันที่ / เดือนที่มีรายการในงวดที่ปิดแล้ว → ข้ามทั้งเดือน (ทุกรหัสเอกสาร)
  const groups = new Map();
  const lockedMonths = new Set();
  entries.forEach((entry, index) => {
    const month = monthOf(entry);
    const prefix = prefixOf(entry);
    if (!month || !prefix) return;
    if (isDateLocked(entry.date)) lockedMonths.add(month);
    const groupKey = `${prefix}-${month}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { prefix, month, items: [] });
    groups.get(groupKey).items.push({ entry, index });
  });

  // เลขที่ที่ไม่ได้อยู่ในชุดที่เรียงใหม่ (เดือนที่ล็อก / รูปแบบอื่น) → ห้ามซ้ำ
  const renumberedIndexes = new Set();
  groups.forEach(({ month, items }) => {
    if (!lockedMonths.has(month)) items.forEach((item) => renumberedIndexes.add(item.index));
  });
  const reservedNumbers = new Set(entries
    .filter((entry, index) => !renumberedIndexes.has(index) && entry.docNo)
    .map((entry) => String(entry.docNo)));

  const sequenceOf = (entry, prefix, month) => {
    const parsed = parseAutoDocumentNumber(entry.docNo);
    return parsed && parsed.month === month ? parsed.sequence : Number.MAX_SAFE_INTEGER;
  };
  const newNumbers = new Map(); // index → เลขที่ใหม่
  const renamedNumbers = new Map(); // เลขที่เดิม → เลขที่ใหม่ (ใช้แก้ข้อความคำอธิบาย)
  const changedMonths = new Set();
  groups.forEach(({ prefix, month, items }) => {
    if (lockedMonths.has(month)) return;
    items.sort((left, right) => (toIsoDate(left.entry.date) || "").localeCompare(toIsoDate(right.entry.date) || "")
      || sequenceOf(left.entry, prefix, month) - sequenceOf(right.entry, prefix, month)
      || String(left.entry.createdAt || "").localeCompare(String(right.entry.createdAt || ""))
      || left.index - right.index);
    let sequence = 0;
    items.forEach(({ entry, index }) => {
      let documentNumber;
      do {
        sequence += 1;
        documentNumber = `${prefix}-${month}-${String(sequence).padStart(4, "0")}`;
      } while (reservedNumbers.has(documentNumber));
      if (documentNumber !== entry.docNo) {
        newNumbers.set(index, documentNumber);
        if (entry.docNo) renamedNumbers.set(String(entry.docNo), documentNumber);
        changedMonths.add(month);
      }
    });
  });

  // เลขที่ใบสำคัญที่เขียนอยู่ในข้อความ (เช่น คำอธิบาย "รับชำระ CUS-202602-0015 ...")
  const numberInTextPattern = new RegExp(`(?:${getKnownPrefixes().join("|")})-\\d{6}-\\d{4,}`, "g");
  let descriptionUpdates = 0;
  const nextEntries = entries.map((entry, index) => {
    const documentNumber = newNumbers.get(index);
    let { desc } = entry;
    // แก้เลขที่ในคำอธิบาย (แทนทีเดียวทั้งข้อความ จึงไม่แทนซ้ำซ้อน) — ไม่แตะรายการในงวดที่ปิดแล้ว
    if (renamedNumbers.size && desc && !isDateLocked(entry.date)) {
      const updatedDesc = String(desc).replace(numberInTextPattern, (number) => renamedNumbers.get(number) || number);
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
    monthCount: changedMonths.size,
    skippedLockedMonths: [...lockedMonths].filter((month) => [...groups.values()].some((group) => group.month === month)).sort(),
    descriptionUpdates,
  };
}

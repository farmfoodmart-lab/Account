/**
 * @file ฟังก์ชันจัดการวันที่
 *
 * ภายในระบบเก็บวันที่เป็นรูปแบบ ISO "YYYY-MM-DD" เสมอ เพราะเปรียบเทียบแบบข้อความได้ทันที
 * แต่ข้อมูลเก่าหรือข้อมูลที่นำเข้าจาก Excel อาจเป็น "DD/MM/YYYY" จึงต้องแปลงด้วย toIsoDate() ก่อนเปรียบเทียบ
 */

/**
 * แปลงวันที่หลายรูปแบบให้เป็น "YYYY-MM-DD"
 * @param {unknown} value เช่น "2026-1-5" หรือ "05/01/2026"
 * @returns {string} วันที่แบบ ISO หรือสตริงว่างถ้าแปลงไม่ได้
 */
export function toIsoDate(value) {
  if (value == null || value === "") return "";
  const text = String(value).trim();

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const dayFirstMatch = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dayFirstMatch) {
    const [, day, month, year] = dayFirstMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return "";
}

/**
 * ตรวจว่าวันที่อยู่ในช่วง fromDate ถึง toDate หรือไม่ (นับรวมวันขอบทั้งสองด้าน)
 * ถ้าไม่ระบุช่วงเลย ถือว่าอยู่ในช่วงเสมอ
 * @param {unknown} date
 * @param {string} [fromDate=""] วันเริ่มต้น "YYYY-MM-DD"
 * @param {string} [toDate=""] วันสิ้นสุด "YYYY-MM-DD"
 * @returns {boolean}
 */
export function isDateInRange(date, fromDate = "", toDate = "") {
  const isoDate = toIsoDate(date);
  if (!isoDate) return !fromDate && !toDate;
  if (fromDate && isoDate < fromDate) return false;
  if (toDate && isoDate > toDate) return false;
  return true;
}

/**
 * แปลง Date object เป็น "YYYY-MM-DD" ตามเวลาท้องถิ่นของเครื่อง
 * @param {Date} date
 * @returns {string}
 */
export function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * วันที่วันนี้ตามเวลาท้องถิ่น ในรูปแบบ "YYYY-MM-DD"
 * @returns {string}
 */
export function getTodayIso() {
  return formatIsoDate(new Date());
}

/**
 * วันที่วันนี้แบบ "YYYYMMDD" สำหรับต่อท้ายชื่อไฟล์ที่ดาวน์โหลด
 * @returns {string}
 */
export function getFileDateStamp() {
  return getTodayIso().replace(/-/g, "");
}

/**
 * จำนวนวันระหว่างสองวันที่ (toDate - fromDate)
 * @param {string} fromDate "YYYY-MM-DD"
 * @param {string} toDate "YYYY-MM-DD"
 * @returns {number}
 */
export function daysBetween(fromDate, toDate) {
  const MS_PER_DAY = 86400000;
  return Math.floor((Date.parse(toDate) - Date.parse(fromDate)) / MS_PER_DAY);
}

/**
 * ช่วงวันที่ของทั้งเดือนที่มีวันที่นี้อยู่
 * @param {string} isoDate "YYYY-MM-DD"
 * @returns {{ from: string, to: string }} วันแรกและวันสุดท้ายของเดือน
 */
export function getMonthRange(isoDate) {
  const [year, month] = isoDate.split("-").map(Number);
  // new Date(year, month, 0) = วันสุดท้ายของเดือน month (เดือนนับจาก 1)
  return { from: formatIsoDate(new Date(year, month - 1, 1)), to: formatIsoDate(new Date(year, month, 0)) };
}

/**
 * ช่วงวันที่ของ "เดือนล่าสุดที่มีข้อมูล" — ใช้เป็นค่าเริ่มต้นของตัวกรองในหน้าที่มีข้อมูลหลายเดือน
 * ถ้ายังไม่มีข้อมูลเลย ใช้เดือนปัจจุบัน
 * @param {Array<{ date?: unknown }>} records เช่น state.entries
 * @returns {{ from: string, to: string }}
 */
export function getLatestMonthRange(records) {
  let latestDate = "";
  records.forEach((record) => {
    const isoDate = toIsoDate(record.date);
    if (isoDate > latestDate) latestDate = isoDate;
  });
  return getMonthRange(latestDate || getTodayIso());
}

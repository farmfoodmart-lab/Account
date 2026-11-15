/**
 * @file ฟังก์ชันจัดรูปแบบข้อความสำหรับแสดงผล (จำนวนเงิน ตัวเลข วันที่ และ HTML)
 */

/** ยอดเงินที่เล็กกว่าค่านี้ถือว่าเป็นศูนย์ (กันปัญหาทศนิยมของ JavaScript) */
const ZERO_TOLERANCE = 0.005;

/**
 * จำนวนเงินทศนิยม 2 ตำแหน่ง พร้อมตัวคั่นหลักพัน
 * @param {unknown} amount
 * @returns {string} เช่น "1,234.50"
 */
export function formatMoney(amount) {
  return Number(amount || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * จำนวนเต็มพร้อมตัวคั่นหลักพัน
 * @param {unknown} value
 * @returns {string} เช่น "1,234"
 */
export function formatNumber(value) {
  return Number(value || 0).toLocaleString("th-TH");
}

/**
 * จำนวนเงินแบบงานบัญชี: ยอดติดลบอยู่ในวงเล็บ และยอดศูนย์แสดงเป็นขีด
 * @param {unknown} amount
 * @returns {string} เช่น "1,000.00", "(500.00)" หรือ "-"
 */
export function formatAccounting(amount) {
  const value = Number(amount || 0);
  if (Math.abs(value) < ZERO_TOLERANCE) return "-";
  return value < 0 ? `(${formatMoney(-value)})` : formatMoney(value);
}

/**
 * วันที่สำหรับแสดงผลแบบ "DD/MM/YYYY"
 * รองรับวันที่แบบ ISO, แบบ DD/MM/YYYY และตัวเลขวันที่ของ Excel (เมื่อหน้านั้นโหลด SheetJS ไว้)
 * @param {unknown} value
 * @returns {string}
 */
export function formatDate(value) {
  if (value == null || value === "") return "";

  // Excel อาจเก็บวันที่เป็นตัวเลขลำดับวัน (serial number)
  if (typeof value === "number" && typeof XLSX !== "undefined" && XLSX.SSF) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return [parsed.d, parsed.m, parsed.y].map((part) => String(part).padStart(2, "0")).join("/");
    }
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
  }
  const dayFirstMatch = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dayFirstMatch) {
    const [, day, month, year] = dayFirstMatch;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
  }
  return text;
}

/**
 * แปลงอักขระพิเศษของ HTML เพื่อป้องกันการแทรกโค้ด (XSS)
 * ต้องใช้ทุกครั้งที่นำข้อมูลจากผู้ใช้หรือฐานข้อมูลไปใส่ใน innerHTML
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

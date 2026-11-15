/**
 * @file สร้างข้อความ CSV สำหรับส่งออกไปเปิดใน Excel
 */

/**
 * ครอบค่าด้วยเครื่องหมายคำพูด เมื่อค่ามีจุลภาค เครื่องหมายคำพูด หรือการขึ้นบรรทัดใหม่
 * @param {unknown} value
 * @returns {string}
 */
function toCsvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * รวมหัวตารางและแถวข้อมูลเป็นข้อความ CSV
 * @param {string[]} headers หัวคอลัมน์
 * @param {Array<Array<unknown>>} rows แถวข้อมูล
 * @returns {string}
 */
export function buildCsv(headers, rows) {
  return [headers, ...rows]
    .map((cells) => cells.map(toCsvCell).join(","))
    .join("\r\n");
}

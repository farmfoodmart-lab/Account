/**
 * @file สร้างรหัสอ้างอิง (ID) ให้ข้อมูลแต่ละรายการ
 */

/**
 * สร้าง ID แบบสุ่มที่ไม่ซ้ำกันในทางปฏิบัติ
 * ประกอบจากเวลาปัจจุบัน (ฐาน 36) ต่อด้วยตัวอักษรสุ่ม 5 ตัว
 * @returns {string} เช่น "lx3k9a2f7qz"
 */
export function createId() {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 7);
  return timePart + randomPart;
}

/**
 * @file ฟังก์ชันช่วยจัดการ DOM
 */

/**
 * ดึง element จาก id (ใช้แทน document.getElementById ให้โค้ดสั้นและอ่านง่าย)
 * @param {string} elementId
 * @returns {HTMLElement | null}
 */
export function byId(elementId) {
  return document.getElementById(elementId);
}

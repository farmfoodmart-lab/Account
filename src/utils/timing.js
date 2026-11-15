/**
 * @file ฟังก์ชันควบคุมจังหวะการเรียกใช้
 */

/**
 * หน่วงการเรียกฟังก์ชันจนกว่าผู้ใช้จะหยุดพิมพ์ครบ `waitMs` มิลลิวินาที
 * ใช้กับช่องค้นหา เพื่อไม่ให้ประมวลผลใหม่ทุกครั้งที่กดแป้นพิมพ์
 * @template {(...args: any[]) => void} T
 * @param {T} callback ฟังก์ชันที่ต้องการเรียก
 * @param {number} [waitMs=160] เวลารอ (มิลลิวินาที)
 * @returns {T}
 */
export function debounce(callback, waitMs = 160) {
  let timerId = 0;
  return (...args) => {
    window.clearTimeout(timerId);
    timerId = window.setTimeout(() => callback(...args), waitMs);
  };
}

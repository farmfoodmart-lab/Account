/**
 * @file ดาวน์โหลดไฟล์จากเบราว์เซอร์ (CSV, JSON, ข้อความ)
 */

/**
 * สร้างไฟล์ในหน่วยความจำแล้วสั่งให้เบราว์เซอร์ดาวน์โหลด
 * @param {string} fileName ชื่อไฟล์
 * @param {string} content เนื้อหาไฟล์
 * @param {string} [mimeType="text/plain;charset=utf-8"]
 */
export function downloadText(fileName, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/**
 * ดาวน์โหลดไฟล์ CSV โดยใส่ BOM (﻿) ไว้ข้างหน้า เพื่อให้ Excel อ่านภาษาไทยได้ถูกต้อง
 * @param {string} fileName
 * @param {string} csvText
 */
export function downloadCsv(fileName, csvText) {
  downloadText(fileName, `﻿${csvText}`, "text/csv;charset=utf-8");
}

/**
 * ดาวน์โหลดข้อมูลเป็นไฟล์ JSON (จัดย่อหน้าให้อ่านง่าย)
 * @param {string} fileName
 * @param {unknown} data
 */
export function downloadJson(fileName, data) {
  downloadText(fileName, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
}

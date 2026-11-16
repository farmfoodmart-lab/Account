/**
 * @file ตาราง "ไฟล์ที่นำเข้า" พร้อมปุ่มลบไฟล์
 * ลบไฟล์ = ลบข้อมูลทุกแถวที่มาจากไฟล์นั้น และรายการในสมุดรายวันที่ไฟล์นั้นสร้างไว้ (entry.fileId)
 * ใช้ในหน้านำเข้าไฟล์ รายชื่อลูกค้า และเอกสารรับเข้า
 */
import { commitChanges, state } from "../core/store.js";
import { getLockedPeriodMessage, isDateLocked } from "../accounting/journal.js";
import { notifyError, notifySuccess } from "./notifications.js";
import { confirmDialog } from "./dialogs.js";
import { escapeHtml, formatNumber } from "../utils/format.js";

/**
 * ประเภทไฟล์ที่ผูกกับรายการนำเข้า: แต่ละแถวที่นำเข้าจะมีฟิลด์ fileId ชี้กลับมาที่ไฟล์
 * (ค่า key เช่น "customer_names" ถูกบันทึกในฐานข้อมูลแล้ว ห้ามเปลี่ยน)
 */
const IMPORT_FILE_TYPES = {
  customer_names: { label: "รายชื่อลูกค้า", collection: "customerNames" },
  supplier_names: {
    label: "รายชื่อซัพพลายเออร์",
    collection: "suppliers",
    // ซัพพลายเออร์ที่มีรายการในสมุดรายวัน/แม่แบบอ้างอิงแล้ว ห้ามลบ (รายการจะไม่มีคู่ค้า) → เก็บไว้ในทะเบียน
    keep: (supplier) => state.entries.some((entry) => entry.customerId === supplier.id)
      || state.autoDesc.some((rule) => rule.customerId === supplier.id),
  },
  customer_costs: { label: "รายชื่อลูกค้าพร้อมต้นทุน", collection: "customerCosts" },
  incoming_docs: { label: "เอกสารรับเข้า", collection: "incomingDocs" },
};

/**
 * วาดรายการไฟล์ที่นำเข้าลงใน container
 * @param {string} containerId id ของ element ที่จะวาดตาราง
 * @param {string} [fileTypeFilter] แสดงเฉพาะไฟล์ประเภทนี้ (ไม่ระบุ = ทุกประเภท)
 * @param {() => void} [onFilesChanged] เรียกหลังลบไฟล์ เพื่อให้หน้าวาดตารางข้อมูลใหม่
 */
export function renderImportedFileList(containerId, fileTypeFilter, onFilesChanged = () => {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const importedFiles = state.importFiles.filter((importedFile) => !fileTypeFilter || importedFile.type === fileTypeFilter);
  if (!importedFiles.length) {
    container.innerHTML = '<p class="muted">ยังไม่มีไฟล์ที่นำเข้า</p>';
    return;
  }

  const rows = importedFiles.map((importedFile) => `<tr>
      <td>${escapeHtml(importedFile.name)}</td>
      <td>${escapeHtml(IMPORT_FILE_TYPES[importedFile.type]?.label || importedFile.type)}</td>
      <td class="right">${formatNumber(importedFile.count || 0)}</td>
      <td><button type="button" class="small danger" data-delete-import-file="${escapeHtml(importedFile.id)}">ลบไฟล์</button></td>
    </tr>`).join("");
  container.innerHTML = `<div class="card"><h3>ไฟล์ที่นำเข้า</h3><div class="table-wrap">
    <table><thead><tr><th>ชื่อไฟล์</th><th>ประเภท</th><th class="right">จำนวน</th><th>จัดการ</th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;

  container.querySelectorAll("[data-delete-import-file]").forEach((button) => {
    button.addEventListener("click", async () => {
      const fileId = button.dataset.deleteImportFile;
      const importedFile = state.importFiles.find((file) => file.id === fileId);
      if (!importedFile) return;

      // รายการบัญชีที่ไฟล์นี้สร้างไว้ (เช่น ไฟล์รายชื่อลูกค้าพร้อมต้นทุน)
      const linkedEntries = state.entries.filter((entry) => entry.fileId === fileId);
      if (linkedEntries.some((entry) => isDateLocked(entry.date))) {
        notifyError(`ไฟล์นี้มีรายการบัญชีในงวดที่ปิดแล้ว จึงลบไม่ได้ — ${getLockedPeriodMessage()}`);
        return;
      }
      // ไฟล์ประเภทที่ไม่รู้จัก (เช่นจากรุ่นเก่า) ลบเฉพาะรายการไฟล์ออกจากรายการ
      const fileType = IMPORT_FILE_TYPES[importedFile.type];
      const keptRecords = fileType && fileType.keep
        ? state[fileType.collection].filter((record) => record.fileId === fileId && fileType.keep(record))
        : [];
      const linkedText = linkedEntries.length ? ` รวมถึงรายการในสมุดรายวัน ${formatNumber(linkedEntries.length)} รายการ` : "";
      const keptText = keptRecords.length
        ? `\n• ${formatNumber(keptRecords.length)} รายชื่อที่มีรายการบัญชีอ้างอิงอยู่จะยังคงอยู่ในทะเบียน`
        : "";
      if (!(await confirmDialog(`ยืนยันการลบไฟล์ "${importedFile.name}" และข้อมูลทั้งหมดที่นำเข้าจากไฟล์นี้${linkedText}?${keptText}`))) return;

      const changes = { importFiles: state.importFiles.filter((file) => file.id !== fileId) };
      if (linkedEntries.length) changes.entries = state.entries.filter((entry) => entry.fileId !== fileId);
      if (fileType) {
        const keptIds = new Set(keptRecords.map((record) => record.id));
        changes[fileType.collection] = state[fileType.collection]
          .filter((record) => record.fileId !== fileId || keptIds.has(record.id))
          // ที่เก็บไว้ไม่ผูกกับไฟล์แล้ว (กลายเป็นรายชื่อปกติในทะเบียน)
          .map((record) => (keptIds.has(record.id) ? (({ fileId: _fileId, ...rest }) => rest)(record) : record));
      }

      // commitChanges เปลี่ยน state ทันที → วาดใหม่ให้รายการหายไปก่อน แล้วจึงรอบันทึกบนเซิร์ฟเวอร์
      const savePromise = commitChanges(changes);
      const rerender = () => {
        onFilesChanged();
        renderImportedFileList(containerId, fileTypeFilter, onFilesChanged);
      };
      rerender();
      if (await savePromise) {
        notifySuccess("ลบไฟล์และข้อมูลที่เกี่ยวข้องเรียบร้อย");
      } else {
        rerender(); // บันทึกไม่สำเร็จ: state ถูกคืนค่าแล้ว แสดงรายการกลับมา
      }
    });
  });
}

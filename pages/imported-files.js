import { esc, fmtInt, replaceState, save, state } from "../js/data.js";
import { confirmAction, toastError, toastSuccess } from "../js/ui.js";

const FILE_TYPES = {
  customer_names: { label: "รายชื่อลูกค้า", dataKey: "customerNames" },
  customer_costs: { label: "รายชื่อลูกค้าพร้อมต้นทุน", dataKey: "customerCosts" },
  incoming_docs: { label: "เอกสารรับเข้า", dataKey: "incomingDocs" },
};

export function renderImportedFiles(containerElementId, fileTypeFilter, onFilesChanged) {
  const container = document.getElementById(containerElementId);
  if (!container) return;
  const importedFiles = state.importFiles.filter(
    (importedFile) => !fileTypeFilter || importedFile.type === fileTypeFilter,
  );
  if (!importedFiles.length) {
    container.innerHTML = '<p class="muted">ยังไม่มีไฟล์ที่นำเข้า</p>';
    return;
  }

  container.innerHTML = `<div class="card"><h3>ไฟล์ที่นำเข้า</h3><div class="table-wrap">
    <table><thead><tr><th>ชื่อไฟล์</th><th>ประเภท</th><th class="right">จำนวน</th><th>จัดการ</th></tr></thead>
    <tbody>${importedFiles.map((importedFile) => `<tr><td>${esc(importedFile.name)}</td><td>${esc(FILE_TYPES[importedFile.type]?.label || importedFile.type)}</td><td class="right">${fmtInt(importedFile.count || 0)}</td><td><button class="small danger" data-delete-import-file="${esc(importedFile.id)}">ลบไฟล์</button></td></tr>`).join("")}</tbody>
    </table></div></div>`;

  container.querySelectorAll("[data-delete-import-file]").forEach((button) => {
    button.addEventListener("click", async () => {
      const importedFileId = button.dataset.deleteImportFile;
      const importedFile = state.importFiles.find((fileRecord) => fileRecord.id === importedFileId);
      if (!importedFile) return;
      const importedFileConfig = FILE_TYPES[importedFile.type];
      if (!importedFileConfig) {
        toastError("ไม่รู้จักประเภทไฟล์นำเข้านี้");
        return;
      }
      if (!(await confirmAction(`ยืนยันการลบไฟล์ "${importedFile.name}" และข้อมูลทั้งหมดที่นำเข้าจากไฟล์นี้?`))) return;

      const previous = JSON.parse(JSON.stringify(state));
      const nextState = {
        ...state,
        [importedFileConfig.dataKey]: state[importedFileConfig.dataKey].filter((record) => record.fileId !== importedFileId),
        importFiles: state.importFiles.filter((fileRecord) => fileRecord.id !== importedFileId),
      };
      replaceState(nextState);
      if (!(await save([importedFileConfig.dataKey, "importFiles"]))) {
        replaceState(previous);
        return;
      }
      onFilesChanged();
      renderImportedFiles(containerElementId, fileTypeFilter, onFilesChanged);
      toastSuccess("ลบไฟล์และข้อมูลที่เกี่ยวข้องเรียบร้อย");
    });
  });
}

/**
 * @file หน้า "เอกสารรับเข้า" — แสดงและลบเอกสารซื้อ/ค่าใช้จ่ายที่นำเข้าจากไฟล์ Excel
 */
import { commitChanges, loadData, onDataRefresh, state } from "../../src/core/store.js";
import { notifySuccess } from "../../src/components/notifications.js";
import { confirmDialog } from "../../src/components/dialogs.js";
import { renderImportedFileList } from "../../src/components/imported-file-list.js";
import { escapeHtml, formatDate, formatMoney } from "../../src/utils/format.js";

const tableBody = document.querySelector("#incoming-docs-table tbody");

/** วาดตารางเอกสารรับเข้า */
function renderIncomingDocuments() {
  if (!state.incomingDocs.length) {
    tableBody.innerHTML = '<tr><td colspan="7" class="muted">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tableBody.innerHTML = state.incomingDocs.map((incomingDocument, rowIndex) => `<tr>
    <td>${escapeHtml(formatDate(incomingDocument.date || ""))}</td>
    <td>${escapeHtml(incomingDocument.docType || "")}</td>
    <td>${escapeHtml(incomingDocument.supplier || "")}</td>
    <td class="right">${formatMoney(incomingDocument.total)}</td>
    <td class="right">${formatMoney(incomingDocument.discount)}</td>
    <td>${escapeHtml(incomingDocument.payment || "")}</td>
    <td><button type="button" class="small danger" data-delete-row="${rowIndex}">ลบ</button></td>
  </tr>`).join("");
}

tableBody.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-row]");
  if (!deleteButton) return;
  if (!(await confirmDialog("ยืนยันการลบเอกสารนี้?"))) return;

  const rowIndex = Number(deleteButton.dataset.deleteRow);
  const isSaved = await commitChanges({
    incomingDocs: state.incomingDocs.filter((_, index) => index !== rowIndex),
  });
  renderIncomingDocuments();
  if (isSaved) notifySuccess("ลบเอกสารเรียบร้อย");
});

if (await loadData(["incomingDocs"])) {
  renderIncomingDocuments();
  renderImportedFileList("incoming-document-import-files", "incoming_docs", renderIncomingDocuments);
  onDataRefresh(renderIncomingDocuments);
}

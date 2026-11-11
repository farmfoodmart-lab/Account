import { esc, fmt, fmtDateDMY, load, replaceState, save, state } from "../../js/data.js";
import { confirmAction, toastSuccess } from "../../js/ui.js";
import { renderImportedFiles } from "../imported-files.js";

const incomingDocumentsTableBody = document.querySelector("#incoming-docs-table tbody");

function renderIncomingDocs() {
  if (!state.incomingDocs.length) {
    incomingDocumentsTableBody.innerHTML = '<tr><td colspan="7" class="muted">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  incomingDocumentsTableBody.innerHTML = state.incomingDocs.map((incomingDocument, documentIndex) => `<tr>
    <td>${esc(fmtDateDMY(incomingDocument.date || ""))}</td><td>${esc(incomingDocument.docType || "")}</td><td>${esc(incomingDocument.supplier || "")}</td>
    <td class="right">${fmt(incomingDocument.total)}</td><td class="right">${fmt(incomingDocument.discount)}</td><td>${esc(incomingDocument.payment || "")}</td>
    <td><button class="small danger" data-delete-incoming-document="${documentIndex}">ลบ</button></td></tr>`).join("");
  incomingDocumentsTableBody.querySelectorAll("[data-delete-incoming-document]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบเอกสารนี้?"))) return;
      const previousState = JSON.parse(JSON.stringify(state));
      const incomingDocs = state.incomingDocs.slice();
      incomingDocs.splice(Number(button.dataset.deleteIncomingDocument), 1);
      replaceState({ ...state, incomingDocs });
      if (!(await save(["incomingDocs"]))) {
        replaceState(previousState);
        renderIncomingDocs();
        return;
      }
      renderIncomingDocs();
      toastSuccess("ลบเอกสารเรียบร้อย");
    });
  });
}

if (await load(["incomingDocs"])) {
  renderIncomingDocs();
  renderImportedFiles("incoming-document-import-files", "incoming_docs", renderIncomingDocs);
}

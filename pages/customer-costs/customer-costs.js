/**
 * @file หน้า "ต้นทุน/ขายลูกค้า" — ข้อมูลที่นำเข้าจากไฟล์ "รายชื่อลูกค้าพร้อมต้นทุน"
 *
 * แต่ละแถวที่นำเข้าถูกลงบัญชีในสมุดรายวันแล้ว (record.entryId):
 *   Dr ลูกหนี้การค้า / Cr รายได้ (ราคาขาย) และ Dr ต้นทุนขาย / Cr สินค้าคงเหลือ (ราคาทุน)
 * ลบแถว = ลบรายการบัญชีที่ผูกไว้ด้วย
 */
import { commitChanges, loadData, onDataRefresh, state } from "../../src/core/store.js";
import { getLockedPeriodMessage, isDateLocked } from "../../src/accounting/journal.js";
import { notifyError, notifySuccess } from "../../src/components/notifications.js";
import { confirmDialog } from "../../src/components/dialogs.js";
import { renderImportedFileList } from "../../src/components/imported-file-list.js";
import { escapeHtml, formatDate, formatMoney } from "../../src/utils/format.js";
import { watchDocumentNumbers } from "../../src/components/document-number-alert.js";

const tableBody = document.querySelector("#customer-costs-table tbody");

const findEntry = (entryId) => (entryId ? state.entries.find((entry) => entry.id === entryId) : null);

/** เลขที่รายการบัญชีของแถว (ลิงก์ไปค้นหาในสมุดรายวัน) */
function renderEntryLink(record) {
  const entry = findEntry(record.entryId);
  if (!entry) return '<span class="badge">ไม่ได้ลงบัญชี</span>';
  return `<a href="../journal/journal.html?q=${encodeURIComponent(entry.docNo || "")}">${escapeHtml(entry.docNo || "ดูรายการ")}</a>`;
}

/** วาดตารางต้นทุน/ราคาขาย */
function renderCustomerCosts() {
  if (!state.customerCosts.length) {
    tableBody.innerHTML = '<tr><td colspan="6" class="muted">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tableBody.innerHTML = state.customerCosts.map((customerCost, rowIndex) => `<tr>
    <td>${escapeHtml(formatDate(customerCost.date || ""))}</td>
    <td>${escapeHtml(customerCost.name || "")}</td>
    <td class="right">${formatMoney(customerCost.cost)}</td>
    <td class="right">${formatMoney(customerCost.price)}</td>
    <td class="nowrap">${renderEntryLink(customerCost)}</td>
    <td><button type="button" class="small danger" data-delete-row="${rowIndex}">ลบ</button></td>
  </tr>`).join("");
}

// ใช้ event delegation: ผูก listener ครั้งเดียวที่ tbody แทนการผูกทุกปุ่มหลังวาดใหม่
tableBody.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-row]");
  if (!deleteButton) return;
  const rowIndex = Number(deleteButton.dataset.deleteRow);
  const record = state.customerCosts[rowIndex];
  const linkedEntry = record && findEntry(record.entryId);
  if (linkedEntry && isDateLocked(linkedEntry.date)) {
    notifyError(getLockedPeriodMessage());
    return;
  }
  const linkedText = linkedEntry ? ` และรายการบัญชี ${linkedEntry.docNo || ""}` : "";
  if (!(await confirmDialog(`ยืนยันการลบรายการนี้${linkedText}?`))) return;

  const changes = { customerCosts: state.customerCosts.filter((_, index) => index !== rowIndex) };
  if (linkedEntry) changes.entries = state.entries.filter((entry) => entry.id !== linkedEntry.id);
  const savePromise = commitChanges(changes);
  renderCustomerCosts();
  if (await savePromise) notifySuccess("ลบรายการเรียบร้อย");
  else renderCustomerCosts();
});

if (await loadData(["customerCosts", "entries"])) {
  watchDocumentNumbers();
  renderCustomerCosts();
  renderImportedFileList("customer-cost-import-files", "customer_costs", renderCustomerCosts);
  onDataRefresh(renderCustomerCosts);
}

import {
  AMOUNT_EPSILON,
  customerLabel,
  esc,
  fmt,
  fmtDateDMY,
  getCustomer,
  load,
  replaceState,
  save,
  state,
  uid,
} from "../../js/data.js";
import { confirmAction, todayIso, toast, toastError, toastSuccess } from "../../js/ui.js";
import { toIsoDate } from "../../js/reports.js";

const receivableForm = document.getElementById("receivable-form");
const submitButton = document.getElementById("receivable-submit");
const cancelButton = document.getElementById("receivable-cancel");
const tableBody = document.querySelector("#receivables-table tbody");
const receivablesSummary = document.getElementById("receivables-summary");
let editingReceivableId = null;

function resetForm() {
  editingReceivableId = null;
  receivableForm.reset();
  submitButton.textContent = "เพิ่มลูกหนี้";
  cancelButton.hidden = true;
  document.getElementById("receivable-date").value = todayIso();
  document.getElementById("receivable-paid").value = "0";
}

function renderCustomerOptions() {
  const customerSelect = document.getElementById("receivable-customer");
  const selectedCustomerId = customerSelect.value;
  customerSelect.innerHTML = '<option value="">-- เลือกลูกค้า --</option>' +
    state.customers.map((customer) =>
      `<option value="${esc(customer.id)}">${esc(customerLabel(customer))}</option>`,
    ).join("");
  if (selectedCustomerId) customerSelect.value = selectedCustomerId;
}

function renderReceivables() {
  const currentDate = todayIso();
  const total = state.receivables.reduce((sum, receivable) => sum + (Number(receivable.amount) || 0), 0);
  const paid = state.receivables.reduce((sum, receivable) => sum + (Number(receivable.paid) || 0), 0);
  const outstanding = Math.max(0, total - paid);
  receivablesSummary.innerHTML = `<div class="stat"><div class="muted">ยอดลูกหนี้รวม</div><div class="stat-value">${fmt(total)}</div></div>
    <div class="stat"><div class="muted">รับชำระแล้ว</div><div class="stat-value">${fmt(paid)}</div></div>
    <div class="stat"><div class="muted">คงค้าง</div><div class="stat-value ${outstanding > 0 ? "unbalanced" : "balanced"}">${fmt(outstanding)}</div></div>`;

  if (!state.receivables.length) {
    tableBody.innerHTML = '<tr><td colspan="9" class="muted">ยังไม่มีรายการลูกหนี้</td></tr>';
    return;
  }
  tableBody.innerHTML = state.receivables.slice().reverse().map((receivable) => {
    const customer = getCustomer(receivable.customerId);
    const amount = Number(receivable.amount) || 0;
    const paidAmount = Number(receivable.paid) || 0;
    const remaining = Math.max(0, amount - paidAmount);
    let status = "คงค้าง";
    let statusClass = "unbalanced";
    if (remaining <= AMOUNT_EPSILON) {
      status = "ชำระแล้ว";
      statusClass = "balanced";
    } else if (receivable.due && receivable.due < currentDate) {
      status = "เกินกำหนด";
    }
    return `<tr><td>${esc(customer ? customerLabel(customer) : "-")}</td><td>${esc(receivable.docNo)}</td>
      <td>${esc(fmtDateDMY(receivable.date))}</td><td>${esc(receivable.due ? fmtDateDMY(receivable.due) : "-")}</td>
      <td class="right">${fmt(amount)}</td><td class="right">${fmt(paidAmount)}</td><td class="right">${fmt(remaining)}</td>
      <td class="${statusClass}">${status}</td><td class="actions-cell"><button class="small secondary" data-edit-receivable="${esc(receivable.id)}">แก้ไข</button><button class="small danger" data-delete-receivable="${esc(receivable.id)}">ลบ</button></td></tr>`;
  }).join("");

  tableBody.querySelectorAll("[data-edit-receivable]").forEach((button) => {
    button.addEventListener("click", () => {
      const receivable = state.receivables.find((item) => item.id === button.dataset.editReceivable);
      if (!receivable) return;
      renderCustomerOptions();
      editingReceivableId = receivable.id;
      document.getElementById("receivable-customer").value = receivable.customerId || "";
      document.getElementById("receivable-document-number").value = receivable.docNo || "";
      document.getElementById("receivable-date").value = toIsoDate(receivable.date) || "";
      document.getElementById("receivable-due-date").value = toIsoDate(receivable.due) || "";
      document.getElementById("receivable-amount").value = receivable.amount || 0;
      document.getElementById("receivable-paid").value = receivable.paid || 0;
      document.getElementById("receivable-note").value = receivable.note || "";
      submitButton.textContent = "บันทึกการแก้ไข";
      cancelButton.hidden = false;
      document.getElementById("receivable-document-number").focus();
    });
  });

  tableBody.querySelectorAll("[data-delete-receivable]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบรายการลูกหนี้นี้?"))) return;
      const receivableId = button.dataset.deleteReceivable;
      const previousState = JSON.parse(JSON.stringify(state));
      replaceState({ ...state, receivables: state.receivables.filter((receivable) => receivable.id !== receivableId) });
      if (!(await save(["receivables"]))) {
        replaceState(previousState);
        renderReceivables();
        return;
      }
      if (editingReceivableId === receivableId) resetForm();
      renderReceivables();
      toastSuccess("ลบรายการลูกหนี้เรียบร้อย");
    });
  });
}

cancelButton.addEventListener("click", () => {
  resetForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

receivableForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    customerId: document.getElementById("receivable-customer").value,
    docNo: document.getElementById("receivable-document-number").value.trim(),
    date: document.getElementById("receivable-date").value,
    due: document.getElementById("receivable-due-date").value,
    amount: parseFloat(document.getElementById("receivable-amount").value) || 0,
    paid: parseFloat(document.getElementById("receivable-paid").value) || 0,
    note: document.getElementById("receivable-note").value.trim(),
  };
  if (!payload.customerId) return toastError("เลือกลูกค้าก่อน");
  if (!payload.docNo || !payload.date) return toastError("กรอกเลขที่เอกสารและวันที่ให้ครบ");
  if (payload.amount <= 0) return toastError("จำนวนเงินต้องมากกว่า 0");

  const previousState = JSON.parse(JSON.stringify(state));
  const receivables = state.receivables.slice();
  const isEdit = Boolean(editingReceivableId);
  if (isEdit) {
    const existingReceivable = receivables.find((receivable) => receivable.id === editingReceivableId);
    if (!existingReceivable) return resetForm();
    Object.assign(existingReceivable, payload);
  } else {
    receivables.push({ id: uid(), ...payload });
  }
  receivables.sort((earlierReceivable, laterReceivable) => (earlierReceivable.date || "").localeCompare(laterReceivable.date || ""));
  replaceState({ ...state, receivables });
  if (!(await save(["receivables"]))) {
    replaceState(previousState);
    renderReceivables();
    return;
  }
  resetForm();
  renderReceivables();
  toastSuccess(isEdit ? "แก้ไขรายการลูกหนี้เรียบร้อย" : "เพิ่มรายการลูกหนี้เรียบร้อย");
});

if (await load(["customers", "receivables"])) {
  renderCustomerOptions();
  resetForm();
  renderReceivables();
}

import {
  customerLabel,
  esc,
  getAccount,
  getCustomer,
  load,
  replaceState,
  save,
  state,
  uid, onDataRefresh
} from "../../js/data.js";
import { confirmAction, toast, toastError, toastSuccess } from "../../js/ui.js";

const autoDescriptionForm = document.getElementById("auto-description-form");
const submitButton = document.getElementById("auto-description-submit");
const cancelButton = document.getElementById("auto-description-cancel");
const tableBody = document.querySelector("#auto-description-table tbody");
let editingRuleId = null;

function accountOptions(selectedId = "") {
  return '<option value="">-- เลือกบัญชี --</option>' + state.accounts
    .map((account) => `<option value="${esc(account.id)}" ${account.id === selectedId ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`)
    .join("");
}

function customerOptions(selectedValue = "") {
  let html = "";
  state.customers.forEach((customer) => {
    html += `<option value="id:${esc(customer.id)}">${esc(customerLabel(customer))}</option>`;
  });
  state.customerNames.forEach((row) => {
    const name = (row.name || "").trim();
    if (!name || state.customers.some((customer) => (customer.name || "").trim() === name)) return;
    html += `<option value="name:${esc(name)}">${esc(name)}</option>`;
  });
  const customerSelect = document.getElementById("auto-description-customer");
  customerSelect.innerHTML = '<option value="">-- เลือกลูกค้า --</option>' + html;
  if (selectedValue) customerSelect.value = selectedValue;
}

function resolveCustomer(rawValue) {
  if (rawValue.startsWith("id:")) {
    const customerId = rawValue.slice(3);
    const customer = state.customers.find((item) => item.id === customerId);
    return { customerId, customerName: customer ? customerLabel(customer) : "" };
  }
  if (rawValue.startsWith("name:")) return { customerId: "", customerName: rawValue.slice(5) };
  return { customerId: "", customerName: "" };
}

function resetForm() {
  editingRuleId = null;
  autoDescriptionForm.reset();
  submitButton.textContent = "เพิ่มคำอธิบาย";
  cancelButton.hidden = true;
}

function ruleCustomerLabel(rule) {
  if (rule.customerId) {
    const customer = getCustomer(rule.customerId);
    if (customer) return customerLabel(customer);
  }
  return rule.customerName || "-";
}

function renderAutoDesc() {
  const currentCustomer = document.getElementById("auto-description-customer").value;
  const debitValue = document.getElementById("auto-description-debit-account").value;
  const creditValue = document.getElementById("auto-description-credit-account").value;
  customerOptions(currentCustomer);
  document.getElementById("auto-description-debit-account").innerHTML = accountOptions(debitValue);
  document.getElementById("auto-description-credit-account").innerHTML = accountOptions(creditValue);

  tableBody.innerHTML = state.autoDesc.length
    ? state.autoDesc.map((rule) => {
      const debit = getAccount(rule.debitAccountId);
      const credit = getAccount(rule.creditAccountId);
      return `<tr><td>${esc(ruleCustomerLabel(rule))}</td><td>${debit ? `${esc(debit.code)} - ${esc(debit.name)}` : '<span class="unbalanced">(ไม่พบบัญชี)</span>'}</td>
        <td>${credit ? `${esc(credit.code)} - ${esc(credit.name)}` : '<span class="unbalanced">(ไม่พบบัญชี)</span>'}</td><td>${esc(rule.text || "")}</td>
        <td class="actions-cell"><button class="small secondary" data-edit-auto-description="${esc(rule.id)}">แก้ไข</button><button class="small danger" data-delete-auto-description="${esc(rule.id)}">ลบ</button></td></tr>`;
    }).join("")
    : '<tr><td colspan="5" class="muted">ยังไม่มีคำอธิบายอัตโนมัติ</td></tr>';

  tableBody.querySelectorAll("[data-edit-auto-description]").forEach((button) => {
    button.addEventListener("click", () => {
      const rule = state.autoDesc.find((existingRule) => existingRule.id === button.dataset.editAutoDescription);
      if (!rule) return;
      editingRuleId = rule.id;
      const selectedCustomer = rule.customerId ? `id:${rule.customerId}` : `name:${rule.customerName || ""}`;
      customerOptions(selectedCustomer);
      document.getElementById("auto-description-debit-account").value = rule.debitAccountId || "";
      document.getElementById("auto-description-credit-account").value = rule.creditAccountId || "";
      document.getElementById("auto-description-text").value = rule.text || "";
      submitButton.textContent = "บันทึกการแก้ไข";
      cancelButton.hidden = false;
      document.getElementById("auto-description-customer").focus();
    });
  });

  tableBody.querySelectorAll("[data-delete-auto-description]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบคำอธิบายอัตโนมัตินี้?"))) return;
      const ruleId = button.dataset.deleteAutoDescription;
      const previousState = JSON.parse(JSON.stringify(state));
      replaceState({ ...state, autoDesc: state.autoDesc.filter((rule) => rule.id !== ruleId) });
      if (!(await save(["autoDesc"]))) {
        replaceState(previousState);
        renderAutoDesc();
        return;
      }
      if (editingRuleId === ruleId) resetForm();
      renderAutoDesc();
      toastSuccess("ลบคำอธิบายอัตโนมัติเรียบร้อย");
    });
  });
}

cancelButton.addEventListener("click", () => {
  resetForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

autoDescriptionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rawCustomer = document.getElementById("auto-description-customer").value;
  const debitAccountId = document.getElementById("auto-description-debit-account").value;
  const creditAccountId = document.getElementById("auto-description-credit-account").value;
  const text = document.getElementById("auto-description-text").value.trim();
  if (!rawCustomer || !debitAccountId || !creditAccountId || !text) {
    toastError("กรอกข้อมูลให้ครบก่อนบันทึก");
    return;
  }
  const { customerId, customerName } = resolveCustomer(rawCustomer);
  const previousState = JSON.parse(JSON.stringify(state));
  const autoDesc = state.autoDesc.slice();
  const isEdit = Boolean(editingRuleId);
  const payload = { debitAccountId, creditAccountId, text };
  if (customerId) payload.customerId = customerId;
  if (customerName) payload.customerName = customerName;
  if (isEdit) {
    const rule = autoDesc.find((existingRule) => existingRule.id === editingRuleId);
    if (!rule) return resetForm();
    delete rule.customerId;
    delete rule.customerName;
    delete rule.keyword;
    Object.assign(rule, payload);
  } else {
    autoDesc.push({ id: uid(), ...payload });
  }
  replaceState({ ...state, autoDesc });
  if (!(await save(["autoDesc"]))) {
    replaceState(previousState);
    renderAutoDesc();
    return;
  }
  resetForm();
  renderAutoDesc();
  toastSuccess(isEdit ? "แก้ไขคำอธิบายอัตโนมัติเรียบร้อย" : "เพิ่มคำอธิบายอัตโนมัติเรียบร้อย");
});

if (await load(["autoDesc", "accounts", "customers", "customerNames"])) {
  renderAutoDesc();
  onDataRefresh(renderAutoDesc);
}

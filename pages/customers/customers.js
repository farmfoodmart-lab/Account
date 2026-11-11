import { esc, load, replaceState, save, state, uid } from "../../js/data.js";
import { confirmAction, toast, toastError, toastSuccess } from "../../js/ui.js";
import { renderImportedFiles } from "../imported-files.js";

const customerForm = document.getElementById("customer-form");
const customerSubmit = document.getElementById("customer-submit");
const customerCancel = document.getElementById("customer-cancel");
const customerBody = document.querySelector("#customers-table tbody");
const customerNameForm = document.getElementById("customer-name-form");
const customerNameSubmit = document.getElementById("customer-name-submit");
const customerNameCancel = document.getElementById("customer-name-cancel");
const customerNameTableBody = document.querySelector("#customer-names-table tbody");
let editingCustomerId = null;
let editingNameIndex = null;

function resetCustomerForm() {
  editingCustomerId = null;
  customerForm.reset();
  customerSubmit.textContent = "เพิ่มลูกค้า";
  customerCancel.hidden = true;
}

function resetNameForm() {
  editingNameIndex = null;
  customerNameForm.reset();
  customerNameSubmit.textContent = "เพิ่มชื่อ";
  customerNameCancel.hidden = true;
}

function renderCustomers() {
  customerBody.innerHTML = state.customers.length
    ? state.customers.map((customer) => `<tr>
        <td>${esc(customer.code)}</td><td>${esc(customer.name)}</td><td>${esc(customer.phone)}</td>
        <td>${esc(customer.tax)}</td><td>${esc(customer.address)}</td>
        <td class="actions-cell"><button class="small secondary" data-edit-customer="${esc(customer.id)}">แก้ไข</button><button class="small danger" data-delete-customer="${esc(customer.id)}">ลบ</button></td>
      </tr>`).join("")
    : '<tr><td colspan="6" class="muted">ยังไม่มีลูกค้า</td></tr>';

  customerBody.querySelectorAll("[data-edit-customer]").forEach((button) => {
    button.addEventListener("click", () => {
      const customer = state.customers.find((existingCustomer) => existingCustomer.id === button.dataset.editCustomer);
      if (!customer) return;
      editingCustomerId = customer.id;
      document.getElementById("customer-code").value = customer.code || "";
      document.getElementById("customer-name").value = customer.name || "";
      document.getElementById("customer-phone").value = customer.phone || "";
      document.getElementById("customer-tax-id").value = customer.tax || "";
      document.getElementById("customer-address").value = customer.address || "";
      customerSubmit.textContent = "บันทึกการแก้ไข";
      customerCancel.hidden = false;
      document.getElementById("customer-code").focus();
    });
  });

  customerBody.querySelectorAll("[data-delete-customer]").forEach((button) => {
    button.addEventListener("click", async () => {
      const customerId = button.dataset.deleteCustomer;
      if (state.receivables.some((receivable) => receivable.customerId === customerId)) {
        toastError("ลูกค้ารายนี้มีรายการลูกหนี้อยู่ ลบไม่ได้");
        return;
      }
      if (!(await confirmAction("ยืนยันการลบลูกค้านี้?"))) return;
      const previousState = JSON.parse(JSON.stringify(state));
      replaceState({ ...state, customers: state.customers.filter((customer) => customer.id !== customerId) });
      if (!(await save(["customers"]))) {
        replaceState(previousState);
        renderCustomers();
        return;
      }
      if (editingCustomerId === customerId) resetCustomerForm();
      renderCustomers();
      toastSuccess("ลบลูกค้าเรียบร้อย");
    });
  });
}

function renderCustomerNames() {
  customerNameTableBody.innerHTML = state.customerNames.length
    ? state.customerNames.map((customerNameRecord, nameIndex) => `<tr><td>${esc(customerNameRecord.name || "")}</td><td class="actions-cell"><button class="small secondary" data-edit-customer-name="${nameIndex}">แก้ไข</button><button class="small danger" data-delete-customer-name="${nameIndex}">ลบ</button></td></tr>`).join("")
    : '<tr><td colspan="2" class="muted">ยังไม่มีรายชื่อจากไฟล์</td></tr>';

  customerNameTableBody.querySelectorAll("[data-edit-customer-name]").forEach((button) => {
    button.addEventListener("click", () => {
      const nameIndex = Number(button.dataset.editCustomerName);
      const customerNameRecord = state.customerNames[nameIndex];
      if (!customerNameRecord) return;
      editingNameIndex = nameIndex;
      document.getElementById("customer-name-input").value = customerNameRecord.name || "";
      customerNameSubmit.textContent = "บันทึกการแก้ไข";
      customerNameCancel.hidden = false;
      document.getElementById("customer-name-input").focus();
    });
  });

  customerNameTableBody.querySelectorAll("[data-delete-customer-name]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบรายชื่อลูกค้านี้?"))) return;
      const nameIndex = Number(button.dataset.deleteCustomerName);
      const nextNames = state.customerNames.slice();
      nextNames.splice(nameIndex, 1);
      const previousState = JSON.parse(JSON.stringify(state));
      replaceState({ ...state, customerNames: nextNames });
      if (!(await save(["customerNames"]))) {
        replaceState(previousState);
        renderCustomerNames();
        return;
      }
      if (editingNameIndex === nameIndex) resetNameForm();
      else if (editingNameIndex > nameIndex) editingNameIndex -= 1;
      renderCustomerNames();
      toastSuccess("ลบรายชื่อลูกค้าเรียบร้อย");
    });
  });
}

customerCancel.addEventListener("click", () => {
  resetCustomerForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});
customerNameCancel.addEventListener("click", () => {
  resetNameForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

customerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    code: document.getElementById("customer-code").value.trim(),
    name: document.getElementById("customer-name").value.trim(),
    phone: document.getElementById("customer-phone").value.trim(),
    tax: document.getElementById("customer-tax-id").value.trim(),
    address: document.getElementById("customer-address").value.trim(),
  };
  if (!payload.code || !payload.name) return;
  if (state.customers.some((customer) => customer.code === payload.code && customer.id !== editingCustomerId)) {
    toastError(`รหัสลูกค้า ${payload.code} มีอยู่แล้ว`);
    return;
  }
  const previousState = JSON.parse(JSON.stringify(state));
  const isEdit = Boolean(editingCustomerId);
  const customers = state.customers.slice();
  if (isEdit) {
    const customer = customers.find((existingCustomer) => existingCustomer.id === editingCustomerId);
    if (!customer) return resetCustomerForm();
    Object.assign(customer, payload);
  } else {
    customers.push({ id: uid(), ...payload });
  }
  customers.sort((leftCustomer, rightCustomer) => (leftCustomer.code || "").localeCompare(rightCustomer.code || ""));
  replaceState({ ...state, customers });
  if (!(await save(["customers"]))) {
    replaceState(previousState);
    renderCustomers();
    return;
  }
  resetCustomerForm();
  renderCustomers();
  toastSuccess(isEdit ? "แก้ไขข้อมูลลูกค้าเรียบร้อย" : "เพิ่มลูกค้าเรียบร้อย");
});

customerNameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const customerName = document.getElementById("customer-name-input").value.trim();
  if (!customerName) return;
  const previousState = JSON.parse(JSON.stringify(state));
  const names = state.customerNames.slice();
  const isEdit = editingNameIndex != null && Boolean(names[editingNameIndex]);
  if (isEdit) names[editingNameIndex] = { ...names[editingNameIndex], name: customerName };
  else names.push({ name: customerName, fileId: null });
  replaceState({ ...state, customerNames: names });
  if (!(await save(["customerNames"]))) {
    replaceState(previousState);
    renderCustomerNames();
    return;
  }
  resetNameForm();
  renderCustomerNames();
  toastSuccess(isEdit ? "แก้ไขรายชื่อลูกค้าเรียบร้อย" : "เพิ่มรายชื่อลูกค้าเรียบร้อย");
});

if (await load(["customers", "receivables", "customerNames"])) {
  renderCustomers();
  renderCustomerNames();
  renderImportedFiles("customer-name-import-files", "customer_names", renderCustomerNames);
}

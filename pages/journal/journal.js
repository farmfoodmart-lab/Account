import {
  AMOUNT_EPSILON,
  customerLabel,
  entryTotal,
  esc,
  fmt,
  fmtDateDMY,
  fmtInt,
  getAccount,
  load,
  replaceState,
  save,
  state,
  uid,
} from "../../js/data.js";
import {
  confirmAction,
  downloadCsvFile,
  fileStamp,
  todayIso,
  toast,
  toastError,
  toastSuccess,
} from "../../js/ui.js";
import { toCsv } from "../../js/csv.js";
import { toIsoDate } from "../../js/reports.js";

const linesElement = document.getElementById("journal-entry-lines");
const journalEntryForm = document.getElementById("journal-entry-form");
const submitButton = document.getElementById("journal-entry-submit");
const cancelButton = document.getElementById("journal-entry-cancel");
const errorElement = document.getElementById("journal-entry-error");
const filters = { from: "", to: "", text: "" };
let editingEntryId = null;

function accountOptions(selectedId = "") {
  return '<option value="">-- เลือกบัญชี --</option>' + state.accounts
    .map((account) => `<option value="${esc(account.id)}" ${account.id === selectedId ? "selected" : ""}>${esc(account.code)} - ${esc(account.name)}</option>`)
    .join("");
}

function customerOptionGroups() {
  let html = "";
  state.customers.forEach((customer) => {
    const label = customerLabel(customer);
    if (label) html += `<option value="id:${esc(customer.id)}">${esc(label)}</option>`;
  });
  state.customerNames.forEach((row) => {
    const name = (row.name || "").trim();
    if (!name || state.customers.some((customer) => (customer.name || "").trim() === name)) return;
    html += `<option value="name:${esc(name)}">${esc(name)}</option>`;
  });
  return html;
}

function renderCustomerOptions() {
  const select = document.getElementById("journal-entry-customer");
  const current = select.value;
  select.innerHTML = '<option value="">-- ไม่ระบุ --</option>' + customerOptionGroups();
  if (current) select.value = current;
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

function updateTotals() {
  let debit = 0;
  let credit = 0;
  linesElement.querySelectorAll(".je-line").forEach((row) => {
    debit += parseFloat(row.querySelector(".je-debit").value) || 0;
    credit += parseFloat(row.querySelector(".je-credit").value) || 0;
  });
  const debitElement = document.getElementById("total-debit");
  const creditElement = document.getElementById("total-credit");
  debitElement.textContent = fmt(debit);
  creditElement.textContent = fmt(credit);
  const balanced = Math.abs(debit - credit) < AMOUNT_EPSILON && debit > 0;
  debitElement.className = balanced ? "balanced" : "unbalanced";
  creditElement.className = balanced ? "balanced" : "unbalanced";
  return balanced;
}

function addLine(data = {}) {
  const row = document.createElement("div");
  row.className = "je-line";
  row.innerHTML = `<select class="je-account" required>${accountOptions(data.accountId)}</select>
    <input type="number" class="je-debit" placeholder="เดบิต" min="0" step="0.01" value="${data.debit || ""}">
    <input type="number" class="je-credit" placeholder="เครดิต" min="0" step="0.01" value="${data.credit || ""}">
    <button type="button" class="small danger je-remove" title="ลบบรรทัด">&times;</button>`;
  row.querySelector(".je-remove").addEventListener("click", () => {
    if (linesElement.children.length <= 2) {
      toastError("ต้องมีอย่างน้อย 2 บรรทัด");
      return;
    }
    row.remove();
    updateTotals();
  });
  row.querySelectorAll("input").forEach((input) => input.addEventListener("input", updateTotals));
  linesElement.appendChild(row);
}

function resetLines(lines) {
  linesElement.innerHTML = "";
  if (Array.isArray(lines) && lines.length) {
    lines.forEach((line) => addLine(line));
    if (lines.length < 2) addLine();
  } else {
    addLine();
    addLine();
  }
  updateTotals();
}

function resetForm() {
  editingEntryId = null;
  document.getElementById("journal-entry-date").value = todayIso();
  document.getElementById("journal-entry-description").value = "";
  document.getElementById("journal-entry-customer").value = "";
  errorElement.textContent = "";
  submitButton.textContent = "บันทึก";
  cancelButton.hidden = true;
  resetLines();
}

function applyAutoDescription(value) {
  if (!value) return;
  const { customerId, customerName } = resolveCustomer(value);
  const rule = state.autoDesc.find((item) =>
    (customerId && item.customerId === customerId) ||
    (customerName && item.customerName === customerName),
  );
  if (!rule) return;
  document.getElementById("journal-entry-description").value = rule.text || "";
  const rows = linesElement.querySelectorAll(".je-line");
  if (rows[0] && rule.debitAccountId) rows[0].querySelector(".je-account").value = rule.debitAccountId;
  if (rows[1] && rule.creditAccountId) rows[1].querySelector(".je-account").value = rule.creditAccountId;
  toast("เติมข้อมูลจากคำอธิบายอัตโนมัติแล้ว");
}

function visibleEntries() {
  return state.entries.filter((entry) => {
    if (filters.from || filters.to) {
      const date = toIsoDate(entry.date);
      if (!date || (filters.from && date < filters.from) || (filters.to && date > filters.to)) return false;
    }
    if (!filters.text) return true;
    const needle = filters.text.toLowerCase();
    const haystack = [
      entry.desc,
      entry.customerName,
      ...entry.lines.map((line) => {
        const account = getAccount(line.accountId);
        return account ? `${account.code} ${account.name}` : "";
      }),
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

function renderJournal() {
  const list = document.getElementById("journal-list");
  const entries = visibleEntries();
  const totalDebit = entries.reduce((total, entry) => total + entryTotal(entry), 0);
  const filtered = filters.from || filters.to || filters.text;
  document.getElementById("je-filter-summary").textContent = filtered
    ? `แสดง ${fmtInt(entries.length)} จาก ${fmtInt(state.entries.length)} รายการ · ยอดรวม ${fmt(totalDebit)}`
    : `ทั้งหมด ${fmtInt(entries.length)} รายการ · ยอดรวม ${fmt(totalDebit)}`;
  if (!state.entries.length) {
    list.innerHTML = '<p class="empty-state">ยังไม่มีรายการบันทึก</p>';
    return;
  }
  if (!entries.length) {
    list.innerHTML = '<p class="empty-state">ไม่มีรายการที่ตรงกับตัวกรอง</p>';
    return;
  }
  list.innerHTML = entries.slice().reverse().map((entry) => {
    const dateText = fmtDateDMY(entry.date);
    const customer = entry.customerName ? ` · ${esc(entry.customerName)}` : "";
    const rows = entry.lines.map((line, index) => {
      const account = getAccount(line.accountId);
      return `<tr><td>${index === 0 ? dateText : ""}</td><td>${account ? `${esc(account.code)} ${esc(account.name)}` : '<span class="unbalanced">(บัญชีถูกลบ)</span>'}</td><td class="right">${line.debit ? fmt(line.debit) : ""}</td><td class="right">${line.credit ? fmt(line.credit) : ""}</td></tr>`;
    }).join("");
    return `<article class="entry"><div class="entry-header"><div class="entry-title"><span>${dateText || "ไม่ระบุวันที่"}${customer}</span><span class="entry-meta">${esc(entry.desc || "(ไม่มีคำอธิบาย)")}</span></div>
      <div class="actions-cell"><button class="small secondary" data-edit-entry="${esc(entry.id)}">แก้ไข</button><button class="small danger" data-delete-entry="${esc(entry.id)}">ลบ</button></div></div>
      <table><thead><tr><th>วันที่</th><th>บัญชี</th><th class="right">เดบิต</th><th class="right">เครดิต</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="entry-footer"><span class="entry-desc">${entry.lines.length} บรรทัด${entry.customerId ? " · มีข้อมูลลูกค้า" : ""}</span><span class="entry-total">ยอดรวม ${fmt(entryTotal(entry))}</span></div></article>`;
  }).join("");

  list.querySelectorAll("[data-edit-entry]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.entries.find((item) => item.id === button.dataset.editEntry);
      if (!entry) return;
      editingEntryId = entry.id;
      document.getElementById("journal-entry-date").value = toIsoDate(entry.date) || entry.date || "";
      document.getElementById("journal-entry-description").value = entry.desc || "";
      renderCustomerOptions();
      const customerSelect = document.getElementById("journal-entry-customer");
      customerSelect.value = entry.customerId ? `id:${entry.customerId}` : entry.customerName ? `name:${entry.customerName}` : "";
      resetLines(entry.lines);
      submitButton.textContent = "บันทึกการแก้ไข";
      cancelButton.hidden = false;
      journalEntryForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  list.querySelectorAll("[data-delete-entry]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบรายการบันทึกนี้?"))) return;
      const entryId = button.dataset.deleteEntry;
      const previous = JSON.parse(JSON.stringify(state));
      replaceState({ ...state, entries: state.entries.filter((entry) => entry.id !== entryId) });
      if (!(await save(["entries"]))) {
        replaceState(previous);
        renderJournal();
        return;
      }
      if (editingEntryId === entryId) resetForm();
      renderJournal();
      toastSuccess("ลบรายการบันทึกเรียบร้อย");
    });
  });
}

document.getElementById("add-line").addEventListener("click", () => addLine());
document.getElementById("journal-entry-customer").addEventListener("change", (event) => applyAutoDescription(event.target.value));
cancelButton.addEventListener("click", () => {
  resetForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

journalEntryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorElement.textContent = "";
  if (!updateTotals()) {
    errorElement.textContent = "ยอดเดบิตและเครดิตต้องเท่ากันและมากกว่า 0";
    return;
  }
  const lines = [];
  for (const row of linesElement.querySelectorAll(".je-line")) {
    const accountId = row.querySelector(".je-account").value;
    const debit = parseFloat(row.querySelector(".je-debit").value) || 0;
    const credit = parseFloat(row.querySelector(".je-credit").value) || 0;
    if (!accountId || (!debit && !credit)) continue;
    if (debit > 0 && credit > 0) {
      errorElement.textContent = "แต่ละบรรทัดใส่ได้เฉพาะเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง";
      return;
    }
    lines.push({ accountId, debit, credit });
  }
  if (lines.length < 2) {
    errorElement.textContent = "ต้องมีอย่างน้อย 2 บรรทัด";
    return;
  }

  const { customerId, customerName } = resolveCustomer(document.getElementById("journal-entry-customer").value);
  const payload = {
    date: document.getElementById("journal-entry-date").value,
    desc: document.getElementById("journal-entry-description").value.trim(),
    lines,
  };
  if (customerId) payload.customerId = customerId;
  if (customerName) payload.customerName = customerName;
  const previous = JSON.parse(JSON.stringify(state));
  const entries = state.entries.slice();
  const isEdit = Boolean(editingEntryId);
  if (isEdit) {
    const entry = entries.find((existingEntry) => existingEntry.id === editingEntryId);
    if (!entry) return resetForm();
    delete entry.customerId;
    delete entry.customerName;
    Object.assign(entry, payload);
  } else {
    entries.push({ id: uid(), ...payload });
  }
  entries.sort((earlierEntry, laterEntry) => (earlierEntry.date || "").localeCompare(laterEntry.date || "") || earlierEntry.id.localeCompare(laterEntry.id));
  replaceState({ ...state, entries });
  if (!(await save(["entries"]))) {
    replaceState(previous);
    renderJournal();
    return;
  }
  resetForm();
  renderJournal();
  toastSuccess(isEdit ? "แก้ไขรายการบันทึกเรียบร้อย" : "บันทึกรายการเรียบร้อย");
});

function applyFilters() {
  filters.from = document.getElementById("journal-entry-filter-start-date").value;
  filters.to = document.getElementById("journal-entry-filter-end-date").value;
  filters.text = document.getElementById("journal-entry-filter-text").value.trim();
  renderJournal();
}
document.getElementById("journal-entry-filter-start-date").addEventListener("change", applyFilters);
document.getElementById("journal-entry-filter-end-date").addEventListener("change", applyFilters);
document.getElementById("journal-entry-filter-text").addEventListener("input", applyFilters);
document.getElementById("journal-entry-filter-clear").addEventListener("click", () => {
  document.getElementById("journal-entry-filter-start-date").value = "";
  document.getElementById("journal-entry-filter-end-date").value = "";
  document.getElementById("journal-entry-filter-text").value = "";
  applyFilters();
});
document.getElementById("journal-entry-export").addEventListener("click", () => {
  const entries = visibleEntries();
  if (!entries.length) return toastError("ไม่มีรายการให้ส่งออก");
  const rows = [];
  entries.forEach((entry) => entry.lines.forEach((line) => {
    const account = getAccount(line.accountId);
    rows.push([fmtDateDMY(entry.date), entry.desc || "", entry.customerName || "", account?.code || "", account?.name || "(บัญชีถูกลบ)", Number(line.debit) || 0, Number(line.credit) || 0]);
  }));
  downloadCsvFile(`journal-${fileStamp()}.csv`, toCsv(["วันที่", "คำอธิบาย", "ลูกค้า", "รหัสบัญชี", "ชื่อบัญชี", "เดบิต", "เครดิต"], rows));
  toastSuccess(`ส่งออก ${fmtInt(entries.length)} รายการ`);
});

if (await load(["entries", "accounts", "customers", "customerNames", "autoDesc"])) {
  renderCustomerOptions();
  resetForm();
  renderJournal();
}

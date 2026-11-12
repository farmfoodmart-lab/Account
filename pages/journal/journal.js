import {
  AMOUNT_EPSILON,
  ENTRY_KINDS,
  accountOptionsHtml,
  customerLabel,
  entryKind,
  entryTotal,
  esc,
  fmt,
  fmtDateDMY,
  fmtInt,
  getAccount,
  isLocked,
  load,
  lockMessage,
  nextDocNo,
  nextSeqNo,
  onDataRefresh,
  replaceState,
  save,
  state,
  uid,
} from "../../js/data.js";
import {
  confirmAction,
  debounce,
  downloadCsvFile,
  fileStamp,
  todayIso,
  toast,
  toastError,
  toastSuccess,
} from "../../js/ui.js";
import { toCsv } from "../../js/csv.js";
import { toIsoDate } from "../../js/reports.js";
import { SOURCE_LABELS } from "../../js/posting.js";

const PAGE_SIZE = 40;

const $ = (id) => document.getElementById(id);
const linesElement = $("journal-entry-lines");
const journalEntryForm = $("journal-entry-form");
const submitButton = $("journal-entry-submit");
const cancelButton = $("journal-entry-cancel");
const errorElement = $("journal-entry-error");
const dateInput = $("journal-entry-date");
const docNoInput = $("journal-entry-docno");
const kindSelect = $("journal-entry-kind");
const customerSelect = $("journal-entry-customer");
const descInput = $("journal-entry-description");
const balanceBar = $("journal-balance");

const filters = { from: "", to: "", text: "", kind: "" };
let editingEntryId = null;
let docNoTouched = false;
let formDirty = false;
let visibleLimit = PAGE_SIZE;
let cachedAccountOptions = "";

/* ---------- customers ---------- */
function customerOptionGroups() {
  let html = "";
  state.customers.forEach((customer) => {
    const label = customerLabel(customer);
    if (label) html += `<option value="id:${esc(customer.id)}">${esc(label)}</option>`;
  });
  const registered = new Set(state.customers.map((customer) => (customer.name || "").trim()));
  const seen = new Set();
  state.customerNames.forEach((row) => {
    const name = (row.name || "").trim();
    if (!name || registered.has(name) || seen.has(name)) return;
    seen.add(name);
    html += `<option value="name:${esc(name)}">${esc(name)}</option>`;
  });
  return html;
}

function renderCustomerOptions() {
  const current = customerSelect.value;
  customerSelect.innerHTML = '<option value="">-- ไม่ระบุ --</option>' + customerOptionGroups();
  if (current) customerSelect.value = current;
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

/* ---------- entry lines ---------- */
function readAmount(input) {
  const value = parseFloat(input.value);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function lineRows() {
  return [...linesElement.querySelectorAll(".je-line")];
}

function renumberLines() {
  lineRows().forEach((row, index) => {
    row.querySelector(".je-no").textContent = String(index + 1);
  });
}

function updateTotals() {
  let debit = 0;
  let credit = 0;
  let filledLines = 0;
  lineRows().forEach((row) => {
    const lineDebit = readAmount(row.querySelector(".je-debit"));
    const lineCredit = readAmount(row.querySelector(".je-credit"));
    debit += lineDebit;
    credit += lineCredit;
    if (lineDebit || lineCredit) filledLines += 1;
    row.classList.toggle("is-credit", lineCredit > 0 && !lineDebit);
  });
  const debitElement = $("total-debit");
  const creditElement = $("total-credit");
  debitElement.textContent = fmt(debit);
  creditElement.textContent = fmt(credit);
  const difference = Math.round((debit - credit) * 100) / 100;
  const balanced = Math.abs(difference) < AMOUNT_EPSILON && debit > 0;
  debitElement.className = `right ${balanced ? "balanced" : debit || credit ? "unbalanced" : ""}`;
  creditElement.className = debitElement.className;

  if (!debit && !credit) {
    balanceBar.className = "balance-bar idle";
    balanceBar.textContent = "กรอกจำนวนเงินด้านเดบิตและเครดิตอย่างน้อยด้านละ 1 บรรทัด";
  } else if (balanced) {
    balanceBar.className = "balance-bar ok";
    balanceBar.textContent = `✓ รายการดุล · เดบิต = เครดิต = ${fmt(debit)} (${fmtInt(filledLines)} บรรทัด)`;
  } else {
    balanceBar.className = "balance-bar bad";
    balanceBar.textContent = `ยังไม่ดุล · ${difference > 0 ? "เดบิตมากกว่าเครดิต" : "เครดิตมากกว่าเดบิต"} ${fmt(Math.abs(difference))}`;
  }
  $("balance-line").disabled = balanced || (!debit && !credit);
  return balanced;
}

function addLine(data = {}, { focus = false } = {}) {
  const row = document.createElement("div");
  row.className = "je-line";
  row.innerHTML = `<span class="je-no"></span>
    <select class="je-account" aria-label="บัญชี">${cachedAccountOptions}</select>
    <input type="number" class="je-debit" placeholder="0.00" min="0" step="0.01" inputmode="decimal" aria-label="เดบิต" value="${data.debit || ""}">
    <input type="number" class="je-credit" placeholder="0.00" min="0" step="0.01" inputmode="decimal" aria-label="เครดิต" value="${data.credit || ""}">
    <button type="button" class="je-remove" title="ลบบรรทัด" aria-label="ลบบรรทัด">&times;</button>`;
  row.querySelector(".je-account").value = data.accountId || "";
  const debitInput = row.querySelector(".je-debit");
  const creditInput = row.querySelector(".je-credit");
  // One side per line: typing in one column clears the other.
  debitInput.addEventListener("input", () => {
    if (debitInput.value) creditInput.value = "";
    updateTotals();
  });
  creditInput.addEventListener("input", () => {
    if (creditInput.value) debitInput.value = "";
    updateTotals();
  });
  row.querySelector(".je-remove").addEventListener("click", () => {
    if (lineRows().length <= 2) {
      toastError("ต้องมีอย่างน้อย 2 บรรทัด");
      return;
    }
    row.remove();
    renumberLines();
    updateTotals();
    formDirty = true;
  });
  linesElement.appendChild(row);
  renumberLines();
  if (focus) row.querySelector(".je-account").focus();
  return row;
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

/** Put the current difference into the first line that has no amount yet. */
function balanceLines() {
  let debit = 0;
  let credit = 0;
  lineRows().forEach((row) => {
    debit += readAmount(row.querySelector(".je-debit"));
    credit += readAmount(row.querySelector(".je-credit"));
  });
  const difference = Math.round((debit - credit) * 100) / 100;
  if (Math.abs(difference) < AMOUNT_EPSILON) return;
  let target = lineRows().find((row) => !readAmount(row.querySelector(".je-debit")) && !readAmount(row.querySelector(".je-credit")));
  if (!target) target = addLine();
  const field = difference > 0 ? ".je-credit" : ".je-debit";
  target.querySelector(field).value = Math.abs(difference).toFixed(2);
  updateTotals();
  formDirty = true;
  const accountField = target.querySelector(".je-account");
  if (!accountField.value) accountField.focus();
}

/* ---------- form state ---------- */
function setEditing(isEditing, label = "") {
  journalEntryForm.classList.toggle("is-editing", isEditing);
  $("journal-form-title").textContent = isEditing ? `แก้ไขรายการ ${label}`.trim() : "บันทึกรายการใหม่";
  submitButton.textContent = isEditing ? "บันทึกการแก้ไข" : "บันทึกรายการ";
  cancelButton.hidden = !isEditing;
}

function suggestDocNo() {
  if (docNoTouched) return;
  docNoInput.value = nextDocNo(dateInput.value, editingEntryId || "");
}

function resetForm({ keepDate = false } = {}) {
  editingEntryId = null;
  docNoTouched = false;
  formDirty = false;
  if (!keepDate || !dateInput.value) dateInput.value = todayIso();
  descInput.value = "";
  customerSelect.value = "";
  kindSelect.value = "general";
  errorElement.textContent = "";
  setEditing(false);
  resetLines();
  suggestDocNo();
}

function fillForm(entry, { mode }) {
  // mode: "edit" | "copy" | "reverse"
  editingEntryId = mode === "edit" ? entry.id : null;
  dateInput.value = mode === "edit" ? toIsoDate(entry.date) || entry.date || "" : todayIso();
  docNoTouched = mode === "edit" && Boolean(entry.docNo);
  docNoInput.value = mode === "edit" ? entry.docNo || "" : "";
  kindSelect.value = mode === "edit" ? entryKind(entry) : "general";
  descInput.value = mode === "reverse" ? `กลับรายการ ${entry.docNo || ""} ${entry.desc || ""}`.replace(/\s+/g, " ").trim() : entry.desc || "";
  renderCustomerOptions();
  customerSelect.value = entry.customerId ? `id:${entry.customerId}` : entry.customerName ? `name:${entry.customerName}` : "";
  const lines = mode === "reverse"
    ? entry.lines.map((line) => ({ accountId: line.accountId, debit: line.credit, credit: line.debit }))
    : entry.lines;
  resetLines(lines);
  errorElement.textContent = "";
  setEditing(mode === "edit", entry.docNo || fmtDateDMY(entry.date));
  if (mode !== "edit") suggestDocNo();
  formDirty = mode !== "edit";
  journalEntryForm.scrollIntoView({ behavior: "smooth", block: "start" });
  if (mode !== "edit") toast(mode === "reverse" ? "สร้างรายการกลับบัญชีแล้ว ตรวจสอบและกดบันทึก" : "คัดลอกรายการแล้ว ตรวจสอบและกดบันทึก");
}

function applyAutoDescription(value) {
  if (!value) return;
  const { customerId, customerName } = resolveCustomer(value);
  const rule = state.autoDesc.find((item) =>
    (customerId && item.customerId === customerId) ||
    (customerName && item.customerName === customerName),
  );
  if (!rule) return;
  descInput.value = rule.text || "";
  const rows = lineRows();
  if (rows[0] && rule.debitAccountId) rows[0].querySelector(".je-account").value = rule.debitAccountId;
  if (rows[1] && rule.creditAccountId) rows[1].querySelector(".je-account").value = rule.creditAccountId;
  toast("เติมข้อมูลจากคำอธิบายอัตโนมัติแล้ว");
  rows[0]?.querySelector(".je-debit").focus();
}

/* ---------- saved entries ---------- */
function entrySearchText(entry) {
  return [
    entry.docNo,
    entry.desc,
    entry.customerName,
    fmtDateDMY(entry.date),
    String(entryTotal(entry)),
    ...entry.lines.map((line) => {
      const account = getAccount(line.accountId);
      return account ? `${account.code} ${account.name}` : "";
    }),
  ].join(" ").toLowerCase();
}

function visibleEntries() {
  const needle = filters.text.toLowerCase();
  return state.entries.filter((entry) => {
    if (filters.kind && entryKind(entry) !== filters.kind) return false;
    if (filters.from || filters.to) {
      const date = toIsoDate(entry.date);
      if (!date || (filters.from && date < filters.from) || (filters.to && date > filters.to)) return false;
    }
    return !needle || entrySearchText(entry).includes(needle);
  });
}

/** Entries posted by the receivables/payables pages are edited there, not here. */
function linkedSource(entry) {
  if (!entry.source || entry.source.type === "closing") return null;
  return SOURCE_LABELS[entry.source.type] || null;
}

function entryActions(entry) {
  const locked = isLocked(entry.date);
  const linked = Boolean(linkedSource(entry));
  const blockedTitle = locked ? "อยู่ในงวดที่ปิดแล้ว" : "รายการอัตโนมัติ แก้ไขที่หน้าต้นทาง";
  const blocked = locked || linked ? ` disabled title="${blockedTitle}"` : "";
  return `<div class="actions-cell gj-actions">
    <button type="button" class="small ghost" data-copy-entry="${esc(entry.id)}" title="คัดลอกเป็นรายการใหม่">คัดลอก</button>
    <button type="button" class="small ghost" data-reverse-entry="${esc(entry.id)}" title="สร้างรายการกลับบัญชี"${linked ? ` disabled title="${blockedTitle}"` : ""}>กลับรายการ</button>
    <button type="button" class="small secondary" data-edit-entry="${esc(entry.id)}"${blocked || (entry.source?.type === "closing" ? ' disabled title="รายการปิดบัญชี ลบแล้วสร้างใหม่ได้ที่หน้าการตั้งค่า"' : "")}>แก้ไข</button>
    <button type="button" class="small danger" data-delete-entry="${esc(entry.id)}"${blocked}>ลบ</button></div>`;
}

function renderEntry(entry) {
  const debitLines = entry.lines.filter((line) => Number(line.debit) > 0);
  const creditLines = entry.lines.filter((line) => !(Number(line.debit) > 0));
  const ordered = [...debitLines, ...creditLines];
  const kind = entryKind(entry);
  const debitTotal = entry.lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const creditTotal = entry.lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  const unbalanced = Math.abs(debitTotal - creditTotal) >= AMOUNT_EPSILON;
  const rows = ordered.map((line, index) => {
    const account = getAccount(line.accountId);
    const isCredit = !(Number(line.debit) > 0);
    const name = account ? esc(account.name) : '<span class="unbalanced">(บัญชีถูกลบ)</span>';
    const first = index === 0;
    return `<tr>
      <td class="nowrap">${first ? esc(fmtDateDMY(entry.date) || "ไม่ระบุวันที่") : ""}</td>
      <td>${first ? `<span class="gj-doc">${esc(entry.docNo || "-")}</span>` : ""}</td>
      <td class="${isCredit ? "gj-credit" : ""}">${name}</td>
      <td class="code">${account ? esc(account.code) : ""}</td>
      <td class="right">${line.debit ? fmt(line.debit) : ""}</td>
      <td class="right">${line.credit ? fmt(line.credit) : ""}</td>
      <td class="right">${first ? entryActions(entry) : ""}</td>
    </tr>`;
  }).join("");
  const source = linkedSource(entry);
  const tags = [
    isLocked(entry.date) ? '<span class="badge" title="อยู่ในงวดที่ปิดแล้ว">🔒 ปิดงวด</span>' : "",
    source ? `<a class="badge accent" href="../${source.page}/${source.page}.html" title="สร้างอัตโนมัติ แก้ไขได้ที่หน้าต้นทาง">${esc(source.label)}${entry.source.docNo ? ` ${esc(entry.source.docNo)}` : ""}</a>` : "",
    kind !== "general" ? `<span class="badge info">${ENTRY_KINDS[kind]}</span>` : "",
    unbalanced ? '<span class="badge danger">ไม่ดุล</span>' : "",
    entry.customerName ? `<span class="badge">${esc(entry.customerName)}</span>` : "",
  ].join(" ");
  return `<tbody class="gj-entry">${rows}<tr class="gj-desc"><td></td><td></td><td colspan="5">(${esc(entry.desc || "ไม่มีคำอธิบาย")}) ${tags}</td></tr></tbody>`;
}

function renderJournal() {
  const list = $("journal-list");
  const entries = visibleEntries();
  const totalDebit = entries.reduce((total, entry) => total + entryTotal(entry), 0);
  const filtered = filters.from || filters.to || filters.text || filters.kind;
  $("je-filter-summary").textContent = filtered
    ? `แสดง ${fmtInt(entries.length)} จาก ${fmtInt(state.entries.length)} รายการ · ยอดรวม ${fmt(totalDebit)}`
    : `ทั้งหมด ${fmtInt(entries.length)} รายการ · ยอดรวม ${fmt(totalDebit)}`;

  if (!state.entries.length) {
    list.innerHTML = '<div class="empty-state"><strong>ยังไม่มีรายการบันทึก</strong>กรอกฟอร์มด้านบนเพื่อบันทึกรายการแรก</div>';
    return;
  }
  if (!entries.length) {
    list.innerHTML = '<div class="empty-state"><strong>ไม่พบรายการ</strong>ลองเปลี่ยนช่วงวันที่หรือคำค้นหา</div>';
    return;
  }

  const sorted = entries.slice().sort((left, right) =>
    (toIsoDate(right.date) || "").localeCompare(toIsoDate(left.date) || "") ||
    String(right.docNo || "").localeCompare(String(left.docNo || ""), "th-TH", { numeric: true }));
  const page = sorted.slice(0, visibleLimit);
  const pageDebit = page.reduce((sum, entry) => sum + entry.lines.reduce((s, line) => s + (Number(line.debit) || 0), 0), 0);
  const pageCredit = page.reduce((sum, entry) => sum + entry.lines.reduce((s, line) => s + (Number(line.credit) || 0), 0), 0);

  list.innerHTML = `<div class="table-wrap"><table class="gj-table">
      <thead><tr><th class="col-date">วันที่</th><th style="width:140px">เลขที่</th><th>ชื่อบัญชีและคำอธิบาย</th><th class="col-code">เลขที่บัญชี</th><th class="right col-amt">เดบิต</th><th class="right col-amt">เครดิต</th><th class="col-act"></th></tr></thead>
      ${page.map(renderEntry).join("")}
      <tfoot><tr><th colspan="4">รวม ${fmtInt(page.length)} รายการที่แสดง</th><th class="right">${fmt(pageDebit)}</th><th class="right">${fmt(pageCredit)}</th><th></th></tr></tfoot>
    </table></div>
    ${sorted.length > visibleLimit ? `<div class="load-more"><button type="button" class="secondary" id="journal-load-more">แสดงเพิ่ม (เหลืออีก ${fmtInt(sorted.length - visibleLimit)} รายการ)</button></div>` : ""}`;

  $("journal-load-more")?.addEventListener("click", () => {
    visibleLimit += PAGE_SIZE * 2;
    renderJournal();
  });
}

$("journal-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const findEntry = (id) => state.entries.find((item) => item.id === id);

  if (button.dataset.editEntry || button.dataset.copyEntry || button.dataset.reverseEntry) {
    const entry = findEntry(button.dataset.editEntry || button.dataset.copyEntry || button.dataset.reverseEntry);
    if (!entry) return;
    if (formDirty && !(await confirmAction("ฟอร์มมีข้อมูลที่ยังไม่บันทึก ต้องการแทนที่หรือไม่?", { title: "ข้อมูลยังไม่ถูกบันทึก", confirmText: "แทนที่", tone: "primary" }))) return;
    fillForm(entry, { mode: button.dataset.editEntry ? "edit" : button.dataset.copyEntry ? "copy" : "reverse" });
    return;
  }

  if (button.dataset.deleteEntry) {
    const entryId = button.dataset.deleteEntry;
    const entry = findEntry(entryId);
    if (!entry) return;
    if (isLocked(entry.date)) return toastError(lockMessage());
    if (linkedSource(entry)) return toastError("รายการนี้สร้างอัตโนมัติ ลบได้ที่หน้าต้นทาง");
    if (!(await confirmAction(`ยืนยันการลบรายการ ${entry?.docNo || ""} ${entry?.desc || ""}? (หากต้องการเก็บประวัติ แนะนำให้ใช้ “กลับรายการ” แทน)`.trim()))) return;
    const previous = JSON.parse(JSON.stringify(state));
    replaceState({ ...state, entries: state.entries.filter((item) => item.id !== entryId) });
    if (!(await save(["entries"]))) {
      replaceState(previous);
      renderJournal();
      return;
    }
    if (editingEntryId === entryId) resetForm();
    renderJournal();
    toastSuccess("ลบรายการบันทึกเรียบร้อย");
  }
});

/* ---------- events ---------- */
$("add-line").addEventListener("click", () => addLine({}, { focus: true }));
$("balance-line").addEventListener("click", balanceLines);
$("journal-entry-reset").addEventListener("click", async () => {
  if (formDirty && !(await confirmAction("ล้างข้อมูลในฟอร์มทั้งหมด?", { title: "ล้างฟอร์ม", confirmText: "ล้าง" }))) return;
  resetForm();
});
customerSelect.addEventListener("change", (event) => applyAutoDescription(event.target.value));
dateInput.addEventListener("change", suggestDocNo);
docNoInput.addEventListener("input", () => { docNoTouched = Boolean(docNoInput.value.trim()); });
journalEntryForm.addEventListener("input", () => { formDirty = true; });
cancelButton.addEventListener("click", () => {
  resetForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

journalEntryForm.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    journalEntryForm.requestSubmit();
  } else if (event.altKey && (event.key === "n" || event.key === "N")) {
    event.preventDefault();
    addLine({}, { focus: true });
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!formDirty) return;
  event.preventDefault();
  event.returnValue = "";
});

journalEntryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorElement.textContent = "";
  if (!dateInput.value) {
    errorElement.textContent = "กรุณาระบุวันที่";
    dateInput.focus();
    return;
  }
  const original = editingEntryId ? state.entries.find((entry) => entry.id === editingEntryId) : null;
  if (isLocked(dateInput.value) || (original && isLocked(original.date))) {
    errorElement.textContent = lockMessage();
    dateInput.focus();
    return;
  }
  if (!descInput.value.trim()) {
    errorElement.textContent = "กรุณาระบุคำอธิบายรายการ";
    descInput.focus();
    return;
  }
  const lines = [];
  for (const row of lineRows()) {
    const accountId = row.querySelector(".je-account").value;
    const debit = readAmount(row.querySelector(".je-debit"));
    const credit = readAmount(row.querySelector(".je-credit"));
    if (!debit && !credit) continue;
    if (!accountId) {
      errorElement.textContent = "มีบรรทัดที่กรอกจำนวนเงินแต่ยังไม่ได้เลือกบัญชี";
      row.querySelector(".je-account").focus();
      return;
    }
    if (debit < 0 || credit < 0) {
      errorElement.textContent = "จำนวนเงินต้องไม่ติดลบ";
      return;
    }
    if (debit > 0 && credit > 0) {
      errorElement.textContent = "แต่ละบรรทัดใส่ได้เฉพาะเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง";
      return;
    }
    lines.push({ accountId, debit, credit });
  }
  if (lines.length < 2) {
    errorElement.textContent = "ต้องมีอย่างน้อย 2 บรรทัดที่มีจำนวนเงิน";
    return;
  }
  if (!lines.some((line) => line.debit > 0) || !lines.some((line) => line.credit > 0)) {
    errorElement.textContent = "ต้องมีทั้งด้านเดบิตและด้านเครดิต";
    return;
  }
  if (!updateTotals()) {
    errorElement.textContent = "ยอดเดบิตและเครดิตต้องเท่ากัน — กด “ปรับยอดให้ดุล” หรือแก้ไขจำนวนเงิน";
    return;
  }

  const docNo = docNoInput.value.trim() || nextDocNo(dateInput.value, editingEntryId || "");
  if (state.entries.some((entry) => entry.docNo === docNo && entry.id !== editingEntryId)) {
    errorElement.textContent = `เลขที่เอกสาร ${docNo} ถูกใช้แล้ว`;
    docNoInput.focus();
    return;
  }

  const { customerId, customerName } = resolveCustomer(customerSelect.value);
  const payload = {
    date: dateInput.value,
    docNo,
    kind: kindSelect.value || "general",
    desc: descInput.value.trim(),
    lines,
  };
  if (customerId) payload.customerId = customerId;
  if (customerName) payload.customerName = customerName;
  const previous = JSON.parse(JSON.stringify(state));
  const entries = state.entries.slice();
  const isEdit = Boolean(editingEntryId);
  if (isEdit) {
    const index = entries.findIndex((existingEntry) => existingEntry.id === editingEntryId);
    if (index < 0) return resetForm();
    const updated = { ...entries[index], ...payload, updatedAt: new Date().toISOString() };
    if (!customerId) delete updated.customerId;
    if (!customerName) delete updated.customerName;
    entries[index] = updated;
  } else {
    entries.push({ id: uid(), ...payload, createdAt: new Date().toISOString() });
  }
  entries.sort((earlierEntry, laterEntry) => (toIsoDate(earlierEntry.date) || "").localeCompare(toIsoDate(laterEntry.date) || "") || String(earlierEntry.id).localeCompare(String(laterEntry.id)));
  submitButton.disabled = true;
  replaceState({ ...state, entries });
  const saved = await save(["entries"]);
  submitButton.disabled = false;
  if (!saved) {
    replaceState(previous);
    renderJournal();
    return;
  }
  resetForm({ keepDate: true });
  renderJournal();
  toastSuccess(isEdit ? `แก้ไขรายการ ${docNo} เรียบร้อย` : `บันทึกรายการ ${docNo} เรียบร้อย`);
  descInput.focus();
});

/* ---------- filters & export ---------- */
function applyFilters() {
  filters.from = $("journal-entry-filter-start-date").value;
  filters.to = $("journal-entry-filter-end-date").value;
  filters.text = $("journal-entry-filter-text").value.trim();
  filters.kind = $("journal-entry-filter-kind").value;
  visibleLimit = PAGE_SIZE;
  renderJournal();
}
$("journal-entry-filter-start-date").addEventListener("change", applyFilters);
$("journal-entry-filter-end-date").addEventListener("change", applyFilters);
$("journal-entry-filter-kind").addEventListener("change", applyFilters);
$("journal-entry-filter-text").addEventListener("input", debounce(applyFilters, 180));
$("journal-entry-filter-month").addEventListener("click", () => {
  const today = todayIso();
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  $("journal-entry-filter-start-date").value = `${today.slice(0, 7)}-01`;
  $("journal-entry-filter-end-date").value = `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
  applyFilters();
});
$("journal-entry-filter-clear").addEventListener("click", () => {
  $("journal-entry-filter-start-date").value = "";
  $("journal-entry-filter-end-date").value = "";
  $("journal-entry-filter-text").value = "";
  $("journal-entry-filter-kind").value = "";
  applyFilters();
});
$("journal-entry-export").addEventListener("click", () => {
  const entries = visibleEntries();
  if (!entries.length) return toastError("ไม่มีรายการให้ส่งออก");
  const rows = [];
  entries.forEach((entry) => entry.lines.forEach((line) => {
    const account = getAccount(line.accountId);
    rows.push([fmtDateDMY(entry.date), entry.docNo || "", ENTRY_KINDS[entryKind(entry)], entry.desc || "", entry.customerName || "", account?.code || "", account?.name || "(บัญชีถูกลบ)", Number(line.debit) || 0, Number(line.credit) || 0]);
  }));
  downloadCsvFile(`journal-${fileStamp()}.csv`, toCsv(["วันที่", "เลขที่เอกสาร", "ประเภท", "คำอธิบาย", "ลูกค้า", "รหัสบัญชี", "ชื่อบัญชี", "เดบิต", "เครดิต"], rows));
  toastSuccess(`ส่งออก ${fmtInt(entries.length)} รายการ`);
});

function handleHash() {
  if (location.hash === "#new") {
    journalEntryForm.scrollIntoView({ block: "start" });
    dateInput.focus();
    history.replaceState(null, "", location.pathname);
  }
}
window.addEventListener("hashchange", handleHash);

if (await load(["entries", "accounts", "customers", "customerNames", "autoDesc"])) {
  cachedAccountOptions = accountOptionsHtml();
  renderCustomerOptions();
  resetForm();
  renderJournal();
  handleHash();
  if (!state.accounts.length) {
    journalEntryForm.insertAdjacentHTML("afterbegin", '<div class="banner warn">ยังไม่มีผังบัญชี — <a href="../accounts/accounts.html">สร้างผังบัญชี</a> ก่อนบันทึกรายการ</div>');
  }
  renderDocNoBanner();
  onDataRefresh(() => {
    cachedAccountOptions = accountOptionsHtml();
    renderCustomerOptions();
    renderJournal();
    renderDocNoBanner();
  });
}

/* ---------- document numbers for older entries ---------- */
function renderDocNoBanner() {
  document.getElementById("docno-banner")?.remove();
  const missing = state.entries.filter((entry) => !entry.docNo).length;
  if (!missing) return;
  document.querySelector(".section-head").insertAdjacentHTML("beforebegin",
    `<div class="banner info" id="docno-banner"><span>มี <strong>${fmtInt(missing)}</strong> รายการที่ยังไม่มีเลขที่เอกสาร</span><button type="button" class="small" id="docno-fill" style="margin-left:auto">สร้างเลขที่ให้อัตโนมัติ</button></div>`);
  $("docno-fill").addEventListener("click", async () => {
    if (!(await confirmAction(`สร้างเลขที่เอกสาร JV-ปีเดือน-ลำดับ ให้ ${fmtInt(missing)} รายการตามลำดับวันที่?`, { title: "สร้างเลขที่เอกสาร", confirmText: "สร้างเลขที่", tone: "primary" }))) return;
    const previous = JSON.parse(JSON.stringify(state));
    const entries = state.entries.map((entry) => ({ ...entry }));
    const reserved = new Set();
    entries
      .filter((entry) => !entry.docNo)
      .sort((left, right) => (toIsoDate(left.date) || "").localeCompare(toIsoDate(right.date) || ""))
      .forEach((entry) => { entry.docNo = nextSeqNo(entries, "JV", entry.date, entry.id, reserved); });
    replaceState({ ...state, entries });
    if (!(await save(["entries"]))) {
      replaceState(previous);
      return;
    }
    renderJournal();
    renderDocNoBanner();
    suggestDocNo();
    toastSuccess(`สร้างเลขที่เอกสาร ${fmtInt(missing)} รายการเรียบร้อย`);
  });
}

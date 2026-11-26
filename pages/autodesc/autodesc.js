/**
 * @file หน้า "คำอธิบายอัตโนมัติ" — แม่แบบรายการ แบ่งเป็น 2 ประเภท
 *
 * - ตามชื่อลูกค้า:  เก็บ customerId / customerName
 * - ตามชื่อรายการ: เก็บ itemName (เช่น "ค่าไฟฟ้า") — ไม่ใช่คู่ค้า
 *
 * เมื่อเลือกชื่อลูกค้าหรือชื่อรายการในช่องคู่ค้าของสมุดรายวัน ระบบจะหาแม่แบบที่ตรงกัน
 * แล้วเติมคำอธิบาย บัญชีเดบิต (บรรทัดที่ 1) และบัญชีเครดิต (บรรทัดที่ 2) ให้อัตโนมัติ
 * (ข้อมูลเก็บใน state.autoDesc — ชื่อนี้ถูกบันทึกในฐานข้อมูลแล้ว จึงคงไว้)
 */
import { commitChanges, loadData, onDataRefresh, state } from "../../src/core/store.js";
import { watchDocumentNumberRepair } from "../../src/components/document-number-repair-job.js";
import { findAccountById, renderAccountOptions } from "../../src/accounting/accounts.js";
import {
  getCustomerDisplayName,
  getTemplateItemNames,
  parseCustomerOptionValue,
  renderCustomerOptions,
  toCustomerOptionValue,
} from "../../src/accounting/customers.js";
import { notifyError, notifySuccess, notify } from "../../src/components/notifications.js";
import { confirmDialog } from "../../src/components/dialogs.js";
import { byId } from "../../src/utils/dom.js";
import { escapeHtml } from "../../src/utils/format.js";
import { createId } from "../../src/utils/id.js";

const ruleForm = byId("auto-description-form");
const submitButton = byId("auto-description-submit");
const cancelButton = byId("auto-description-cancel");
const typeSelect = byId("auto-description-type");
const customerField = byId("auto-description-customer-field");
const customerSelect = byId("auto-description-customer");
const itemField = byId("auto-description-item-field");
const itemInput = byId("auto-description-item");
const itemList = byId("auto-description-item-list");
const debitAccountSelect = byId("auto-description-debit-account");
const creditAccountSelect = byId("auto-description-credit-account");
// บัญชีที่ 2 (ไม่บังคับ) — เก็บเป็น debitAccountId2 / creditAccountId2 เติมลงบรรทัดที่ 3 / 4 ในสมุดรายวัน
const debitAccountSelect2 = byId("auto-description-debit-account-2");
const creditAccountSelect2 = byId("auto-description-credit-account-2");
const descriptionInput = byId("auto-description-text");
const customerTableBody = document.querySelector("#auto-description-table tbody");
const itemTableBody = document.querySelector("#auto-description-item-table tbody");

/** id ของแม่แบบที่กำลังแก้ไข (null = เพิ่มใหม่) */
let editingRuleId = null;

/** แม่แบบตามชื่อรายการ (ที่เหลือเป็นแม่แบบตามลูกค้า รวมข้อมูลรุ่นเก่า) */
function isItemRule(rule) {
  return Boolean(String(rule.itemName || "").trim());
}

/** แสดงช่องลูกค้าหรือช่องชื่อรายการตามประเภทแม่แบบที่เลือก */
function syncTypeFields() {
  const isItem = typeSelect.value === "item";
  customerField.hidden = isItem;
  itemField.hidden = !isItem;
}

/** สร้างตัวเลือกลูกค้า ชื่อรายการ และบัญชีใหม่ โดยคงค่าที่เลือกไว้ */
function renderFormOptions() {
  const selectedCustomer = customerSelect.value;
  const selectedDebitAccount = debitAccountSelect.value;
  const selectedCreditAccount = creditAccountSelect.value;
  const selectedDebitAccount2 = debitAccountSelect2.value;
  const selectedCreditAccount2 = creditAccountSelect2.value;
  customerSelect.innerHTML = `<option value="">-- เลือกลูกค้า --</option>${renderCustomerOptions()}`;
  // ชื่อในแม่แบบที่สร้างจากสมุดรายวัน (ไม่มีในทะเบียน/ไฟล์) → เพิ่มเป็นตัวเลือก เพื่อให้แก้ไขแม่แบบนั้นได้
  const existingValues = new Set([...customerSelect.options].map((option) => option.value));
  const extraNames = [...new Set(state.autoDesc
    .filter((rule) => !isItemRule(rule) && !rule.customerId && rule.customerName)
    .map((rule) => rule.customerName))]
    .filter((name) => !existingValues.has(`name:${name}`));
  if (extraNames.length) {
    customerSelect.insertAdjacentHTML("beforeend", `<optgroup label="ชื่อจากสมุดรายวัน">${extraNames
      .map((name) => `<option value="name:${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}</optgroup>`);
  }
  customerSelect.value = selectedCustomer;
  itemList.innerHTML = getTemplateItemNames().map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  debitAccountSelect.innerHTML = renderAccountOptions(selectedDebitAccount);
  creditAccountSelect.innerHTML = renderAccountOptions(selectedCreditAccount);
  debitAccountSelect2.innerHTML = renderAccountOptions(selectedDebitAccount2);
  creditAccountSelect2.innerHTML = renderAccountOptions(selectedCreditAccount2);
}

function resetForm() {
  editingRuleId = null;
  const currentType = typeSelect.value;
  ruleForm.reset();
  typeSelect.value = currentType; // คงประเภทไว้ สะดวกเมื่อเพิ่มหลายแม่แบบติดกัน
  typeSelect.disabled = false;
  syncTypeFields();
  submitButton.textContent = "เพิ่มคำอธิบาย";
  cancelButton.hidden = true;
}

/** ชื่อบัญชีในตาราง (แสดงคำเตือนถ้าบัญชีถูกลบไปแล้ว) */
function renderAccountCell(accountId) {
  const account = findAccountById(accountId);
  return account
    ? `${escapeHtml(account.code)} - ${escapeHtml(account.name)}`
    : '<span class="unbalanced">(ไม่พบบัญชี)</span>';
}

/** บัญชีหลัก + บัญชีที่ 2 (ถ้ามี) ในเซลล์เดียว */
function renderAccountCells(accountId, accountId2) {
  return accountId2
    ? `${renderAccountCell(accountId)}<span class="cell-sub">${renderAccountCell(accountId2)}</span>`
    : renderAccountCell(accountId);
}

/**
 * @param {object[]} rules
 * @param {(rule: object) => string} getName ชื่อในคอลัมน์แรก
 * @param {string} emptyText
 */
function renderRuleRows(rules, getName, emptyText) {
  return rules.length
    ? rules.map((rule) => `<tr>
        <td>${escapeHtml(getName(rule))}</td>
        <td>${renderAccountCells(rule.debitAccountId, rule.debitAccountId2)}</td>
        <td>${renderAccountCells(rule.creditAccountId, rule.creditAccountId2)}</td>
        <td>${escapeHtml(rule.text || "")}</td>
        <td class="actions-cell">
          <button type="button" class="small secondary" data-edit-rule="${escapeHtml(rule.id)}">แก้ไข</button>
          <button type="button" class="small danger" data-delete-rule="${escapeHtml(rule.id)}">ลบ</button>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="muted">${emptyText}</td></tr>`;
}

function renderRuleTables() {
  customerTableBody.innerHTML = renderRuleRows(
    state.autoDesc.filter((rule) => !isItemRule(rule)),
    (rule) => `${getCustomerDisplayName(rule)}${rule.partyType === "supplier" ? " (ซัพพลายเออร์)" : ""}`,
    "ยังไม่มีแม่แบบตามชื่อลูกค้า",
  );
  itemTableBody.innerHTML = renderRuleRows(
    state.autoDesc.filter(isItemRule),
    (rule) => rule.itemName.trim(),
    "ยังไม่มีแม่แบบตามชื่อรายการ",
  );
}

function renderPage() {
  renderFormOptions();
  renderRuleTables();
}

function startEditingRule(rule) {
  editingRuleId = rule.id;
  renderFormOptions();
  const isItem = isItemRule(rule);
  typeSelect.value = isItem ? "item" : "customer";
  typeSelect.disabled = true; // แก้ไขได้เฉพาะเนื้อหา ไม่สลับประเภท
  syncTypeFields();
  customerSelect.value = isItem ? "" : toCustomerOptionValue(rule);
  itemInput.value = isItem ? rule.itemName.trim() : "";
  debitAccountSelect.value = rule.debitAccountId || "";
  creditAccountSelect.value = rule.creditAccountId || "";
  debitAccountSelect2.value = rule.debitAccountId2 || "";
  creditAccountSelect2.value = rule.creditAccountId2 || "";
  descriptionInput.value = rule.text || "";
  submitButton.textContent = "บันทึกการแก้ไข";
  cancelButton.hidden = false;
  (isItem ? itemInput : customerSelect).focus();
  ruleForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteRule(ruleId) {
  if (!(await confirmDialog("ยืนยันการลบคำอธิบายอัตโนมัตินี้?"))) return;
  const isSaved = await commitChanges({ autoDesc: state.autoDesc.filter((rule) => rule.id !== ruleId) });
  if (isSaved && editingRuleId === ruleId) resetForm();
  renderPage();
  if (isSaved) notifySuccess("ลบคำอธิบายอัตโนมัติเรียบร้อย");
}

/**
 * ข้อมูลส่วนที่ระบุว่าแม่แบบเป็นของใคร/รายการใด
 * @returns {{ error: string } | { target: object }}
 */
function readRuleTarget() {
  if (typeSelect.value === "item") {
    const itemName = itemInput.value.trim();
    if (!itemName) return { error: "กรุณาระบุชื่อรายการ" };
    const duplicate = state.autoDesc.find((rule) =>
      rule.id !== editingRuleId && String(rule.itemName || "").trim().toLowerCase() === itemName.toLowerCase());
    if (duplicate) return { error: `มีแม่แบบของชื่อรายการ “${itemName}” อยู่แล้ว — แก้ไขแม่แบบเดิมแทน` };
    return { target: { itemName } };
  }
  if (!customerSelect.value) return { error: "กรุณาเลือกลูกค้า" };
  const { customerId, customerName } = parseCustomerOptionValue(customerSelect.value);
  return {
    target: {
      ...(customerId ? { customerId } : {}),
      ...(customerName ? { customerName } : {}),
    },
  };
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const debitAccountId = debitAccountSelect.value;
  const creditAccountId = creditAccountSelect.value;
  const text = descriptionInput.value.trim();
  const targetResult = readRuleTarget();
  if (targetResult.error) {
    notifyError(targetResult.error);
    return;
  }
  if (!debitAccountId || !creditAccountId || !text) {
    notifyError("กรอกข้อมูลให้ครบก่อนบันทึก");
    return;
  }

  // บัญชีที่ 2 ไม่บังคับ: ใส่เฉพาะเมื่อเลือกไว้
  const debitAccountId2 = debitAccountSelect2.value;
  const creditAccountId2 = creditAccountSelect2.value;
  const ruleData = {
    debitAccountId,
    creditAccountId,
    ...(debitAccountId2 ? { debitAccountId2 } : {}),
    ...(creditAccountId2 ? { creditAccountId2 } : {}),
    text,
    ...targetResult.target,
  };
  const isEditing = Boolean(editingRuleId);
  const rules = isEditing
    // สร้างแม่แบบใหม่ทั้งก้อน (ไม่ใช้ข้อมูลเดิมที่อาจค้างอยู่ รวมถึงฟิลด์ keyword รุ่นเก่า)
    // คงประเภทคู่ค้า (ลูกค้า/ซัพพลายเออร์) ที่เลือกไว้จากสมุดรายวัน ถ้ายังเป็นชื่อเดิม
    ? state.autoDesc.map((rule) => (rule.id === editingRuleId
      ? {
        id: rule.id,
        ...(rule.partyType && ruleData.customerName === rule.customerName && !ruleData.customerId ? { partyType: rule.partyType } : {}),
        ...ruleData,
      }
      : rule))
    : [...state.autoDesc, { id: createId(), ...ruleData }];

  const isSaved = await commitChanges({ autoDesc: rules });
  if (isSaved) resetForm();
  renderPage();
  if (isSaved) notifySuccess(isEditing ? "แก้ไขคำอธิบายอัตโนมัติเรียบร้อย" : "เพิ่มคำอธิบายอัตโนมัติเรียบร้อย");
}

function handleTableClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.editRule) {
    const rule = state.autoDesc.find((item) => item.id === button.dataset.editRule);
    if (rule) startEditingRule(rule);
  } else if (button.dataset.deleteRule) {
    deleteRule(button.dataset.deleteRule);
  }
}

customerTableBody.addEventListener("click", handleTableClick);
itemTableBody.addEventListener("click", handleTableClick);
typeSelect.addEventListener("change", syncTypeFields);
cancelButton.addEventListener("click", () => {
  resetForm();
  notify("ยกเลิกการแก้ไขแล้ว");
});
ruleForm.addEventListener("submit", handleFormSubmit);

if (await loadData(["autoDesc", "accounts", "customers", "suppliers", "customerNames"])) {
  watchDocumentNumberRepair();
  syncTypeFields();
  renderPage();
  onDataRefresh(renderPage);
}

/**
 * @file หน้า "สมุดรายวันทั่วไป" — บันทึก แก้ไข คัดลอก กลับรายการ และค้นหารายการบัญชี
 *
 * กฎการบันทึก (ตามหลักบัญชีคู่)
 * - ต้องมีอย่างน้อย 2 บรรทัด และมีทั้งด้านเดบิตและด้านเครดิต
 * - แต่ละบรรทัดใส่จำนวนเงินได้ด้านเดียว
 * - ยอดรวมเดบิตต้องเท่ากับยอดรวมเครดิต
 * - รายการในงวดที่ล็อกแล้วแก้ไข/ลบไม่ได้
 * - รายการที่ใช้บัญชีลูกหนี้/เจ้าหนี้การค้า ต้องระบุคู่ค้า (ใช้สร้างทะเบียนลูกหนี้/เจ้าหนี้)
 *
 * ตัวช่วยกรอก
 * - บรรทัดที่กรอกเดบิตแล้ว ช่องเครดิตจะถูกปิด (และกลับกัน)
 * - สวิตช์ "เติมยอดแถวคู่อัตโนมัติ": กรอกแถวคี่ (1, 3, 5, ...) แล้วใส่ยอดเดียวกันในฝั่งตรงข้ามของแถวคู่ถัดไป (2, 4, 6, ...)
 * - ช่องคู่ค้าพิมพ์ได้และมีรายการให้เลือก (ชื่อลูกค้า/ผู้ขาย หรือชื่อรายการ)
 *   เลือก/พิมพ์ชื่อที่มีแม่แบบคำอธิบายอัตโนมัติ → เติมคำอธิบายและบัญชีให้
 *   ชื่อรายการไม่ใช่คู่ค้า จึงเก็บในช่อง itemName (ไม่เข้าทะเบียนลูกหนี้/เจ้าหนี้)
 */
import { commitChanges, loadData, onDataRefresh, state } from "../../src/core/store.js";
import { AMOUNT_EPSILON, ENTRY_KIND_LABELS } from "../../src/accounting/constants.js";
import { calculateEntryTotal, getEntryKind } from "../../src/accounting/rules.js";
import { findAccountById, renderAccountOptions } from "../../src/accounting/accounts.js";
import {
  createCustomerCodes,
  createSupplierCode,
  formatCustomerLabel,
  getPartyOptions,
  PARTY_GROUPS,
  parseCustomerOptionValue,
  parseItemOptionValue,
  resolvePartyText,
  toPartyText,
} from "../../src/accounting/customers.js";
import {
  createDocumentNumber,
  createJournalNumber,
  getLockedPeriodMessage,
  isDateLocked,
} from "../../src/accounting/journal.js";
import { roundMoney } from "../../src/accounting/posting.js";
import { getControlAccountType } from "../../src/accounting/subledger.js";
import { notifyError, notifySuccess, notify } from "../../src/components/notifications.js";
import { createMonthFilter, getInitialMonthRange } from "../../src/components/month-filter.js";
import { confirmDialog } from "../../src/components/dialogs.js";
import { createCombobox } from "../../src/components/combobox.js";
import { buildCsv } from "../../src/utils/csv.js";
import { formatIsoDate, getFileDateStamp, getTodayIso, toIsoDate } from "../../src/utils/date.js";
import { byId } from "../../src/utils/dom.js";
import { downloadCsv } from "../../src/utils/download.js";
import { escapeHtml, formatDate, formatMoney, formatNumber } from "../../src/utils/format.js";
import { createId } from "../../src/utils/id.js";
import { debounce } from "../../src/utils/timing.js";

/** จำนวนรายการที่แสดงต่อหน้า (กด "แสดงเพิ่ม" เพื่อดูต่อ) */
const ENTRIES_PER_PAGE = 40;

const entryForm = byId("journal-entry-form");
const linesContainer = byId("journal-entry-lines");
const submitButton = byId("journal-entry-submit");
const cancelEditButton = byId("journal-entry-cancel");
const dateInput = byId("journal-entry-date");
const documentNumberInput = byId("journal-entry-doc-number");
const kindSelect = byId("journal-entry-kind");
const partyInput = byId("journal-entry-customer");
const partyTypeSelect = byId("journal-entry-party-type");
const partyLabel = byId("journal-entry-party-label");
const dueDateInput = byId("journal-entry-due");
const autoMirrorSwitch = byId("journal-auto-mirror");
const descriptionInput = byId("journal-entry-description");
const balanceStatusBar = byId("journal-balance");

/** ตัวกรองรายการที่บันทึกแล้ว */
const listFilters = { from: "", to: "", searchText: "", kind: "" };

/** id ของรายการที่กำลังแก้ไข (null = บันทึกรายการใหม่) */
let editingEntryId = null;
/** ผู้ใช้พิมพ์เลขที่เอกสารเองแล้ว → ไม่สร้างเลขอัตโนมัติทับ */
let isDocumentNumberManual = false;
/** ฟอร์มมีข้อมูลที่ยังไม่บันทึก → เตือนก่อนออกจากหน้า/แทนที่ฟอร์ม */
let hasUnsavedChanges = false;
/** จำนวนรายการที่แสดงอยู่ในตาราง */
let visibleEntryLimit = ENTRIES_PER_PAGE;
/** คีย์ localStorage จำสถานะสวิตช์ "เติมยอดแถวคู่อัตโนมัติ" */
const AUTO_MIRROR_STORAGE_KEY = "journal_auto_mirror";

/** HTML ตัวเลือกบัญชี สร้างครั้งเดียวแล้วใช้ซ้ำทุกบรรทัด (เร็วกว่าสร้างใหม่ทุกครั้ง) */
let accountOptionsHtml = "";

/* ================================================================== */
/* บรรทัดบัญชีในฟอร์ม                                                    */
/* ================================================================== */

/** อ่านจำนวนเงินจากช่องกรอก (ปัดเป็นสตางค์) */
function readAmount(input) {
  const value = parseFloat(input.value);
  return Number.isFinite(value) ? roundMoney(value) : 0;
}

const getLineRows = () => [...linesContainer.querySelectorAll(".journal-line")];

/** ยอดรวมเดบิต/เครดิตของบรรทัดที่กรอกอยู่ */
function sumFormLines() {
  let totalDebit = 0;
  let totalCredit = 0;
  let filledLineCount = 0;
  getLineRows().forEach((row) => {
    const debit = readAmount(row.querySelector(".journal-line-debit"));
    const credit = readAmount(row.querySelector(".journal-line-credit"));
    totalDebit += debit;
    totalCredit += credit;
    if (debit || credit) filledLineCount += 1;
    // บรรทัดเครดิตย่อหน้าเข้า ตามรูปแบบสมุดรายวันทั่วไป
    row.classList.toggle("is-credit", credit > 0 && !debit);
  });
  return { totalDebit, totalCredit, filledLineCount, difference: roundMoney(totalDebit - totalCredit) };
}

/**
 * อัปเดตยอดรวมใต้ตารางและแถบสถานะการดุล
 * @returns {boolean} รายการดุลหรือไม่
 */
function updateBalanceStatus() {
  const { totalDebit, totalCredit, filledLineCount, difference } = sumFormLines();
  const hasAmounts = Boolean(totalDebit || totalCredit);
  const isBalanced = Math.abs(difference) < AMOUNT_EPSILON && totalDebit > 0;

  const totalClass = `right ${isBalanced ? "balanced" : hasAmounts ? "unbalanced" : ""}`;
  byId("total-debit").textContent = formatMoney(totalDebit);
  byId("total-credit").textContent = formatMoney(totalCredit);
  byId("total-debit").className = totalClass;
  byId("total-credit").className = totalClass;

  if (!hasAmounts) {
    balanceStatusBar.className = "balance-bar idle";
    balanceStatusBar.textContent = "กรอกจำนวนเงินด้านเดบิตและเครดิตอย่างน้อยด้านละ 1 บรรทัด";
  } else if (isBalanced) {
    balanceStatusBar.className = "balance-bar ok";
    balanceStatusBar.textContent = `✓ รายการดุล · เดบิต = เครดิต = ${formatMoney(totalDebit)} (${formatNumber(filledLineCount)} บรรทัด)`;
  } else {
    balanceStatusBar.className = "balance-bar bad";
    balanceStatusBar.textContent = `ยังไม่ดุล · ${difference > 0 ? "เดบิตมากกว่าเครดิต" : "เครดิตมากกว่าเดบิต"} ${formatMoney(Math.abs(difference))}`;
  }
  byId("balance-line").disabled = isBalanced || !hasAmounts;
  return isBalanced;
}

/**
 * ปิดช่องฝั่งตรงข้ามของบรรทัดที่มีจำนวนเงินแล้ว
 * (มีเดบิต → ปิดเครดิต, มีเครดิต → ปิดเดบิต, ว่างทั้งคู่ → เปิดทั้งคู่)
 * @param {HTMLElement} row
 */
function syncLineInputs(row) {
  const debitInput = row.querySelector(".journal-line-debit");
  const creditInput = row.querySelector(".journal-line-credit");
  const hasDebit = debitInput.value.trim() !== "";
  const hasCredit = creditInput.value.trim() !== "";
  // ข้อมูลเก่าที่มีทั้งสองฝั่ง: เปิดไว้ทั้งคู่ให้ผู้ใช้แก้ไขได้
  debitInput.disabled = hasCredit && !hasDebit;
  creditInput.disabled = hasDebit && !hasCredit;
}

/**
 * สวิตช์ "เติมยอดแถวคู่อัตโนมัติ": แถวคี่ (1, 3, 5, ...) เป็นต้นทางของแถวคู่ถัดไป (2, 4, 6, ...)
 * กรอกแถวคี่ฝั่งไหน ใส่ยอดเดียวกันในฝั่งตรงข้ามของแถวคู่ที่จับคู่กัน
 * @param {HTMLElement} changedRow บรรทัดที่เพิ่งถูกแก้ไข
 */
function mirrorToPairedLine(changedRow) {
  if (!autoMirrorSwitch.checked) return;
  const rows = getLineRows();
  const rowIndex = rows.indexOf(changedRow);
  const isOddRow = rowIndex % 2 === 0; // ลำดับเริ่มที่ 0 → แถวที่ 1, 3, 5 คือ index 0, 2, 4
  const pairedRow = rows[rowIndex + 1];
  if (rowIndex < 0 || !isOddRow || !pairedRow) return;

  const sourceDebit = changedRow.querySelector(".journal-line-debit").value;
  const sourceCredit = changedRow.querySelector(".journal-line-credit").value;
  pairedRow.querySelector(".journal-line-debit").value = sourceCredit; // แถวคี่เครดิต → แถวคู่เดบิต
  pairedRow.querySelector(".journal-line-credit").value = sourceDebit; // แถวคี่เดบิต → แถวคู่เครดิต
  syncLineInputs(pairedRow);
}

/** เปิดสวิตช์: เติมยอดให้ทุกคู่ที่แถวคี่มีจำนวนเงินอยู่แล้ว */
function mirrorAllPairs() {
  getLineRows().forEach((row, index) => {
    const hasAmount = row.querySelector(".journal-line-debit").value || row.querySelector(".journal-line-credit").value;
    if (index % 2 === 0 && hasAmount) mirrorToPairedLine(row);
  });
}

function renumberLines() {
  getLineRows().forEach((row, index) => {
    row.querySelector(".journal-line-number").textContent = String(index + 1);
  });
}

/**
 * เพิ่มบรรทัดบัญชีหนึ่งบรรทัดในฟอร์ม
 * @param {{ accountId?: string, debit?: number, credit?: number }} [lineData]
 * @param {{ focus?: boolean }} [options]
 * @returns {HTMLElement}
 */
function addLine(lineData = {}, { focus = false } = {}) {
  const row = document.createElement("div");
  row.className = "journal-line";
  row.innerHTML = `<span class="journal-line-number"></span>
    <select class="journal-line-account" aria-label="บัญชี">${accountOptionsHtml}</select>
    <input type="number" class="journal-line-debit" placeholder="0.00" min="0" step="0.01" inputmode="decimal" aria-label="เดบิต" value="${lineData.debit || ""}">
    <input type="number" class="journal-line-credit" placeholder="0.00" min="0" step="0.01" inputmode="decimal" aria-label="เครดิต" value="${lineData.credit || ""}">
    <button type="button" class="journal-line-remove" title="ลบบรรทัด" aria-label="ลบบรรทัด">&times;</button>`;
  row.querySelector(".journal-line-account").value = lineData.accountId || "";

  // หนึ่งบรรทัดมีได้ด้านเดียว: กรอกช่องหนึ่งแล้วปิดใช้งานอีกช่องทันที
  const debitInput = row.querySelector(".journal-line-debit");
  const creditInput = row.querySelector(".journal-line-credit");
  const handleAmountInput = () => {
    syncLineInputs(row);
    mirrorToPairedLine(row);
    updateBalanceStatus();
  };
  debitInput.addEventListener("input", handleAmountInput);
  creditInput.addEventListener("input", handleAmountInput);
  syncLineInputs(row);
  row.querySelector(".journal-line-remove").addEventListener("click", () => {
    if (getLineRows().length <= 2) {
      notifyError("ต้องมีอย่างน้อย 2 บรรทัด");
      return;
    }
    row.remove();
    renumberLines();
    updateBalanceStatus();
    hasUnsavedChanges = true;
  });

  linesContainer.appendChild(row);
  renumberLines();
  if (focus) row.querySelector(".journal-line-account").focus();
  return row;
}

/** แทนที่บรรทัดทั้งหมด (อย่างน้อย 2 บรรทัดเสมอ) */
function replaceLines(lines = []) {
  linesContainer.innerHTML = "";
  lines.forEach((line) => addLine(line));
  while (getLineRows().length < 2) addLine();
  updateBalanceStatus();
}

/** ปุ่ม "ปรับยอดให้ดุล": ใส่ผลต่างลงในบรรทัดแรกที่ยังว่าง (ไม่มีบรรทัดว่างจะเพิ่มบรรทัดใหม่) */
function fillBalancingAmount() {
  const { difference } = sumFormLines();
  if (Math.abs(difference) < AMOUNT_EPSILON) return;

  const isEmptyLine = (row) => !readAmount(row.querySelector(".journal-line-debit")) && !readAmount(row.querySelector(".journal-line-credit"));
  const targetRow = getLineRows().find(isEmptyLine) || addLine();
  // เดบิตเกิน → เติมฝั่งเครดิต, เครดิตเกิน → เติมฝั่งเดบิต
  const targetField = difference > 0 ? ".journal-line-credit" : ".journal-line-debit";
  targetRow.querySelector(targetField).value = Math.abs(difference).toFixed(2);
  syncLineInputs(targetRow);
  updateBalanceStatus();
  hasUnsavedChanges = true;

  const accountSelect = targetRow.querySelector(".journal-line-account");
  if (!accountSelect.value) accountSelect.focus();
}

/* ================================================================== */
/* สถานะของฟอร์ม                                                         */
/* ================================================================== */

/** ป้ายและคำแนะนำของช่องคู่ค้า ตามประเภทที่เลือก ("" = ทั้งหมด) */
const PARTY_TYPE_TEXTS = {
  "": { label: "ลูกค้า / ซัพพลายเออร์ / ชื่อรายการ", placeholder: "พิมพ์หรือเลือก ชื่อลูกค้า / ซัพพลายเออร์ / ชื่อรายการ" },
  customer: { label: "ชื่อลูกค้า", placeholder: "พิมพ์หรือเลือกชื่อลูกค้า" },
  supplier: { label: "ชื่อซัพพลายเออร์", placeholder: "พิมพ์หรือเลือกชื่อซัพพลายเออร์" },
  item: { label: "ชื่อรายการ", placeholder: "พิมพ์หรือเลือกชื่อรายการ" },
};

/** ตัวเลือกในช่องคู่ค้า เฉพาะกลุ่มของประเภทที่เลือก */
function getFilteredPartyOptions() {
  const group = PARTY_GROUPS[partyTypeSelect.value];
  const options = getPartyOptions();
  return group ? options.filter((option) => option.group === group) : options;
}

/**
 * แปลงข้อความในช่องคู่ค้าเป็นค่าภายใน โดยคำนึงถึงประเภทที่เลือก
 * - ประเภท "ชื่อรายการ" → ข้อความที่พิมพ์เป็นชื่อรายการเสมอ (ไม่เข้าทะเบียนลูกหนี้/เจ้าหนี้)
 * - ประเภทลูกค้า/ซัพพลายเออร์ → ไม่ตีความเป็นชื่อรายการ
 * @returns {string}
 */
function resolvePartyInput() {
  const text = partyInput.value.trim();
  if (!text) return "";
  const partyType = partyTypeSelect.value;
  if (partyType === "item") return `item:${text}`;
  // ชื่อตรงกับตัวเลือกในกลุ่มที่เลือก → ใช้ตัวนั้น (ลูกค้าและซัพพลายเออร์ชื่อเดียวกันได้ เช่น "ปัญญา")
  const exactOption = getFilteredPartyOptions().find((option) => option.label === text);
  if (exactOption) return exactOption.value;
  const value = resolvePartyText(text);
  return partyType && parseItemOptionValue(value) ? `name:${text}` : value;
}

/** ประเภทของค่าในช่องคู่ค้า (ใช้ตั้งช่องประเภทตอนเปิดรายการเดิม) */
function detectPartyType(text) {
  // ชื่อตรงกับตัวเลือก: มีกลุ่มเดียว → ใช้กลุ่มนั้น / หลายกลุ่ม (ลูกค้าและซัพพลายเออร์ชื่อเดียวกัน) → ไม่เดา
  const label = String(text || "").trim();
  const matchedTypes = [...new Set(getPartyOptions()
    .filter((option) => option.label === label)
    .map((option) => Object.keys(PARTY_GROUPS).find((type) => PARTY_GROUPS[type] === option.group))
    .filter(Boolean))];
  if (matchedTypes.length === 1) return matchedTypes[0];
  if (matchedTypes.length > 1) return matchedTypes.includes(partyTypeSelect.value) ? partyTypeSelect.value : "";
  const value = resolvePartyText(text);
  if (!value) return "";
  const option = getPartyOptions().find((item) => item.value === value);
  return Object.keys(PARTY_GROUPS).find((type) => PARTY_GROUPS[type] === option?.group) || "";
}

function syncPartyTypeTexts() {
  const texts = PARTY_TYPE_TEXTS[partyTypeSelect.value] || PARTY_TYPE_TEXTS[""];
  partyLabel.textContent = texts.label;
  partyInput.placeholder = texts.placeholder;
}

/** ประเภทในช่อง "ประเภท" ถูกเลือกให้อัตโนมัติจากชื่อ (true) หรือผู้ใช้เลือกเอง (false) */
let isPartyTypeAuto = false;

/** ชื่อใหม่ที่ยังไม่ได้เลือกประเภท → ไฮไลต์ช่องประเภทให้ผู้ใช้เลือก */
function updatePartyTypeWarning() {
  const needsChoice = Boolean(partyInput.value.trim()) && !partyTypeSelect.value;
  partyTypeSelect.classList.toggle("needs-choice", needsChoice);
  partyTypeSelect.setAttribute("aria-invalid", String(needsChoice));
  partyTypeSelect.title = needsChoice ? "ชื่อนี้ยังไม่มีในรายการ — กรุณาเลือกประเภท" : "";
}

function setPartyType(type, isAuto) {
  partyTypeSelect.value = type;
  isPartyTypeAuto = isAuto;
  syncPartyTypeTexts();
  updatePartyTypeWarning();
}

/**
 * ตั้งประเภทตามชื่อที่พิมพ์
 * - ชื่อตรงกับรายการที่มีอยู่ → เลือกประเภทให้อัตโนมัติ (ยกเว้นผู้ใช้เลือกประเภทไว้เองแล้ว)
 * - ชื่อใหม่ (ไม่ตรง) และประเภทเคยถูกเลือกอัตโนมัติ → ล้างประเภท บังคับให้ผู้ใช้เลือกเอง
 * @param {boolean} isFinal true = พิมพ์เสร็จแล้ว (ออกจากช่อง), false = ระหว่างพิมพ์ (ตั้งเฉพาะเมื่อตรง)
 */
function autoDetectPartyType(isFinal) {
  const text = partyInput.value.trim();
  const canOverride = !partyTypeSelect.value || isPartyTypeAuto;
  const detectedType = text ? detectPartyType(text) : "";
  if (detectedType) {
    if (canOverride && detectedType !== partyTypeSelect.value) setPartyType(detectedType, true);
    else updatePartyTypeWarning();
    return;
  }
  if (!isFinal) return;
  if (isPartyTypeAuto) setPartyType("", false);
  else updatePartyTypeWarning();
}

/** ช่องคู่ค้า: พิมพ์ได้ + มีรายการให้เลือก 3 กลุ่ม (ชื่อลูกค้า / ชื่อซัพพลายเออร์ / ชื่อรายการ) กรองตามประเภทได้ */
const partyCombobox = createCombobox({
  input: partyInput,
  getOptions: getFilteredPartyOptions,
  onSelect: (option) => {
    // เลือกจากรายการ → รู้ประเภทจากกลุ่มของตัวเลือก
    const type = Object.keys(PARTY_GROUPS).find((key) => PARTY_GROUPS[key] === option.group) || "";
    if (type && type !== partyTypeSelect.value) setPartyType(type, true);
    else updatePartyTypeWarning();
    applyAutoDescription(option.value);
  },
});

partyTypeSelect.addEventListener("change", () => {
  isPartyTypeAuto = false; // ผู้ใช้เลือกเอง
  syncPartyTypeTexts();
  updatePartyTypeWarning();
  // ชื่อเดิมไม่ใช่ประเภทที่เลือกแล้ว → ล้างออก ให้เลือกใหม่
  const currentType = detectPartyType(partyInput.value);
  if (partyTypeSelect.value && currentType && currentType !== partyTypeSelect.value) partyInput.value = "";
  lastAutoFilledParty = "";
  partyInput.focus();
  partyCombobox.open(partyInput.value);
});

function setEditingMode(isEditing, entryLabel = "") {
  entryForm.classList.toggle("is-editing", isEditing);
  byId("journal-form-title").textContent = isEditing ? `แก้ไขรายการ ${entryLabel}`.trim() : "บันทึกรายการใหม่";
  submitButton.textContent = isEditing ? "บันทึกการแก้ไข" : "บันทึกรายการ";
  cancelEditButton.hidden = !isEditing;
}

/** รูปแบบเลขที่อัตโนมัติ JV-YYYYMM-#### (กลุ่มที่ 1 = ปีเดือน) */
const AUTO_DOCUMENT_NUMBER_PATTERN = /^JV-(\d{6})-\d+$/;

/**
 * เติมเลขที่เอกสารถัดไปตามเดือนของวันที่ที่เลือก
 * - ผู้ใช้ยังไม่ได้พิมพ์เอง → สร้างเลขใหม่เสมอ
 * - เลขเดิมเป็นรูปแบบอัตโนมัติแต่คนละเดือนกับวันที่ (รวมถึงตอนแก้ไขรายการ) → เปลี่ยนเป็นเลขของเดือนใหม่
 * - เลขที่พิมพ์เองแบบอื่น หรือเดือนตรงกันอยู่แล้ว → คงไว้
 */
function suggestDocumentNumber() {
  const currentNumber = documentNumberInput.value.trim();
  const autoMatch = currentNumber.match(AUTO_DOCUMENT_NUMBER_PATTERN);
  const selectedMonth = (toIsoDate(dateInput.value) || "").slice(0, 7).replace("-", "");
  const isOtherMonth = Boolean(autoMatch && selectedMonth && autoMatch[1] !== selectedMonth);
  if (isDocumentNumberManual && !isOtherMonth) return;
  documentNumberInput.value = createJournalNumber(dateInput.value, editingEntryId || "");
  if (isOtherMonth) isDocumentNumberManual = false;
}

/**
 * เมื่อตัวกรองรายการเลือกไว้ 1 เดือน (เช่น เดือนล่าสุด หรือกด "เดือนนี้") และฟอร์มยังว่างอยู่
 * → เลื่อนวันที่ในฟอร์มไปเดือนนั้น เพื่อให้เลขที่เอกสารเป็นของเดือนที่กำลังดู
 */
function syncFormDateWithFilterMonth() {
  if (editingEntryId || hasUnsavedChanges) return;
  const from = filterInputs.from.value;
  const to = filterInputs.to.value;
  if (!from || !to || from.slice(0, 7) !== to.slice(0, 7)) return;
  const month = from.slice(0, 7);
  if ((toIsoDate(dateInput.value) || "").startsWith(month)) return;

  // วันนี้อยู่ในเดือนนั้น → ใช้วันนี้, ไม่เช่นนั้นใช้วันที่ล่าสุดที่มีรายการในเดือนนั้น (หรือวันที่ 1)
  const today = getTodayIso();
  let nextDate = today.startsWith(month) ? today : "";
  if (!nextDate) {
    state.entries.forEach((entry) => {
      const isoDate = toIsoDate(entry.date);
      if (isoDate.startsWith(month) && isoDate > nextDate) nextDate = isoDate;
    });
  }
  dateInput.value = nextDate || from;
  suggestDocumentNumber();
}

/**
 * ล้างฟอร์มเพื่อบันทึกรายการใหม่
 * @param {{ keepDate?: boolean }} [options] keepDate = คงวันที่เดิมไว้ (สะดวกเมื่อบันทึกหลายรายการวันเดียวกัน)
 */
function resetForm({ keepDate = false } = {}) {
  editingEntryId = null;
  isDocumentNumberManual = false;
  hasUnsavedChanges = false;
  if (!keepDate || !dateInput.value) dateInput.value = getTodayIso();
  descriptionInput.value = "";
  partyInput.value = "";
  // บันทึกหลายรายการติดกัน (keepDate) → คงประเภทที่ผู้ใช้เลือกเองไว้ (ประเภทที่ตั้งอัตโนมัติจากชื่อเดิมล้างออก)
  if (!keepDate || isPartyTypeAuto) setPartyType("", false);
  else updatePartyTypeWarning();
  dueDateInput.value = "";
  lastAutoFilledParty = "";
  kindSelect.value = "general";
  setEditingMode(false);
  replaceLines();
  suggestDocumentNumber();
}

/**
 * เติมฟอร์มจากรายการที่บันทึกไว้
 * @param {object} entry
 * @param {"edit" | "copy" | "reverse"} mode
 *   edit    = แก้ไขรายการเดิม
 *   copy    = สร้างรายการใหม่ที่เหมือนเดิม (วันที่วันนี้)
 *   reverse = สร้างรายการกลับบัญชี (สลับเดบิต/เครดิต) เพื่อยกเลิกรายการเดิมโดยไม่ต้องลบ
 */
function fillFormFromEntry(entry, mode) {
  const isEditMode = mode === "edit";
  editingEntryId = isEditMode ? entry.id : null;
  dateInput.value = isEditMode ? toIsoDate(entry.date) || entry.date || "" : getTodayIso();
  isDocumentNumberManual = isEditMode && Boolean(entry.docNo);
  documentNumberInput.value = isEditMode ? entry.docNo || "" : "";
  kindSelect.value = isEditMode ? getEntryKind(entry) : "general";
  descriptionInput.value = mode === "reverse"
    ? `กลับรายการ ${entry.docNo || ""} ${entry.desc || ""}`.replace(/\s+/g, " ").trim()
    : entry.desc || "";
  partyInput.value = toPartyText(entry);
  // ประเภทที่บันทึกไว้กับรายการ ถือเป็นการเลือกของผู้ใช้ (ไม่ถูกเปลี่ยนอัตโนมัติ)
  setPartyType(entry.itemName && !entry.customerName ? "item" : entry.partyType || detectPartyType(partyInput.value), false);
  dueDateInput.value = isEditMode ? toIsoDate(entry.due) : "";
  lastAutoFilledParty = "";

  const lines = mode === "reverse"
    ? entry.lines.map((line) => ({ accountId: line.accountId, debit: line.credit, credit: line.debit }))
    : entry.lines;
  replaceLines(lines);
  setEditingMode(isEditMode, entry.docNo || formatDate(entry.date));
  if (!isEditMode) suggestDocumentNumber();
  hasUnsavedChanges = !isEditMode;
  entryForm.scrollIntoView({ behavior: "smooth", block: "start" });

  if (mode === "reverse") notify("สร้างรายการกลับบัญชีแล้ว ตรวจสอบและกดบันทึก");
  else if (mode === "copy") notify("คัดลอกรายการแล้ว ตรวจสอบและกดบันทึก");
}

/** คู่ค้าล่าสุดที่เติมคำอธิบายอัตโนมัติไปแล้ว (กันการเติมซ้ำทุกครั้งที่พิมพ์) */
let lastAutoFilledParty = "";

/**
 * เลือก/พิมพ์คู่ค้าหรือชื่อรายการที่มีแม่แบบคำอธิบายอัตโนมัติ → เติมคำอธิบาย บัญชีเดบิต (บรรทัด 1) และบัญชีเครดิต (บรรทัด 2)
 * @param {string} partyOptionValue ค่าคู่ค้า เช่น "id:abc", "name:ร้านสมใจ" หรือ "item:ค่าไฟฟ้า"
 */
function applyAutoDescription(partyOptionValue) {
  const itemName = parseItemOptionValue(partyOptionValue);
  const { customerId, customerName } = itemName ? { customerId: "", customerName: "" } : parseCustomerOptionValue(partyOptionValue);
  if (!customerId && !customerName && !itemName) return;
  const rule = itemName
    ? state.autoDesc.find((item) => String(item.itemName || "").trim() === itemName)
    : state.autoDesc.find((item) => !item.itemName
      && ((customerId && item.customerId === customerId) || (customerName && item.customerName === customerName)));
  const partyKey = `${customerId}|${customerName}|${itemName}`;
  if (!rule || partyKey === lastAutoFilledParty) return;
  lastAutoFilledParty = partyKey;

  descriptionInput.value = rule.text || "";
  const [debitRow, creditRow] = getLineRows();
  if (debitRow && rule.debitAccountId) debitRow.querySelector(".journal-line-account").value = rule.debitAccountId;
  if (creditRow && rule.creditAccountId) creditRow.querySelector(".journal-line-account").value = rule.creditAccountId;
  notify("เติมคำอธิบายและบัญชีจากคำอธิบายอัตโนมัติแล้ว");
}

/**
 * อ่านและตรวจสอบฟอร์ม
 * @returns {{ error: string, focusElement?: HTMLElement } | { entryData: object }}
 */
function readEntryForm() {
  if (!dateInput.value) return { error: "กรุณาระบุวันที่", focusElement: dateInput };

  const originalEntry = editingEntryId ? state.entries.find((entry) => entry.id === editingEntryId) : null;
  if (isDateLocked(dateInput.value) || (originalEntry && isDateLocked(originalEntry.date))) {
    return { error: getLockedPeriodMessage(), focusElement: dateInput };
  }
  if (!descriptionInput.value.trim()) return { error: "กรุณาระบุคำอธิบายรายการ", focusElement: descriptionInput };

  const lines = [];
  for (const row of getLineRows()) {
    const accountSelect = row.querySelector(".journal-line-account");
    const debit = readAmount(row.querySelector(".journal-line-debit"));
    const credit = readAmount(row.querySelector(".journal-line-credit"));
    if (!debit && !credit) continue; // บรรทัดว่างไม่บันทึก
    if (!accountSelect.value) return { error: "มีบรรทัดที่กรอกจำนวนเงินแต่ยังไม่ได้เลือกบัญชี", focusElement: accountSelect };
    if (debit < 0 || credit < 0) return { error: "จำนวนเงินต้องไม่ติดลบ" };
    if (debit > 0 && credit > 0) return { error: "แต่ละบรรทัดใส่ได้เฉพาะเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง" };
    lines.push({ accountId: accountSelect.value, debit, credit });
  }
  if (lines.length < 2) return { error: "ต้องมีอย่างน้อย 2 บรรทัดที่มีจำนวนเงิน" };
  if (!lines.some((line) => line.debit > 0) || !lines.some((line) => line.credit > 0)) return { error: "ต้องมีทั้งด้านเดบิตและด้านเครดิต" };
  if (!updateBalanceStatus()) return { error: "ยอดเดบิตและเครดิตต้องเท่ากัน — กด “ปรับยอดให้ดุล” หรือแก้ไขจำนวนเงิน" };

  // รายการลูกหนี้/เจ้าหนี้ต้องรู้ว่าเป็นของใคร จึงจะติดตามยอดค้างในทะเบียนได้
  const partyValue = resolvePartyInput();
  const itemName = parseItemOptionValue(partyValue);
  const party = itemName ? { customerId: "", customerName: "" } : parseCustomerOptionValue(partyValue);

  // ชื่อใหม่ที่ยังไม่มีในรายการ → ต้องเลือกประเภท เพื่อจัดกลุ่มและสร้างแม่แบบคำอธิบายอัตโนมัติให้ถูกประเภท
  const partyType = partyTypeSelect.value;
  const isNewParty = Boolean(partyValue) && !getPartyOptions().some((option) => option.value === partyValue);
  if (isNewParty && !partyType) {
    return {
      error: `“${partyInput.value.trim()}” ยังไม่มีในรายการ — กรุณาเลือกประเภท (ลูกค้า / ซัพพลายเออร์ / ชื่อรายการ)`,
      focusElement: partyTypeSelect,
    };
  }
  const controlType = lines.map((line) => getControlAccountType(line.accountId)).find(Boolean);
  if (controlType && !party.customerName) {
    const isReceivable = controlType === "receivable";
    return {
      error: `รายการนี้ใช้บัญชี${isReceivable ? "ลูกหนี้" : "เจ้าหนี้"}การค้า กรุณาระบุคู่ค้า (${isReceivable ? "ลูกค้า" : "ผู้ขาย"})`,
      focusElement: partyInput,
    };
  }

  const documentNumber = documentNumberInput.value.trim() || createJournalNumber(dateInput.value, editingEntryId || "");
  if (state.entries.some((entry) => entry.docNo === documentNumber && entry.id !== editingEntryId)) {
    return { error: `เลขที่เอกสาร ${documentNumber} ถูกใช้แล้ว`, focusElement: documentNumberInput };
  }

  return {
    entryData: {
      date: dateInput.value,
      due: dueDateInput.value,
      docNo: documentNumber,
      kind: kindSelect.value || "general",
      desc: descriptionInput.value.trim(),
      lines,
      customerId: party.customerId,
      customerName: party.customerName,
      itemName,
      // ชื่อคู่ค้าที่ไม่มีในทะเบียน: จำประเภทไว้ (ใช้จัดกลุ่มลูกค้า/ซัพพลายเออร์ในช่องคู่ค้า)
      partyType: !party.customerId && party.customerName && (partyType === "customer" || partyType === "supplier") ? partyType : "",
    },
    isNewParty,
  };
}

/**
 * ชื่อใหม่ (ลูกค้า / ซัพพลายเออร์ / ชื่อรายการ) → สร้างแม่แบบคำอธิบายอัตโนมัติจากรายการนี้
 * ใช้คำอธิบาย บัญชีเดบิตบรรทัดแรก และบัญชีเครดิตบรรทัดแรก
 * @param {object} entryData ผลจาก readEntryForm
 * @returns {object | null} แม่แบบใหม่ หรือ null ถ้ามีแม่แบบของชื่อนี้อยู่แล้ว
 */
function buildTemplateForNewParty(entryData) {
  const { customerId, customerName, itemName, partyType, desc, lines } = entryData;
  const debitLine = lines.find((line) => line.debit > 0);
  const creditLine = lines.find((line) => line.credit > 0);
  if (!desc || !debitLine || !creditLine || (!customerName && !itemName)) return null;
  const hasTemplate = state.autoDesc.some((rule) => {
    if (itemName) return String(rule.itemName || "").trim() === itemName;
    if (rule.itemName) return false;
    return customerId ? rule.customerId === customerId : !rule.customerId && rule.customerName === customerName;
  });
  if (hasTemplate) return null;
  let partyFields;
  if (itemName) partyFields = { itemName };
  else if (customerId) partyFields = { customerId, customerName }; // คู่ค้าในทะเบียน (เช่น ซัพพลายเออร์ที่เพิ่งเพิ่ม)
  else partyFields = { customerName, ...(partyType ? { partyType } : {}) };
  return {
    id: createId(),
    debitAccountId: debitLine.accountId,
    creditAccountId: creditLine.accountId,
    text: desc,
    ...partyFields,
  };
}

/**
 * ชื่อลูกค้าที่พิมพ์ใหม่ (ประเภท "ลูกค้า" และยังไม่มีในรายชื่อลูกค้า) → เพิ่มเข้ารายชื่อลูกค้าพร้อมรหัสใหม่
 * เพื่อให้ชื่อขึ้นในหน้ารายชื่อลูกค้า และตัวเลือกลูกค้าของทุกหน้า
 * @param {object} entryData ผลจาก readEntryForm
 * @returns {object | null} รายชื่อลูกค้าใหม่ หรือ null ถ้าไม่ต้องเพิ่ม
 */
function buildCustomerRecordForNewName(entryData) {
  const name = String(entryData.customerName || "").trim();
  if (entryData.partyType !== "customer" || entryData.customerId || !name) return null;
  const isListed = [...state.customers, ...state.customerNames].some((record) => String(record.name || "").trim() === name);
  if (isListed) return null;
  return { code: createCustomerCodes()[0], name, fileId: null };
}

/**
 * ชื่อซัพพลายเออร์ที่พิมพ์ใหม่ (ประเภท "ซัพพลายเออร์" และยังไม่มีในทะเบียน) → เพิ่มเข้าทะเบียนซัพพลายเออร์พร้อมรหัสใหม่
 * รายการบัญชีจะอ้างซัพพลายเออร์ใหม่ด้วย id เหมือนเลือกจากทะเบียน (ทะเบียนเจ้าหนี้จับคู่ยอดได้ถูกราย)
 * @param {object} entryData ผลจาก readEntryForm
 * @returns {object | null} ซัพพลายเออร์ใหม่ หรือ null ถ้าไม่ต้องเพิ่ม
 */
function buildSupplierForNewName(entryData) {
  const name = String(entryData.customerName || "").trim();
  if (entryData.partyType !== "supplier" || entryData.customerId || !name) return null;
  if ((state.suppliers || []).some((supplier) => String(supplier.name || "").trim() === name)) return null;
  return { id: createId(), code: createSupplierCode(), name };
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const result = readEntryForm();
  if (result.error) {
    await notifyError(result.error, { title: "ยังบันทึกรายการไม่ได้" });
    result.focusElement?.focus();
    return;
  }

  const newSupplier = buildSupplierForNewName(result.entryData);
  if (newSupplier) {
    // อ้างซัพพลายเออร์ใหม่ด้วย id (ไม่ใช่ชื่อลอย ๆ) เหมือนเลือกจากทะเบียน
    result.entryData = { ...result.entryData, customerId: newSupplier.id, customerName: formatCustomerLabel(newSupplier), partyType: "" };
  }
  const newTemplate = result.isNewParty ? buildTemplateForNewParty(result.entryData) : null;
  const newCustomerRecord = buildCustomerRecordForNewName(result.entryData);
  const { customerId, customerName, itemName, partyType, due, ...entryFields } = result.entryData;
  // ฟิลด์ที่ไม่บังคับ: ใส่เฉพาะเมื่อมีค่า
  const optionalFields = {
    ...(customerId ? { customerId } : {}),
    ...(customerName ? { customerName } : {}),
    ...(itemName ? { itemName } : {}),
    ...(partyType ? { partyType } : {}),
    ...(due ? { due } : {}),
  };
  const now = new Date().toISOString();
  const isEditing = Boolean(editingEntryId);

  const editedEntryId = editingEntryId;
  let savedEntry;
  let entries;
  if (isEditing) {
    entries = state.entries.map((entry) => {
      if (entry.id !== editingEntryId) return entry;
      // ลบคู่ค้า/วันครบกำหนดเดิมออกก่อน เผื่อผู้ใช้ลบค่าออก
      const {
        customerId: _oldCustomerId, customerName: _oldCustomerName, itemName: _oldItemName,
        partyType: _oldPartyType, due: _oldDue, ...baseEntry
      } = entry;
      savedEntry = { ...baseEntry, ...entryFields, ...optionalFields, updatedAt: now };
      return savedEntry;
    });
  } else {
    // ต่อท้ายอาร์เรย์ (ไม่เรียงใหม่) → การบันทึกส่งเฉพาะ chunk สุดท้ายซึ่งเล็ก จึงเร็ว
    // ทุกหน้าที่แสดงผลเรียงตามวันที่เองอยู่แล้ว
    savedEntry = { id: createId(), ...entryFields, ...optionalFields, createdAt: now };
    entries = [...state.entries, savedEntry];
  }

  // บันทึกแบบทันที: แสดงผลและล้างฟอร์มให้กรอกรายการถัดไปได้เลย ส่วนการส่งขึ้นเซิร์ฟเวอร์ทำเบื้องหลัง
  // ชื่อใหม่ → บันทึกแม่แบบคำอธิบายอัตโนมัติไปพร้อมกัน (สำเร็จหรือไม่สำเร็จพร้อมรายการ)
  // ชื่อลูกค้าใหม่ → เพิ่มเข้ารายชื่อลูกค้าไปพร้อมกัน
  const savePromise = commitChanges({
    entries,
    ...(newTemplate ? { autoDesc: [...state.autoDesc, newTemplate] } : {}),
    ...(newCustomerRecord ? { customerNames: [...state.customerNames, newCustomerRecord] } : {}),
    ...(newSupplier ? { suppliers: [...(state.suppliers || []), newSupplier] } : {}),
  });
  if (newTemplate) {
    notify(`บันทึกแม่แบบคำอธิบายอัตโนมัติของ “${newTemplate.itemName || newTemplate.customerName}” แล้ว`);
  }
  if (newCustomerRecord) {
    notify(`เพิ่ม “${newCustomerRecord.code} - ${newCustomerRecord.name}” เข้ารายชื่อลูกค้าแล้ว`);
  }
  if (newSupplier) {
    notify(`เพิ่ม “${formatCustomerLabel(newSupplier)}” เข้ารายชื่อซัพพลายเออร์แล้ว`);
  }
  monthFilter?.refresh(); // รายการเดือนใหม่จะขึ้นในตัวเลือกเดือนทันที
  resetForm({ keepDate: true });
  renderEntryList();
  renderMissingNumberBanner();
  notifySuccess(`${isEditing ? "แก้ไข" : "บันทึก"}รายการ ${entryFields.docNo} แล้ว`);
  descriptionInput.focus();

  if (await savePromise) return;
  // ส่งขึ้นเซิร์ฟเวอร์ไม่สำเร็จ: รายการถูกคืนค่าแล้ว → นำข้อมูลกลับมาใส่ฟอร์มให้กดบันทึกใหม่ได้ทันที
  renderEntryList();
  renderMissingNumberBanner();
  restoreFailedEntry(savedEntry, editedEntryId);
}

/**
 * นำรายการที่ส่งขึ้นเซิร์ฟเวอร์ไม่สำเร็จกลับมาใส่ฟอร์ม (ถ้าผู้ใช้ยังไม่ได้เริ่มกรอกรายการใหม่)
 * @param {object} failedEntry ข้อมูลที่พยายามบันทึก
 * @param {string | null} editedEntryId id ของรายการเดิม (กรณีแก้ไข)
 */
function restoreFailedEntry(failedEntry, editedEntryId) {
  const message = `รายการ ${failedEntry.docNo || ""} ${failedEntry.desc || ""}`.replace(/\s+/g, " ").trim();
  if (hasUnsavedChanges || editingEntryId) {
    notify(`${message} ยังไม่ถูกบันทึก — กรุณาบันทึกใหม่อีกครั้ง`);
    return;
  }
  const isEditing = Boolean(editedEntryId && state.entries.some((entry) => entry.id === editedEntryId));
  fillFormFromEntry(isEditing ? { ...failedEntry, id: editedEntryId } : failedEntry, isEditing ? "edit" : "restore");
  if (!isEditing) {
    // fillFormFromEntry แบบคัดลอกใช้วันที่วันนี้ → ใส่ค่าที่ผู้ใช้กรอกไว้กลับคืน
    dateInput.value = toIsoDate(failedEntry.date) || dateInput.value;
    documentNumberInput.value = failedEntry.docNo || "";
    isDocumentNumberManual = Boolean(failedEntry.docNo);
    kindSelect.value = getEntryKind(failedEntry);
    dueDateInput.value = toIsoDate(failedEntry.due) || "";
  }
  // ป๊อปอัปข้อผิดพลาดแสดงจากระบบบันทึกแล้ว ที่นี่แจ้งเพิ่มแบบไม่ขัดจังหวะ
  notify(`${message} ยังไม่ถูกบันทึก — นำข้อมูลกลับมาใส่ฟอร์มแล้ว กด "บันทึกรายการ" อีกครั้ง`);
}

/* ================================================================== */
/* รายการที่บันทึกแล้ว                                                    */
/* ================================================================== */

/** ข้อความรวมของรายการ สำหรับค้นหา (เลขที่ คำอธิบาย ลูกค้า วันที่ ยอดเงิน และบัญชี) */
function buildSearchText(entry) {
  const accountTexts = entry.lines.map((line) => {
    const account = findAccountById(line.accountId);
    return account ? `${account.code} ${account.name}` : "";
  });
  return [entry.docNo, entry.desc, entry.customerName, entry.itemName, formatDate(entry.date), String(calculateEntryTotal(entry)), ...accountTexts]
    .join(" ")
    .toLowerCase();
}

function getFilteredEntries() {
  const searchText = listFilters.searchText.toLowerCase();
  return state.entries.filter((entry) => {
    if (listFilters.kind && getEntryKind(entry) !== listFilters.kind) return false;
    if (listFilters.from || listFilters.to) {
      const isoDate = toIsoDate(entry.date);
      if (!isoDate || (listFilters.from && isoDate < listFilters.from) || (listFilters.to && isoDate > listFilters.to)) return false;
    }
    return !searchText || buildSearchText(entry).includes(searchText);
  });
}

/**
 * ปุ่มจัดการของแต่ละรายการ: แก้ไข, ลบ และเมนู "⋯" (คัดลอก / กลับรายการ)
 * รายการในงวดที่ล็อกแล้วแก้ไข/ลบไม่ได้ รายการปิดบัญชีแก้ไขไม่ได้ (ลบแล้วสร้างใหม่ที่หน้าการตั้งค่า)
 */
function renderEntryActions(entry) {
  const isLocked = isDateLocked(entry.date);
  const isClosingEntry = entry.source?.type === "closing";
  const lockedAttributes = isLocked ? ' disabled title="อยู่ในงวดที่ปิดแล้ว"' : "";
  let editAttributes = lockedAttributes;
  if (!editAttributes && isClosingEntry) editAttributes = ' disabled title="รายการปิดบัญชี ลบแล้วสร้างใหม่ได้ที่หน้าการตั้งค่า"';
  const entryId = escapeHtml(entry.id);

  return `<div class="actions-cell journal-row-actions">
    <button type="button" class="small secondary" data-edit-entry="${entryId}"${editAttributes}>แก้ไข</button>
    <button type="button" class="small danger" data-delete-entry="${entryId}"${lockedAttributes}>ลบ</button>
    <div class="more-menu">
      <button type="button" class="small ghost more-menu-button" data-toggle-menu aria-haspopup="menu" aria-expanded="false" title="คำสั่งเพิ่มเติม">⋯</button>
      <div class="more-menu-list" role="menu">
        <button type="button" role="menuitem" data-copy-entry="${entryId}">คัดลอกเป็นรายการใหม่</button>
        <button type="button" role="menuitem" data-reverse-entry="${entryId}">กลับรายการ</button>
      </div>
    </div>
  </div>`;
}

/** ปิดเมนู "⋯" ทั้งหมดที่เปิดอยู่ */
function closeAllMenus() {
  document.querySelectorAll(".more-menu.is-open").forEach((menu) => {
    menu.classList.remove("is-open");
    menu.querySelector("[data-toggle-menu]").setAttribute("aria-expanded", "false");
  });
}

/** เปิด/ปิดเมนู "⋯" โดยวางเมนูไว้ใต้ปุ่ม ชิดขวา (ใช้ตำแหน่ง fixed ไม่ให้ถูกกล่องตารางตัด) */
function toggleMenu(toggleButton) {
  const menu = toggleButton.closest(".more-menu");
  const shouldOpen = !menu.classList.contains("is-open");
  closeAllMenus();
  if (!shouldOpen) return;
  menu.classList.add("is-open");
  toggleButton.setAttribute("aria-expanded", "true");
  const buttonRect = toggleButton.getBoundingClientRect();
  const menuList = menu.querySelector(".more-menu-list");
  menuList.style.top = `${buttonRect.bottom + 4}px`;
  menuList.style.left = `${Math.max(8, buttonRect.right - menuList.offsetWidth)}px`;
}

/** ป้ายสถานะใต้รายการ: ล็อก / ครบกำหนด / ประเภท / ไม่ดุล / คู่ค้า */
function renderEntryBadges(entry) {
  const totalDebit = entry.lines.reduce((total, line) => total + (Number(line.debit) || 0), 0);
  const totalCredit = entry.lines.reduce((total, line) => total + (Number(line.credit) || 0), 0);
  const entryKind = getEntryKind(entry);
  return [
    isDateLocked(entry.date) ? '<span class="badge" title="อยู่ในงวดที่ปิดแล้ว">🔒 ปิดงวด</span>' : "",
    entry.due ? `<span class="badge warning" title="วันครบกำหนดชำระ">ครบกำหนด ${escapeHtml(formatDate(entry.due))}</span>` : "",
    entryKind !== "general" ? `<span class="badge info">${ENTRY_KIND_LABELS[entryKind]}</span>` : "",
    Math.abs(totalDebit - totalCredit) >= AMOUNT_EPSILON ? '<span class="badge danger">ไม่ดุล</span>' : "",
    entry.customerName ? `<span class="badge">${escapeHtml(entry.customerName)}</span>` : "",
    entry.itemName ? `<span class="badge info" title="ชื่อรายการ">${escapeHtml(entry.itemName)}</span>` : "",
  ].join(" ");
}

/**
 * หนึ่งรายการในรูปแบบสมุดรายวันทั่วไป: บรรทัดเดบิตก่อน บรรทัดเครดิตย่อหน้า แล้วตามด้วยคำอธิบายในวงเล็บ
 * (แต่ละรายการเป็น <tbody> ของตัวเอง เพื่อจัดรูปแบบเป็นกลุ่มได้)
 */
function renderEntryRows(entry) {
  const isDebitLine = (line) => Number(line.debit) > 0;
  const orderedLines = [...entry.lines.filter(isDebitLine), ...entry.lines.filter((line) => !isDebitLine(line))];
  const lineRows = orderedLines.map((line, lineIndex) => {
    const account = findAccountById(line.accountId);
    const isFirstLine = lineIndex === 0;
    const accountName = account ? escapeHtml(account.name) : '<span class="unbalanced">(บัญชีถูกลบ)</span>';
    return `<tr>
      <td class="nowrap">${isFirstLine ? escapeHtml(formatDate(entry.date) || "ไม่ระบุวันที่") : ""}</td>
      <td>${isFirstLine ? `<span class="journal-doc-number">${escapeHtml(entry.docNo || "-")}</span>` : ""}</td>
      <td class="${isDebitLine(line) ? "" : "journal-credit-line"}">${accountName}</td>
      <td class="code center">${account ? escapeHtml(account.code) : ""}</td>
      <td class="right">${line.debit ? formatMoney(line.debit) : ""}</td>
      <td class="right">${line.credit ? formatMoney(line.credit) : ""}</td>
      <td class="right">${isFirstLine ? renderEntryActions(entry) : ""}</td>
    </tr>`;
  }).join("");
  const memoRow = `<tr class="journal-memo-row"><td></td><td></td><td colspan="5">(${escapeHtml(entry.desc || "ไม่มีคำอธิบาย")}) ${renderEntryBadges(entry)}</td></tr>`;
  return `<tbody class="journal-table-entry">${lineRows}${memoRow}</tbody>`;
}

function renderEntryList() {
  const listContainer = byId("journal-list");
  const filteredEntries = getFilteredEntries();
  const filteredTotal = filteredEntries.reduce((total, entry) => total + calculateEntryTotal(entry), 0);
  const isFiltered = listFilters.from || listFilters.to || listFilters.searchText || listFilters.kind;
  byId("journal-filter-summary").textContent = isFiltered
    ? `แสดง ${formatNumber(filteredEntries.length)} จาก ${formatNumber(state.entries.length)} รายการ · ยอดรวม ${formatMoney(filteredTotal)}`
    : `ทั้งหมด ${formatNumber(filteredEntries.length)} รายการ · ยอดรวม ${formatMoney(filteredTotal)}`;

  if (!state.entries.length) {
    listContainer.innerHTML = '<div class="empty-state"><strong>ยังไม่มีรายการบันทึก</strong>กรอกฟอร์มด้านบนเพื่อบันทึกรายการแรก</div>';
    return;
  }
  if (!filteredEntries.length) {
    listContainer.innerHTML = '<div class="empty-state"><strong>ไม่พบรายการ</strong>ลองเปลี่ยนช่วงวันที่หรือคำค้นหา</div>';
    return;
  }

  // ล่าสุดอยู่บน: เรียงวันที่จากใหม่ไปเก่า แล้วตามเลขที่เอกสาร
  const sortedEntries = filteredEntries.slice().sort((leftEntry, rightEntry) =>
    (toIsoDate(rightEntry.date) || "").localeCompare(toIsoDate(leftEntry.date) || "")
    || String(rightEntry.docNo || "").localeCompare(String(leftEntry.docNo || ""), "th-TH", { numeric: true }));
  const visibleEntries = sortedEntries.slice(0, visibleEntryLimit);
  const sumLines = (field) => visibleEntries.reduce(
    (total, entry) => total + entry.lines.reduce((entryTotal, line) => entryTotal + (Number(line[field]) || 0), 0), 0);
  const remainingCount = sortedEntries.length - visibleEntryLimit;

  listContainer.innerHTML = `<div class="table-wrap"><table class="journal-table">
      <thead><tr><th class="col-date">วันที่</th><th style="width:140px">เลขที่</th><th>ชื่อบัญชีและคำอธิบาย</th><th class="col-code center">เลขที่บัญชี</th><th class="center col-amount">เดบิต</th><th class="center col-amount">เครดิต</th><th class="col-actions"></th></tr></thead>
      ${visibleEntries.map(renderEntryRows).join("")}
      <tfoot><tr><th colspan="4">รวม ${formatNumber(visibleEntries.length)} รายการที่แสดง</th><th class="right">${formatMoney(sumLines("debit"))}</th><th class="right">${formatMoney(sumLines("credit"))}</th><th></th></tr></tfoot>
    </table></div>
    ${remainingCount > 0 ? `<div class="load-more"><button type="button" class="secondary" id="journal-load-more">แสดงเพิ่ม (เหลืออีก ${formatNumber(remainingCount)} รายการ)</button></div>` : ""}`;

  byId("journal-load-more")?.addEventListener("click", () => {
    visibleEntryLimit += ENTRIES_PER_PAGE * 2;
    renderEntryList();
  });
}

async function deleteEntry(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;
  if (isDateLocked(entry.date)) {
    notifyError(getLockedPeriodMessage());
    return;
  }
  const confirmMessage = `ยืนยันการลบรายการ ${entry.docNo || ""} ${entry.desc || ""}? (หากต้องการเก็บประวัติ แนะนำให้ใช้ “กลับรายการ” แทน)`;
  if (!(await confirmDialog(confirmMessage.replace(/\s+/g, " ")))) return;

  // ลบออกจากหน้าจอทันที (state เปลี่ยนก่อนส่งเซิร์ฟเวอร์) ไม่ต้องรอเซิร์ฟเวอร์ตอบกลับ
  const saving = commitChanges({ entries: state.entries.filter((item) => item.id !== entryId) });
  if (editingEntryId === entryId) resetForm();
  renderEntryList();
  const isSaved = await saving;
  if (isSaved) notifySuccess("ลบรายการบันทึกเรียบร้อย");
  else renderEntryList(); // บันทึกไม่สำเร็จ → ระบบคืนค่าเดิมแล้ว วาดรายการกลับมา
}

/** คลิกปุ่มในตาราง: แก้ไข / คัดลอก / กลับรายการ / ลบ */
async function handleListClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.hasAttribute("data-toggle-menu")) {
    toggleMenu(button);
    return;
  }
  closeAllMenus();
  const { editEntry, copyEntry, reverseEntry, deleteEntry: deleteEntryId } = button.dataset;

  if (deleteEntryId) {
    deleteEntry(deleteEntryId);
    return;
  }
  const targetEntryId = editEntry || copyEntry || reverseEntry;
  const entry = targetEntryId && state.entries.find((item) => item.id === targetEntryId);
  if (!entry) return;
  if (hasUnsavedChanges) {
    const confirmed = await confirmDialog("ฟอร์มมีข้อมูลที่ยังไม่บันทึก ต้องการแทนที่หรือไม่?", { title: "ข้อมูลยังไม่ถูกบันทึก", confirmText: "แทนที่", tone: "primary" });
    if (!confirmed) return;
  }
  let mode = "reverse";
  if (editEntry) mode = "edit";
  else if (copyEntry) mode = "copy";
  fillFormFromEntry(entry, mode);
}

/* ================================================================== */
/* ตัวกรองและการส่งออก                                                    */
/* ================================================================== */

const filterInputs = {
  from: byId("journal-entry-filter-start-date"),
  to: byId("journal-entry-filter-end-date"),
  searchText: byId("journal-entry-filter-text"),
  kind: byId("journal-entry-filter-kind"),
};

/** ตัวเลือกเดือนของตัวกรองรายการ (สร้างหลังโหลดข้อมูล) */
let monthFilter = null;

function applyListFilters() {
  listFilters.from = filterInputs.from.value;
  listFilters.to = filterInputs.to.value;
  listFilters.searchText = filterInputs.searchText.value.trim();
  listFilters.kind = filterInputs.kind.value;
  visibleEntryLimit = ENTRIES_PER_PAGE;
  renderEntryList();
  syncFormDateWithFilterMonth();
}

function filterCurrentMonth() {
  const [year, month] = getTodayIso().split("-").map(Number);
  filterInputs.from.value = formatIsoDate(new Date(year, month - 1, 1));
  filterInputs.to.value = formatIsoDate(new Date(year, month, 0)); // วันสุดท้ายของเดือน
  applyListFilters();
}

function clearListFilters() {
  Object.values(filterInputs).forEach((input) => { input.value = ""; });
  applyListFilters();
}

function exportCsv() {
  const entries = getFilteredEntries();
  if (!entries.length) {
    notifyError("ไม่มีรายการให้ส่งออก");
    return;
  }
  const headers = ["วันที่", "เลขที่เอกสาร", "ประเภท", "คำอธิบาย", "ลูกค้า", "ชื่อรายการ", "รหัสบัญชี", "ชื่อบัญชี", "เดบิต", "เครดิต"];
  const rows = entries.flatMap((entry) => entry.lines.map((line) => {
    const account = findAccountById(line.accountId);
    return [
      formatDate(entry.date), entry.docNo || "", ENTRY_KIND_LABELS[getEntryKind(entry)], entry.desc || "", entry.customerName || "", entry.itemName || "",
      account?.code || "", account?.name || "(บัญชีถูกลบ)", Number(line.debit) || 0, Number(line.credit) || 0,
    ];
  }));
  downloadCsv(`journal-${getFileDateStamp()}.csv`, buildCsv(headers, rows));
  notifySuccess(`ส่งออก ${formatNumber(entries.length)} รายการ`);
}

/* ================================================================== */
/* เลขที่เอกสารให้รายการเก่า                                               */
/* ================================================================== */

/** แถบแจ้งเตือน + ปุ่มสร้างเลขที่ให้รายการที่ยังไม่มีเลขที่เอกสาร */
function renderMissingNumberBanner() {
  byId("doc-number-banner")?.remove();
  const missingCount = state.entries.filter((entry) => !entry.docNo).length;
  if (!missingCount) return;

  document.querySelector(".section-head").insertAdjacentHTML("beforebegin", `<div class="banner info" id="doc-number-banner">
    <span>มี <strong>${formatNumber(missingCount)}</strong> รายการที่ยังไม่มีเลขที่เอกสาร</span>
    <button type="button" class="small" id="doc-number-fill" style="margin-left:auto">สร้างเลขที่ให้อัตโนมัติ</button>
  </div>`);
  byId("doc-number-fill").addEventListener("click", () => assignMissingDocumentNumbers(missingCount));
}

async function assignMissingDocumentNumbers(missingCount) {
  const confirmed = await confirmDialog(
    `สร้างเลขที่เอกสาร JV-ปีเดือน-ลำดับ ให้ ${formatNumber(missingCount)} รายการตามลำดับวันที่?`,
    { title: "สร้างเลขที่เอกสาร", confirmText: "สร้างเลขที่", tone: "primary" },
  );
  if (!confirmed) return;

  const entries = state.entries.map((entry) => ({ ...entry }));
  const reservedNumbers = new Set();
  entries
    .filter((entry) => !entry.docNo)
    .sort((leftEntry, rightEntry) => (toIsoDate(leftEntry.date) || "").localeCompare(toIsoDate(rightEntry.date) || ""))
    .forEach((entry) => { entry.docNo = createDocumentNumber(entries, "JV", entry.date, entry.id, reservedNumbers); });

  if (!(await commitChanges({ entries }))) return;
  renderEntryList();
  renderMissingNumberBanner();
  suggestDocumentNumber();
  notifySuccess(`สร้างเลขที่เอกสาร ${formatNumber(missingCount)} รายการเรียบร้อย`);
}

/* ================================================================== */
/* ผูกอีเวนต์                                                            */
/* ================================================================== */

/** ลิงก์ "#new" (จากเมนู/แดชบอร์ด): เลื่อนไปที่ฟอร์มและโฟกัสช่องวันที่ */
function focusFormIfRequested() {
  if (location.hash !== "#new") return;
  entryForm.scrollIntoView({ block: "start" });
  dateInput.focus();
  history.replaceState(null, "", location.pathname);
}

async function handleResetClick() {
  if (hasUnsavedChanges && !(await confirmDialog("ล้างข้อมูลในฟอร์มทั้งหมด?", { title: "ล้างฟอร์ม", confirmText: "ล้าง" }))) return;
  resetForm();
}

/** คีย์ลัด: Ctrl/⌘ + Enter = บันทึก, Alt + N = เพิ่มบรรทัด */
function handleFormShortcuts(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    entryForm.requestSubmit();
  } else if (event.altKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    addLine({}, { focus: true });
  }
}

byId("add-line").addEventListener("click", () => addLine({}, { focus: true }));
byId("balance-line").addEventListener("click", fillBalancingAmount);
byId("journal-entry-reset").addEventListener("click", handleResetClick);
byId("journal-list").addEventListener("click", handleListClick);
byId("journal-entry-export").addEventListener("click", exportCsv);
byId("journal-entry-filter-month").addEventListener("click", filterCurrentMonth);
byId("journal-entry-filter-clear").addEventListener("click", clearListFilters);
filterInputs.from.addEventListener("change", applyListFilters);
filterInputs.to.addEventListener("change", applyListFilters);
filterInputs.kind.addEventListener("change", applyListFilters);
filterInputs.searchText.addEventListener("input", debounce(applyListFilters, 180));

// ระหว่างพิมพ์ชื่อ: ชื่อตรงกับรายการ → เลือกประเภทให้ทันที
partyInput.addEventListener("input", () => autoDetectPartyType(false));
// พิมพ์ชื่อคู่ค้าเองจนครบแล้วออกจากช่อง → ตั้ง/บังคับเลือกประเภท แล้วตรวจแม่แบบคำอธิบายอัตโนมัติ
partyInput.addEventListener("change", () => {
  autoDetectPartyType(true);
  applyAutoDescription(resolvePartyInput());
});
autoMirrorSwitch.addEventListener("change", () => {
  try {
    localStorage.setItem(AUTO_MIRROR_STORAGE_KEY, autoMirrorSwitch.checked ? "1" : "0");
  } catch {
    // บันทึกไม่ได้ก็ไม่เป็นไร สวิตช์ยังใช้ได้ในหน้านี้
  }
  if (autoMirrorSwitch.checked) mirrorAllPairs();
  updateBalanceStatus();
});
// คลิกที่อื่น / เลื่อนหน้า / กด Esc = ปิดเมนู "⋯"
document.addEventListener("click", (event) => {
  if (!event.target.closest(".more-menu")) closeAllMenus();
});
window.addEventListener("scroll", closeAllMenus, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllMenus();
});
// "input" = เปลี่ยนทันทีที่เลือกจากปฏิทิน, "change" = กันเบราว์เซอร์ที่ไม่ส่ง input
dateInput.addEventListener("input", suggestDocumentNumber);
dateInput.addEventListener("change", suggestDocumentNumber);
documentNumberInput.addEventListener("input", () => { isDocumentNumberManual = Boolean(documentNumberInput.value.trim()); });
entryForm.addEventListener("input", () => { hasUnsavedChanges = true; });
entryForm.addEventListener("keydown", handleFormShortcuts);
entryForm.addEventListener("submit", handleFormSubmit);
cancelEditButton.addEventListener("click", () => {
  resetForm();
  notify("ยกเลิกการแก้ไขแล้ว");
});
window.addEventListener("hashchange", focusFormIfRequested);
window.addEventListener("beforeunload", (event) => {
  // preventDefault() ทำให้เบราว์เซอร์แสดงกล่องยืนยันก่อนออกจากหน้า
  if (hasUnsavedChanges) event.preventDefault();
});

/* ================================================================== */
/* เริ่มต้นหน้า                                                            */
/* ================================================================== */

if (await loadData(["entries", "accounts", "customers", "suppliers", "customerNames", "autoDesc"])) {
  accountOptionsHtml = renderAccountOptions();
  try {
    autoMirrorSwitch.checked = localStorage.getItem(AUTO_MIRROR_STORAGE_KEY) === "1";
  } catch {
    autoMirrorSwitch.checked = false;
  }
  resetForm();
  // ตัวเลือกเดือนของรายการที่บันทึกแล้ว (ตั้งช่วง ตั้งแต่–ถึง ให้ทั้งเดือน)
  monthFilter = createMonthFilter({
    fromInput: filterInputs.from,
    toInput: filterInputs.to,
    getRecords: () => state.entries,
    onSelect: applyListFilters,
  });
  // ลิงก์จากหน้าอื่น เช่น journal.html?q=JV-202611-0001 → ค้นหารายการนั้นให้
  const searchQuery = new URLSearchParams(location.search).get("q");
  if (searchQuery) {
    filterInputs.searchText.value = searchQuery;
  } else {
    // ค่าเริ่มต้น: แสดงเดือนล่าสุดที่มีรายการ (ถ้ามาจากลิงก์ค้นหา ไม่จำกัดเดือน เพื่อให้เจอรายการนั้นแน่นอน)
    // เดือนที่เลือกไว้ในหน้าอื่น (ถ้ามี) ไม่เช่นนั้นเดือนล่าสุดที่มีรายการ
  const latestMonth = getInitialMonthRange(state.entries);
    filterInputs.from.value = latestMonth.from;
    filterInputs.to.value = latestMonth.to;
  }
  applyListFilters();
  renderEntryList();
  renderMissingNumberBanner();
  focusFormIfRequested();
  if (!state.accounts.length) {
    entryForm.insertAdjacentHTML("afterbegin", '<div class="banner warn">ยังไม่มีผังบัญชี — <a href="../accounts/accounts.html">สร้างผังบัญชี</a> ก่อนบันทึกรายการ</div>');
  }
  onDataRefresh(() => {
    accountOptionsHtml = renderAccountOptions();
    monthFilter.refresh();
    renderEntryList();
    renderMissingNumberBanner();
  });
}

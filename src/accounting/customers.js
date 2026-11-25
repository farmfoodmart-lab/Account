/**
 * @file ข้อมูลคู่ค้า (ลูกค้าและเจ้าหนี้)
 *
 * ช่องเลือกคู่ค้า (ในสมุดรายวันและคำอธิบายอัตโนมัติ) รวมคู่ค้าหลายแหล่ง โดยเข้ารหัสค่าไว้ใน value:
 *   "id:<id>"     = ลูกค้าในทะเบียน หรือเจ้าหนี้ในทะเบียน (id ไม่ซ้ำกันระหว่างสองทะเบียน)
 *   "name:<ชื่อ>"  = รายชื่อจากไฟล์ / ชื่อที่เคยใช้ (ไม่มี id)
 *
 * รายการบัญชีเก็บคู่ค้าในช่อง customerId / customerName เสมอ (ทั้งลูกค้าและเจ้าหนี้)
 * ⚠️ ห้ามเปลี่ยนชื่อช่องนี้ เพราะข้อมูลเดิมในฐานข้อมูลใช้ชื่อนี้อยู่
 */
import { state } from "../core/store.js";
import { escapeHtml } from "../utils/format.js";
import { findAccountForRole } from "./accounts.js";

/**
 * @param {string} customerId
 * @returns {object | undefined}
 */
export function findCustomerById(customerId) {
  return state.customers.find((customer) => customer.id === customerId) || findSupplierById(customerId);
}

/**
 * เจ้าหนี้ในทะเบียน
 * @param {string} supplierId
 * @returns {object | undefined}
 */
export function findSupplierById(supplierId) {
  return (state.suppliers || []).find((supplier) => supplier.id === supplierId);
}

/**
 * เรียงให้รายการที่เพิ่มเอง (ไม่ได้มาจากไฟล์นำเข้า) ขึ้นก่อน โดยรายการล่าสุดอยู่บนสุด
 * → ชื่อที่เพิ่งเพิ่มเห็นได้ทันทีที่หัวรายการตัวเลือก แม้จะมีรายชื่อจากไฟล์หลายพันราย
 * (รายการใหม่ต่อท้ายอาร์เรย์เสมอ ท้ายอาร์เรย์ = ล่าสุด)
 * @template T
 * @param {T[]} records
 * @returns {T[]}
 */
function newestManualFirst(records) {
  const manual = records.filter((record) => !record.fileId).reverse();
  return [...manual, ...records.filter((record) => record.fileId)];
}

/** ลูกค้าและเจ้าหนี้ในทะเบียนทั้งหมด */
function getRegisteredParties() {
  return [...state.customers, ...(state.suppliers || [])];
}

/**
 * ข้อความ "รหัส - ชื่อลูกค้า" สำหรับแสดงผล
 * @param {{ code?: string, name?: string } | undefined} customer
 * @returns {string}
 */
export function formatCustomerLabel(customer) {
  if (!customer) return "";
  const codePrefix = customer.code ? `${customer.code} - ` : "";
  return `${codePrefix}${customer.name || ""}`.trim();
}

/**
 * HTML <option> ของลูกค้าทั้งสองแหล่ง (ไม่รวมตัวเลือกแรก)
 * รายชื่อจากไฟล์ที่ซ้ำกับชื่อในทะเบียน หรือซ้ำกันเอง จะแสดงครั้งเดียว
 * @returns {string}
 */
export function renderCustomerOptions() {
  const toOption = (party) => `<option value="id:${escapeHtml(party.id)}">${escapeHtml(formatCustomerLabel(party))}</option>`;
  const registeredOptions = state.customers.filter((customer) => formatCustomerLabel(customer)).map(toOption);
  const supplierOptions = newestManualFirst(state.suppliers || []).filter((supplier) => formatCustomerLabel(supplier)).map(toOption);

  const registeredNames = new Set(getRegisteredParties().map((party) => (party.name || "").trim()));
  const listedNames = new Set();
  const toNameOption = (record) => {
    const name = (record.name || "").trim();
    if (!name || registeredNames.has(name) || listedNames.has(name)) return "";
    listedNames.add(name);
    return `<option value="name:${escapeHtml(name)}">${escapeHtml(name)}</option>`;
  };
  // ลูกค้าที่เพิ่มเอง (ล่าสุดก่อน) → ทะเบียนเดิม → รายชื่อจากไฟล์
  const manualNameOptions = newestManualFirst(state.customerNames).filter((record) => !record.fileId).map(toNameOption);
  const fileNameOptions = state.customerNames.filter((record) => record.fileId).map(toNameOption);
  const customerOptions = [...manualNameOptions, ...registeredOptions, ...fileNameOptions].join("");
  if (!supplierOptions.length) return customerOptions;
  // มีทะเบียนเจ้าหนี้ → แบ่งกลุ่มให้เลือกง่าย
  return `<optgroup label="ลูกค้า">${customerOptions}</optgroup>`
    + `<optgroup label="เจ้าหนี้">${supplierOptions.join("")}</optgroup>`;
}

/**
 * แปลงค่าจากช่องเลือกลูกค้ากลับเป็นข้อมูลลูกค้า
 * @param {string} optionValue เช่น "id:abc123" หรือ "name:ร้านสมใจ"
 * @returns {{ customerId: string, customerName: string }}
 */
export function parseCustomerOptionValue(optionValue) {
  if (optionValue.startsWith("id:")) {
    const customerId = optionValue.slice(3);
    return { customerId, customerName: formatCustomerLabel(findCustomerById(customerId)) };
  }
  if (optionValue.startsWith("name:")) return { customerId: "", customerName: optionValue.slice(5) };
  return { customerId: "", customerName: "" };
}

/**
 * ค่าของช่องเลือกลูกค้า สำหรับข้อมูลที่บันทึกไว้แล้ว (รายการบัญชีหรือแม่แบบ)
 * @param {{ customerId?: string, customerName?: string }} record
 * @returns {string}
 */
export function toCustomerOptionValue(record) {
  if (record.customerId) return `id:${record.customerId}`;
  if (record.customerName) return `name:${record.customerName}`;
  return "";
}

/**
 * ชื่อลูกค้าสำหรับแสดงผล: ถ้ามีในทะเบียนใช้ชื่อปัจจุบันในทะเบียน ไม่เช่นนั้นใช้ชื่อที่บันทึกไว้
 * @param {{ customerId?: string, customerName?: string }} record
 * @returns {string}
 */
export function getCustomerDisplayName(record) {
  const customer = record.customerId ? findCustomerById(record.customerId) : null;
  return customer ? formatCustomerLabel(customer) : record.customerName || "-";
}

/* ------------------------------------------------------------------ */
/* รหัสลูกค้า / ซัพพลายเออร์: ตัวอักษรนำ + เลขอย่างน้อย 3 หลัก              */
/* เช่น C001, C012, S123 (เกิน 999 → C1000)                               */
/* ------------------------------------------------------------------ */

const CODE_DIGITS = 3;
const CUSTOMER_CODE_PREFIX = "C";
const SUPPLIER_CODE_PREFIX = "S";

/** @returns {string} เช่น formatCode("C", 7) → "C007" */
function formatCode(prefix, number) {
  return `${prefix}${String(number).padStart(CODE_DIGITS, "0")}`;
}

/** เลขในรหัส (ตัวอักษรนำตรงกัน) เช่น "C0012" → 12, ไม่ใช่รูปแบบนี้ → 0 */
function getCodeNumber(prefix, code) {
  const match = String(code || "").trim().match(new RegExp(`^${prefix}([0-9]+)$`, "i"));
  return match ? Number(match[1]) : 0;
}

/** รหัสอยู่ในรูปแบบมาตรฐานแล้วหรือไม่ (เช่น C001 ใช่, C0001 / c1 ไม่ใช่) */
function isStandardCode(prefix, code) {
  const number = getCodeNumber(prefix, code);
  return number > 0 && formatCode(prefix, number) === code;
}

/** รหัสที่พิมพ์แบบย่อ → รูปแบบมาตรฐาน: "7", "c7", "C0007" → "C007" (แบบอื่นคงเดิม) */
function normalizeCode(prefix, code) {
  const value = String(code || "").trim();
  const match = value.match(new RegExp(`^${prefix}?([0-9]+)$`, "i"));
  return match && Number(match[1]) > 0 ? formatCode(prefix, Number(match[1])) : value;
}

/** รหัสใหม่ต่อจากเลขสูงสุดของ records */
function createCodes(prefix, records, count) {
  const highestNumber = Math.max(0, ...records.map((record) => getCodeNumber(prefix, record.code)));
  return Array.from({ length: count }, (_, index) => formatCode(prefix, highestNumber + index + 1));
}

/**
 * เรียงรหัสของหลายชุดข้อมูลใหม่ให้ต่อเนื่อง ไม่ข้ามเลข: 001, 002, 003, ... (เลขไม่ซ้ำกันข้ามชุด)
 * ลำดับใหม่ยึดตามลำดับเดิม:
 * 1. รหัสที่มีเลข (เช่น C001, C0005, C12) เรียงตามเลขเดิม — เลขซ้ำกัน: ตัวที่อยู่ก่อนได้ก่อน
 * 2. ไม่มีรหัส / รหัสรูปแบบอื่น → ต่อท้าย ตามลำดับในรายการ
 * @param {string} prefix
 * @param {Record<string, object[]>} groups เช่น { customers: [...], customerNames: [...] }
 * @returns {{ groups: Record<string, object[]>, changedCount: number }}
 */
function normalizeCodes(prefix, groups) {
  const items = Object.entries(groups).flatMap(([source, records]) => records.map((record) => ({ source, record })));
  const sortKey = (item) => getCodeNumber(prefix, item.record.code) || Number.POSITIVE_INFINITY;
  const orderedItems = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (sortKey(left.item) - sortKey(right.item)) || (left.index - right.index))
    .map(({ item }) => item);
  const newCodes = new Map(orderedItems.map((item, index) => [item, formatCode(prefix, index + 1)]));

  let changedCount = 0;
  const result = Object.fromEntries(Object.keys(groups).map((source) => [source, []]));
  items.forEach((item) => {
    const code = newCodes.get(item);
    const isChanged = code !== item.record.code;
    if (isChanged) changedCount += 1;
    result[item.source].push(isChanged ? { ...item.record, code } : item.record);
  });
  return { groups: result, changedCount };
}

/* ---------- ลูกค้า (C001) ---------- */

/** @returns {string} เช่น 7 → "C007" */
export function formatCustomerCode(number) {
  return formatCode(CUSTOMER_CODE_PREFIX, number);
}

/** "7", "c7", "C0007" → "C007" (แบบอื่นคงเดิม) */
export function normalizeCustomerCode(code) {
  return normalizeCode(CUSTOMER_CODE_PREFIX, code);
}

/** รหัสอยู่ในรูปแบบ C001 แล้วหรือไม่ */
export function isStandardCustomerCode(code) {
  return isStandardCode(CUSTOMER_CODE_PREFIX, code);
}

/**
 * สร้างรหัสลูกค้าใหม่ที่ไม่ซ้ำกับทะเบียนลูกค้าและรายชื่อจากไฟล์
 * @param {number} [count=1] จำนวนรหัสที่ต้องการ (เช่น ตอนนำเข้าไฟล์ทีละหลายชื่อ)
 * @returns {string[]} เช่น ["C012", "C013"]
 */
export function createCustomerCodes(count = 1) {
  return createCodes(CUSTOMER_CODE_PREFIX, [...state.customers, ...state.customerNames], count);
}

/**
 * ปรับรหัสลูกค้าทั้งหมด (ทะเบียน + รายชื่อ) ให้เป็นรูปแบบ C001
 * @returns {{ customers: object[], customerNames: object[], changedCount: number }}
 */
export function normalizeAllCustomerCodes() {
  const { groups, changedCount } = normalizeCodes(CUSTOMER_CODE_PREFIX, {
    customers: state.customers,
    customerNames: state.customerNames,
  });
  return { ...groups, changedCount };
}

/* ---------- ซัพพลายเออร์ / เจ้าหนี้ (S001) ---------- */

/** "7", "s7", "S0007" → "S007" (แบบอื่นคงเดิม) */
export function normalizeSupplierCode(code) {
  return normalizeCode(SUPPLIER_CODE_PREFIX, code);
}

/**
 * สร้างรหัสเจ้าหนี้ใหม่ที่ไม่ซ้ำกับทะเบียนเจ้าหนี้
 * @returns {string} เช่น "S003"
 */
export function createSupplierCode() {
  return createSupplierCodes(1)[0];
}

/**
 * สร้างรหัสเจ้าหนี้ใหม่หลายรหัสต่อเนื่องกัน (ใช้ตอนนำเข้าจากไฟล์)
 * @param {number} [count=1]
 * @param {object[]} [extraRecords=[]] รายการที่จะเพิ่มด้วย (ยังไม่อยู่ใน state) เพื่อไม่ให้รหัสชนกัน
 * @returns {string[]}
 */
export function createSupplierCodes(count = 1, extraRecords = []) {
  return createCodes(SUPPLIER_CODE_PREFIX, [...(state.suppliers || []), ...extraRecords], count);
}

/**
 * ปรับรหัสเจ้าหนี้ทั้งหมดให้เป็นรูปแบบ S001
 * @returns {{ suppliers: object[], changedCount: number }}
 */
export function normalizeAllSupplierCodes() {
  const { groups, changedCount } = normalizeCodes(SUPPLIER_CODE_PREFIX, { suppliers: state.suppliers || [] });
  return { ...groups, changedCount };
}

/* ------------------------------------------------------------------ */
/* ช่องคู่ค้า (ลูกค้า/ผู้ขาย) ในสมุดรายวัน: พิมพ์ได้ + มีรายการให้เลือก         */
/* ค่าภายในของคู่ค้า: "id:<customerId>" (ลูกค้าในทะเบียน) หรือ "name:<ชื่อ>"   */
/* หรือ "item:<ชื่อรายการ>" (ชื่อรายการจากแม่แบบคำอธิบายอัตโนมัติ — ไม่ใช่คู่ค้า)   */
/* ------------------------------------------------------------------ */

/** คำนำหน้าค่าของตัวเลือก "ชื่อรายการ" */
const ITEM_VALUE_PREFIX = "item:";

/**
 * ชื่อรายการทั้งหมดจากแม่แบบคำอธิบายอัตโนมัติ (ไม่ซ้ำ เรียงตามตัวอักษร)
 * @returns {string[]}
 */
export function getTemplateItemNames() {
  return [...new Set((state.autoDesc || [])
    .map((rule) => String(rule.itemName || "").trim())
    .filter(Boolean))].sort((left, right) => left.localeCompare(right, "th"));
}

/**
 * ค่าของช่องคู่ค้าเป็น "ชื่อรายการ" หรือไม่ → คืนชื่อรายการ (ไม่ใช่ → สตริงว่าง)
 * @param {string} optionValue เช่น "item:ค่าไฟฟ้า"
 * @returns {string}
 */
export function parseItemOptionValue(optionValue) {
  const value = String(optionValue || "");
  return value.startsWith(ITEM_VALUE_PREFIX) ? value.slice(ITEM_VALUE_PREFIX.length) : "";
}

/** กลุ่มในช่องคู่ค้าของสมุดรายวัน (เรียงตามลำดับนี้) */
export const PARTY_GROUPS = {
  customer: "1. ชื่อลูกค้า",
  supplier: "2. ชื่อซัพพลายเออร์",
  item: "3. ชื่อรายการ",
};

/**
 * ชื่อคู่ค้าที่เคยพิมพ์เองในสมุดรายวัน หรืออยู่ในแม่แบบคำอธิบายอัตโนมัติ (ไม่มีในทะเบียน)
 * แยกเป็นลูกค้า/ซัพพลายเออร์:
 * - ระบุ partyType ไว้ (ผู้ใช้เลือกประเภทตอนบันทึกชื่อใหม่) → ใช้ตามนั้น
 * - ไม่ระบุ: รายการที่ใช้บัญชีเจ้าหนี้การค้า → ซัพพลายเออร์ นอกนั้น → ลูกค้า
 * @returns {{ customerNames: string[], supplierNames: string[] }}
 */
function getUsedPartyNames() {
  const payableAccountId = findAccountForRole("payable")?.id;
  const receivableAccountId = findAccountForRole("receivable")?.id;
  const customerNames = new Set();
  const supplierNames = new Set();
  const addName = (name, isSupplier) => {
    if (supplierNames.has(name) || customerNames.has(name)) return; // ชื่อเดียวอยู่กลุ่มเดียว (ตามที่พบครั้งแรก)
    (isSupplier ? supplierNames : customerNames).add(name);
  };
  const nameOf = (record) => !record.customerId && !record.itemName && String(record.customerName || "").trim();
  // 1) ประเภทที่ผู้ใช้เลือกไว้ (รายการล่าสุดก่อน) และแม่แบบ  2) เดาจากบัญชีที่ใช้
  const latestEntries = [...state.entries].reverse();
  latestEntries.forEach((entry) => {
    const name = nameOf(entry);
    if (name && entry.partyType) addName(name, entry.partyType === "supplier");
  });
  (state.autoDesc || []).forEach((rule) => {
    const name = nameOf(rule);
    if (name) addName(name, rule.partyType === "supplier");
  });
  latestEntries.forEach((entry) => {
    const name = nameOf(entry);
    if (!name) return;
    const accountIds = (entry.lines || []).map((line) => line.accountId);
    addName(name, Boolean(payableAccountId) && accountIds.includes(payableAccountId)
      && !(receivableAccountId && accountIds.includes(receivableAccountId)));
  });
  const sortThai = (names) => [...names].sort((left, right) => left.localeCompare(right, "th"));
  return { customerNames: sortThai(customerNames), supplierNames: sortThai(supplierNames) };
}

/** คำทั่วไปที่ไม่ใช่ชื่อคู่ค้าจริง (มักพิมพ์ลงช่องคู่ค้าแทนการเว้นว่าง) */
const NON_PARTY_NAMES = new Set([
  "เงินสด", "ลูกค้า", "ลูกค้าทั่วไป", "ลูกหนี้", "ผู้ขาย", "ซัพพลายเออร์", "เจ้าหนี้", "ธนาคาร", "ย้ายเงิน", "-",
]);

/**
 * ชื่อนี้ไม่ใช่คู่ค้า (ลูกค้า/ซัพพลายเออร์) หรือไม่:
 * คำทั่วไปใน NON_PARTY_NAMES หรือชื่อที่ตรงกับชื่อบัญชีในผังบัญชี (เช่น "เงินสด", "เงินฝากธนาคาร")
 * @param {string | undefined} name
 * @returns {boolean}
 */
export function isNonPartyName(name) {
  const value = String(name || "").trim();
  if (!value) return false;
  if (NON_PARTY_NAMES.has(value)) return true;
  return (state.accounts || []).some((account) => String(account.name || "").trim() === value);
}

/**
 * ตัวเลือกในช่องคู่ค้า แบ่ง 3 กลุ่ม: ชื่อลูกค้า / ชื่อซัพพลายเออร์ / ชื่อรายการ
 * @returns {Array<{ value: string, label: string, group: string, keywords: string }>}
 */
export function getPartyOptions() {
  const options = [];
  const usedValues = new Set();
  const add = (value, label, group, keywords = "") => {
    if (usedValues.has(value)) return;
    // ชื่อที่ไม่ใช่คู่ค้า (เช่น "เงินสด", "ลูกค้า") ไม่แสดงในกลุ่มลูกค้า/ซัพพลายเออร์
    if (group !== PARTY_GROUPS.item && isNonPartyName(value.startsWith("id:") ? findCustomerById(value.slice(3))?.name : label)) return;
    usedValues.add(value);
    options.push({ value, label, group, keywords: `${label} ${keywords}`.toLowerCase() });
  };
  const registeredNames = new Set(getRegisteredParties().map((party) => (party.name || "").trim()));
  const usedNames = getUsedPartyNames();
  // ชื่อที่ตรงกับคู่ค้าในทะเบียนไม่ต้องแสดงซ้ำ (เลือกจากรายการในทะเบียนแทน)
  const addUsedNames = (names, group) => names
    .filter((name) => !registeredNames.has(name))
    .forEach((name) => add(`name:${name}`, name, group, "เคยใช้"));

  // 1. ชื่อลูกค้า: ที่เพิ่มเอง (ล่าสุดก่อน) → ทะเบียนลูกค้า → รายชื่อจากไฟล์ → ชื่อที่เคยใช้
  //    (รายการแสดงได้จำกัดต่อกลุ่ม ชื่อที่เพิ่งเพิ่มจึงต้องอยู่บนสุด ไม่เช่นนั้นจะหลุดท้ายรายการ)
  const addCustomerName = (record) => {
    const name = (record.name || "").trim();
    if (!name || registeredNames.has(name)) return;
    add(`name:${name}`, name, PARTY_GROUPS.customer, record.code || "");
  };
  newestManualFirst(state.customerNames).filter((record) => !record.fileId).forEach(addCustomerName);
  state.customers.forEach((customer) => {
    const label = formatCustomerLabel(customer);
    if (label) add(`id:${customer.id}`, label, PARTY_GROUPS.customer, customer.tax || "");
  });
  state.customerNames.filter((record) => record.fileId).forEach(addCustomerName);
  addUsedNames(usedNames.customerNames, PARTY_GROUPS.customer);

  // 2. ชื่อซัพพลายเออร์: ทะเบียนเจ้าหนี้ (ที่เพิ่มเองล่าสุดก่อน) → ชื่อที่เคยใช้กับเจ้าหนี้การค้า
  newestManualFirst(state.suppliers || []).forEach((supplier) => {
    const label = formatCustomerLabel(supplier);
    if (label) add(`id:${supplier.id}`, label, PARTY_GROUPS.supplier, supplier.tax || "");
  });
  addUsedNames(usedNames.supplierNames, PARTY_GROUPS.supplier);

  // 3. ชื่อรายการ: จากแม่แบบคำอธิบายอัตโนมัติตามชื่อรายการ
  getTemplateItemNames().forEach((name) => add(`${ITEM_VALUE_PREFIX}${name}`, name, PARTY_GROUPS.item));
  return options;
}

/**
 * แปลงข้อความที่พิมพ์/เลือก เป็นค่าคู่ค้า
 * - ตรงกับลูกค้าในทะเบียน (ชื่อเต็ม "รหัส - ชื่อ", รหัส หรือชื่อ) → "id:<customerId>"
 * - ตรงกับรหัสหรือชื่อของรายชื่อจากไฟล์ (เช่น C012) → "name:<ชื่อ>"
 * - ตรงกับชื่อรายการในแม่แบบคำอธิบายอัตโนมัติ → "item:<ชื่อรายการ>"
 * - อื่น ๆ (เช่น ผู้ขายรายใหม่) → "name:<ข้อความที่พิมพ์>"
 * @param {string} text
 * @returns {string} สตริงว่างถ้าไม่ได้พิมพ์อะไร
 */
export function resolvePartyText(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  const normalized = value.toLowerCase();
  const customer = getRegisteredParties().find((item) =>
    formatCustomerLabel(item).toLowerCase() === normalized
    || String(item.code || "").toLowerCase() === normalized
    || String(item.name || "").trim().toLowerCase() === normalized);
  if (customer) return `id:${customer.id}`;
  const listedName = state.customerNames.find((record) =>
    String(record.code || "").toLowerCase() === normalized
    || String(record.name || "").trim().toLowerCase() === normalized);
  if (listedName) return `name:${listedName.name.trim()}`;
  const itemName = getTemplateItemNames().find((name) => name.toLowerCase() === normalized);
  if (itemName) return `${ITEM_VALUE_PREFIX}${itemName}`;
  return `name:${value}`;
}

/**
 * ข้อความที่แสดงในช่องคู่ค้า สำหรับรายการที่บันทึกไว้ (ไม่มีคู่ค้า → ชื่อรายการ ถ้ามี)
 * @param {{ customerId?: string, customerName?: string, itemName?: string }} record
 */
export function toPartyText(record) {
  const customer = record.customerId ? findCustomerById(record.customerId) : null;
  return customer ? formatCustomerLabel(customer) : record.customerName || record.itemName || "";
}

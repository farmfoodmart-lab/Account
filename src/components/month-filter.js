/**
 * @file ตัวเลือก "เดือน" สำหรับตัวกรองช่วงวันที่ (ตั้งแต่–ถึง)
 *
 * วางช่องเลือกเดือนไว้หน้าช่อง "ตั้งแต่" แล้วทำงานคู่กับช่องวันที่เดิม:
 * - เลือกเดือน → ตั้ง "ตั้งแต่" = วันที่ 1 และ "ถึง" = วันสุดท้ายของเดือน แล้วเรียก onSelect
 * - แก้ช่องวันที่เอง (หรือโค้ดตั้งค่า) → ช่องเดือนแสดงเดือนที่ตรงกัน หรือ "กำหนดเอง" ถ้าไม่ใช่ทั้งเดือน
 * รายการเดือนมาจากวันที่ของรายการบัญชี เรียงจากเดือนเก่าไปเดือนใหม่
 *
 * เดือนที่เลือกใช้ร่วมกันทุกหน้า: เลือกเดือนในหน้าใดก็ตาม (เช่น สมุดรายวัน) หน้าอื่นที่มีตัวกรองเดือน
 * จะเปิดที่เดือนเดียวกัน (จำไว้ในเบราว์เซอร์นี้ และอัปเดตแท็บอื่นที่เปิดอยู่ทันที)
 *
 * @example
 * const monthFilter = createMonthFilter({
 *   fromInput, toInput,
 *   getRecords: () => state.entries,
 *   onSelect: renderPage,
 * });
 * onDataRefresh(() => { monthFilter.refresh(); renderPage(); });
 */
import { getLatestMonthRange, getMonthRange, toIsoDate } from "../utils/date.js";

/** คีย์ localStorage ของเดือนที่เลือกล่าสุด ("YYYY-MM") */
const SELECTED_MONTH_STORAGE_KEY = "selected_month";
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** เดือนที่เลือกไว้ล่าสุด ("" = ยังไม่เคยเลือก) */
export function getSelectedMonth() {
  try {
    const month = localStorage.getItem(SELECTED_MONTH_STORAGE_KEY) || "";
    return MONTH_PATTERN.test(month) ? month : "";
  } catch {
    return "";
  }
}

/**
 * จำเดือนที่เลือก ให้หน้าอื่นใช้เดือนเดียวกัน
 * @param {string} month "YYYY-MM"
 */
export function rememberSelectedMonth(month) {
  if (!MONTH_PATTERN.test(month)) return;
  try {
    localStorage.setItem(SELECTED_MONTH_STORAGE_KEY, month);
  } catch {
    // เบราว์เซอร์ไม่ให้ใช้ localStorage → แต่ละหน้าใช้เดือนล่าสุดตามเดิม
  }
}

/**
 * ช่วงวันที่เริ่มต้นของหน้า: เดือนที่เลือกไว้ล่าสุด (ถ้ามี) ไม่เช่นนั้นเดือนล่าสุดที่มีรายการ
 * @param {Array<{ date?: unknown }>} records
 * @returns {{ from: string, to: string }}
 */
export function getInitialMonthRange(records) {
  const month = getSelectedMonth();
  return month ? getMonthRange(`${month}-01`) : getLatestMonthRange(records);
}

const THAI_MONTH_NAMES = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** "2026-11" → "พฤศจิกายน 2026" */
function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${THAI_MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * @param {{
 *   fromInput: HTMLInputElement,
 *   toInput: HTMLInputElement,
 *   getRecords: () => Array<{ date?: unknown }>,
 *   onSelect: (range: { from: string, to: string }) => void,
 * }} options
 * @returns {{ refresh: () => void, sync: () => void }}
 */
export function createMonthFilter({ fromInput, toInput, getRecords, onSelect }) {
  const wrapper = document.createElement("label");
  wrapper.className = "month-filter";
  wrapper.append("เดือน ");
  const select = document.createElement("select");
  select.setAttribute("aria-label", "เลือกเดือน");
  wrapper.append(select);
  const anchor = fromInput.closest("label") || fromInput;
  anchor.parentNode.insertBefore(wrapper, anchor);

  /** เดือนของช่วงวันที่ปัจจุบัน ("" ถ้าไม่ได้ครอบคลุมพอดีหนึ่งเดือน) */
  function getRangeMonth() {
    const from = fromInput.value;
    const to = toInput.value;
    if (!from || !to || from.slice(0, 7) !== to.slice(0, 7)) return "";
    const monthRange = getMonthRange(from);
    return monthRange.from === from && monthRange.to === to ? from.slice(0, 7) : "";
  }

  function sync() {
    const month = getRangeMonth();
    if (month) rememberSelectedMonth(month);
    if (month && ![...select.options].some((option) => option.value === month)) {
      // แทรกตามลำดับเดือน (เก่า → ใหม่)
      const nextOption = [...select.options].find((option) => option.value && option.value > month);
      select.add(new Option(formatMonthLabel(month), month), nextOption || null);
    }
    select.value = month;
  }

  function refresh() {
    const months = new Set();
    getRecords().forEach((record) => {
      const isoDate = toIsoDate(record.date);
      if (isoDate) months.add(isoDate.slice(0, 7));
    });
    select.innerHTML = '<option value="">กำหนดเอง</option>';
    // เรียงจากเดือนเก่าไปเดือนใหม่ (ม.ค. → ธ.ค.)
    [...months].sort().forEach((month) => select.add(new Option(formatMonthLabel(month), month)));
    sync();
  }

  /** เปลี่ยนไปเดือนที่ระบุ แล้วให้หน้าวาดใหม่ */
  function selectMonth(month) {
    const monthRange = getMonthRange(`${month}-01`);
    fromInput.value = monthRange.from;
    toInput.value = monthRange.to;
    onSelect(monthRange);
  }

  select.addEventListener("change", () => {
    if (!select.value) return; // "กำหนดเอง" = ใช้ช่องวันที่ตามเดิม
    rememberSelectedMonth(select.value);
    selectMonth(select.value);
  });

  // แท็บอื่นเลือกเดือนใหม่ → แท็บนี้เปลี่ยนตาม (เฉพาะเมื่อกำลังดูแบบรายเดือนอยู่)
  window.addEventListener("storage", (event) => {
    if (event.key !== SELECTED_MONTH_STORAGE_KEY || !MONTH_PATTERN.test(event.newValue || "")) return;
    const currentMonth = getRangeMonth();
    if (currentMonth && currentMonth !== event.newValue) selectMonth(event.newValue);
  });

  // ช่องวันที่เปลี่ยน (ผู้ใช้แก้ หรือโค้ดของหน้าตั้งค่า .value) → อัปเดตช่องเดือนตาม
  [fromInput, toInput].forEach((input) => {
    input.addEventListener("change", sync);
    const valueDescriptor = Object.getOwnPropertyDescriptor(input, "value")
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    Object.defineProperty(input, "value", {
      configurable: true,
      get() { return valueDescriptor.get.call(this); },
      set(newValue) {
        valueDescriptor.set.call(this, newValue);
        queueMicrotask(sync);
      },
    });
  });

  refresh();
  return { refresh, sync };
}

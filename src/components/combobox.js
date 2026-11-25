/**
 * @file ช่องพิมพ์พร้อมรายการตัวเลือก (combobox)
 *
 * - พิมพ์เพื่อกรองรายการ หรือกดปุ่ม ▾ เพื่อดูตัวเลือกทั้งหมด (จัดกลุ่มได้)
 * - ใช้ลูกศรขึ้น/ลงเลือก, Enter ยืนยัน, Esc ปิด
 * - พิมพ์ข้อความที่ไม่มีในรายการก็ได้ (ช่องยังเป็น input ข้อความปกติ)
 *
 * @example
 * const combobox = createCombobox({
 *   input: byId("party"),
 *   getOptions: () => [{ value: "id:1", label: "C001 - ร้าน A", group: "ลูกค้า", keywords: "c001 ร้าน a" }],
 *   onSelect: (option) => console.log(option.value),
 * });
 */
import { escapeHtml } from "../utils/format.js";

/**
 * แสดงตัวเลือกได้มากสุดกี่รายการต่อกลุ่ม
 * ต้องมากพอให้เห็นทุกชื่อ (ลูกค้าเรียงตามรหัส ชื่อที่เพิ่มล่าสุดได้รหัสสูงสุดจึงอยู่ท้ายกลุ่ม
 * ถ้าตัดที่ 200 ชื่อใหม่จะหลุดไม่แสดง) — จำกัดไว้เพื่อกันหน้าค้างเมื่อมีหลายหมื่นรายการเท่านั้น
 */
const MAX_VISIBLE_OPTIONS = 5000;

/**
 * @typedef {{ value: string, label: string, group?: string, keywords?: string }} ComboboxOption
 */

/**
 * แปลง <input> ให้เป็น combobox
 * @param {object} config
 * @param {HTMLInputElement} config.input ช่องพิมพ์
 * @param {() => ComboboxOption[]} config.getOptions ฟังก์ชันคืนตัวเลือกล่าสุด (เรียกทุกครั้งที่เปิดรายการ)
 * @param {(option: ComboboxOption, info: { viaKeyboard: boolean }) => void} [config.onSelect] เรียกเมื่อผู้ใช้เลือกตัวเลือกจากรายการ
 *   viaKeyboard = เลือกด้วย Enter (false = คลิกเมาส์)
 * @param {string} [config.emptyText] ข้อความเมื่อไม่พบตัวเลือก
 * @param {boolean} [config.selectFirstOnEnter] กด Enter โดยยังไม่ได้เลื่อนเลือก → เลือกตัวเลือกแรกที่ตรง
 *   (เช่น พิมพ์รหัสบัญชี "101" แล้วกด Enter)
 * @param {boolean | (() => boolean)} [config.openOnFocus] โฟกัสช่องแล้วแสดงรายการทันที (ค่าเริ่มต้น true)
 *   ส่งเป็นฟังก์ชันเพื่ออ่านค่าล่าสุดทุกครั้ง · false = แสดงเมื่อพิมพ์ กดลูกศรลง หรือกดปุ่ม ▾
 */
export function createCombobox({
  input,
  getOptions,
  onSelect = () => {},
  emptyText = "ไม่พบในรายการ — ใช้ข้อความที่พิมพ์ได้เลย",
  selectFirstOnEnter = false,
  openOnFocus = true,
}) {
  const wrapper = document.createElement("div");
  wrapper.className = "combobox";
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const listId = `${input.id || "combobox"}-list`;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listId);
  input.autocomplete = "off";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "combobox-toggle";
  toggleButton.tabIndex = -1;
  toggleButton.setAttribute("aria-label", "แสดงตัวเลือกทั้งหมด");
  toggleButton.textContent = "▾";
  wrapper.appendChild(toggleButton);

  const list = document.createElement("ul");
  list.className = "combobox-list";
  list.id = listId;
  list.setAttribute("role", "listbox");
  // แสดงรายการใน "เลเยอร์บนสุด" ของเบราว์เซอร์ (popover) → ไม่ถูกการ์ด/ตาราง/กรอบที่ตัดขอบ (overflow) บัง
  // เบราว์เซอร์เก่าที่ไม่รองรับ popover → แสดงแบบ absolute ใต้ช่องเหมือนเดิม
  const usesTopLayer = typeof list.showPopover === "function";
  if (usesTopLayer) list.setAttribute("popover", "manual");
  else list.hidden = true;
  wrapper.appendChild(list);

  /** ตัวเลือกที่แสดงอยู่ (หลังกรอง) */
  let visibleOptions = [];
  let highlightedIndex = -1;
  let isOpen = false;

  /** วางรายการให้ติดช่องพิมพ์ — ที่ด้านล่างจอไม่พอ เปิดขึ้นด้านบนแทน */
  function positionList() {
    if (!usesTopLayer || !isOpen) return;
    const rect = wrapper.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const openUpward = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(320, openUpward ? spaceAbove : spaceBelow));
    list.style.left = `${Math.round(rect.left)}px`;
    list.style.width = `${Math.round(rect.width)}px`;
    list.style.maxHeight = `${Math.round(maxHeight)}px`;
    if (openUpward) {
      list.style.top = "auto";
      list.style.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
    } else {
      list.style.bottom = "auto";
      list.style.top = `${Math.round(rect.bottom + gap)}px`;
    }
  }
  // เลื่อนหน้า / ย่อขยายหน้าต่างระหว่างเปิดรายการ → ตามช่องพิมพ์ไปด้วย
  window.addEventListener("scroll", positionList, { capture: true, passive: true });
  window.addEventListener("resize", positionList);

  function renderList(filterText) {
    const searchText = String(filterText || "").trim().toLowerCase();
    const matchingOptions = getOptions().filter((option) =>
      !searchText || (option.keywords || option.label.toLowerCase()).includes(searchText));
    highlightedIndex = -1;

    if (!matchingOptions.length) {
      visibleOptions = [];
      list.innerHTML = `<li class="combobox-empty">${escapeHtml(emptyText)}</li>`;
      return;
    }
    // จำกัดจำนวนแยกตามกลุ่ม เพื่อให้ทุกกลุ่มยังมองเห็น แม้กลุ่มแรกจะมีหลายพันรายการ
    const groups = [];
    matchingOptions.forEach((option) => {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.name === (option.group || "")) lastGroup.options.push(option);
      else groups.push({ name: option.group || "", options: [option] });
    });
    visibleOptions = [];
    const items = [];
    groups.forEach((group) => {
      if (group.name) items.push(`<li class="combobox-group" role="presentation">${escapeHtml(group.name)}</li>`);
      group.options.slice(0, MAX_VISIBLE_OPTIONS).forEach((option) => {
        items.push(`<li class="combobox-option" role="option" data-index="${visibleOptions.length}">${escapeHtml(option.label)}</li>`);
        visibleOptions.push(option);
      });
      const moreCount = group.options.length - MAX_VISIBLE_OPTIONS;
      if (moreCount > 0) items.push(`<li class="combobox-empty">และอีก ${moreCount.toLocaleString("th-TH")} รายการ — พิมพ์เพื่อค้นหา</li>`);
    });
    list.innerHTML = items.join("");
  }

  function open(filterText = input.value) {
    renderList(filterText);
    if (!isOpen) {
      isOpen = true;
      if (usesTopLayer) list.showPopover();
      else list.hidden = false;
    }
    positionList();
    input.setAttribute("aria-expanded", "true");
  }

  function close() {
    if (isOpen) {
      isOpen = false;
      if (usesTopLayer) list.hidePopover();
      else list.hidden = true;
    }
    input.setAttribute("aria-expanded", "false");
    highlightedIndex = -1;
    isFilteredByTyping = false;
  }

  /**
   * รายการเปิดเพราะผู้ใช้พิมพ์ค้นหา (ไม่ใช่แค่เข้าช่อง) — ใช้ตัดสินว่า Tab = เลื่อนตัวเลือก
   * เข้าช่องด้วย Tab แล้วกด Tab ต่อ ยังไปช่องถัดไปได้ตามปกติ (ไม่ติดอยู่ในรายการ)
   */
  let isFilteredByTyping = false;

  function highlight(index) {
    highlightedIndex = Math.max(0, Math.min(visibleOptions.length - 1, index));
    list.querySelectorAll(".combobox-option").forEach((item) => {
      const isHighlighted = Number(item.dataset.index) === highlightedIndex;
      item.classList.toggle("is-active", isHighlighted);
      item.setAttribute("aria-selected", String(isHighlighted));
      if (isHighlighted) item.scrollIntoView({ block: "nearest" });
    });
  }

  function choose(option, { viaKeyboard = false } = {}) {
    if (!option) return;
    input.value = option.label;
    close();
    onSelect(option, { viaKeyboard });
  }

  input.addEventListener("input", () => {
    open(input.value);
    isFilteredByTyping = Boolean(input.value.trim());
  });
  input.addEventListener("focus", () => {
    if (typeof openOnFocus === "function" ? openOnFocus() : openOnFocus) open("");
  });
  input.addEventListener("keydown", (event) => {
    // พิมพ์ค้นหาแล้วมีตัวเลือก: Tab = ตัวถัดไป (ครั้งแรก = ตัวแรก), Shift+Tab = ตัวก่อนหน้า
    // เลยตัวสุดท้าย (หรือ Shift+Tab ที่ตัวแรก) → ออกจากช่องไปช่องถัดไปตามปกติ
    if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey
      && isOpen && isFilteredByTyping && visibleOptions.length) {
      const nextIndex = event.shiftKey ? highlightedIndex - 1 : highlightedIndex + 1;
      if (nextIndex >= 0 && nextIndex < visibleOptions.length && !(event.shiftKey && highlightedIndex < 0)) {
        event.preventDefault();
        highlight(nextIndex);
        return;
      }
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) open("");
      highlight(highlightedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight(highlightedIndex - 1);
    } else if (event.key === "Enter" && isOpen && highlightedIndex >= 0) {
      event.preventDefault(); // เลือกตัวเลือก ไม่ใช่ส่งฟอร์ม
      choose(visibleOptions[highlightedIndex], { viaKeyboard: true });
    } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && selectFirstOnEnter
      && isOpen && input.value.trim() && visibleOptions.length) {
      event.preventDefault();
      choose(visibleOptions[0], { viaKeyboard: true });
    } else if (event.key === "Escape" && isOpen) {
      event.stopPropagation();
      close();
    }
  });
  // ใช้ mousedown + preventDefault เพื่อไม่ให้ input เสียโฟกัสก่อนคลิกตัวเลือกสำเร็จ
  list.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const item = event.target.closest(".combobox-option");
    if (item) choose(visibleOptions[Number(item.dataset.index)]);
  });
  toggleButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (!isOpen) {
      input.focus();
      open("");
    } else {
      close();
    }
  });
  input.addEventListener("blur", close);

  return { open, close };
}

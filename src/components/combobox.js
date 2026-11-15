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

/** แสดงตัวเลือกได้มากสุดกี่รายการ (กันรายการยาวเกินเมื่อมีลูกค้าหลายพันราย) */
const MAX_VISIBLE_OPTIONS = 200;

/**
 * @typedef {{ value: string, label: string, group?: string, keywords?: string }} ComboboxOption
 */

/**
 * แปลง <input> ให้เป็น combobox
 * @param {object} config
 * @param {HTMLInputElement} config.input ช่องพิมพ์
 * @param {() => ComboboxOption[]} config.getOptions ฟังก์ชันคืนตัวเลือกล่าสุด (เรียกทุกครั้งที่เปิดรายการ)
 * @param {(option: ComboboxOption) => void} [config.onSelect] เรียกเมื่อผู้ใช้เลือกตัวเลือกจากรายการ
 * @param {string} [config.emptyText] ข้อความเมื่อไม่พบตัวเลือก
 */
export function createCombobox({ input, getOptions, onSelect = () => {}, emptyText = "ไม่พบในรายการ — ใช้ข้อความที่พิมพ์ได้เลย" }) {
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
  list.hidden = true;
  wrapper.appendChild(list);

  /** ตัวเลือกที่แสดงอยู่ (หลังกรอง) */
  let visibleOptions = [];
  let highlightedIndex = -1;

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
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    highlightedIndex = -1;
  }

  function highlight(index) {
    highlightedIndex = Math.max(0, Math.min(visibleOptions.length - 1, index));
    list.querySelectorAll(".combobox-option").forEach((item) => {
      const isHighlighted = Number(item.dataset.index) === highlightedIndex;
      item.classList.toggle("is-active", isHighlighted);
      item.setAttribute("aria-selected", String(isHighlighted));
      if (isHighlighted) item.scrollIntoView({ block: "nearest" });
    });
  }

  function choose(option) {
    if (!option) return;
    input.value = option.label;
    close();
    onSelect(option);
  }

  input.addEventListener("input", () => open(input.value));
  input.addEventListener("focus", () => open(""));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (list.hidden) open("");
      highlight(highlightedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight(highlightedIndex - 1);
    } else if (event.key === "Enter" && !list.hidden && highlightedIndex >= 0) {
      event.preventDefault(); // เลือกตัวเลือก ไม่ใช่ส่งฟอร์ม
      choose(visibleOptions[highlightedIndex]);
    } else if (event.key === "Escape" && !list.hidden) {
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
    if (list.hidden) {
      input.focus();
      open("");
    } else {
      close();
    }
  });
  input.addEventListener("blur", close);

  return { open, close };
}

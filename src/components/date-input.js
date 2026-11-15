/**
 * @file ช่องวันที่รูปแบบ วว/ดด/ปปปป ทุกหน้า
 *
 * ช่อง <input type="date"> ของเบราว์เซอร์แสดงรูปแบบตามภาษาของเครื่อง (เช่น ดด/วว/ปปปป บนเครื่องภาษาอังกฤษ)
 * สคริปต์นี้จึงซ้อนช่องข้อความที่แสดง "วว/ดด/ปปปป" ไว้ด้านหน้า และซ่อนช่องวันที่จริงไว้ด้านหลัง
 *
 * - ช่องวันที่จริง (id เดิม) ยังเก็บค่าแบบ ISO "YYYY-MM-DD" → โค้ดของแต่ละหน้าไม่ต้องแก้
 * - พิมพ์วันที่เอง (เช่น 05/11/2026, 5/11/26, 05112026 หรือปี พ.ศ. 2569) หรือกดไอคอนปฏิทินเพื่อเลือก
 * - เมื่อผู้ใช้เปลี่ยนวันที่ จะส่งอีเวนต์ input/change ที่ช่องวันที่จริง ให้หน้าเว็บทำงานเหมือนเดิม
 * - เมื่อโค้ดตั้งค่า .value หรือรีเซ็ตฟอร์ม ช่องที่แสดงจะอัปเดตตามอัตโนมัติ
 *
 * โหลดแบบสคริปต์ธรรมดา (defer) ก่อนสคริปต์ module ของหน้า
 */
(() => {
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const CALENDAR_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

  /** "YYYY-MM-DD" → "DD/MM/YYYY" */
  function toDisplay(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
  }

  /**
   * ข้อความที่ผู้ใช้พิมพ์ → "YYYY-MM-DD"
   * @returns {string | null} สตริงว่าง = ล้างค่า, null = รูปแบบไม่ถูกต้อง
   */
  function parseDisplay(text) {
    const value = text.trim();
    if (!value) return "";
    let match = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})$/.exec(value);
    if (!match) {
      const digits = /^(\d{2})(\d{2})(\d{4})$/.exec(value);
      if (!digits) return null;
      match = digits;
    }
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (match[3].length === 2) year += 2000;
    if (year > 2400) year -= 543; // ปี พ.ศ. → ค.ศ.
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function enhance(dateInput) {
    if (dateInput.dataset.dateEnhanced) return;
    dateInput.dataset.dateEnhanced = "1";

    const wrapper = document.createElement("span");
    wrapper.className = "date-field";
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "date-field-text";
    textInput.inputMode = "numeric";
    textInput.autocomplete = "off";
    textInput.placeholder = "วว/ดด/ปปปป";
    textInput.maxLength = 10;
    if (dateInput.title) textInput.title = dateInput.title;
    // ย้าย required ไปที่ช่องที่มองเห็น (ช่องที่ซ่อนอยู่แสดงข้อความเตือนของเบราว์เซอร์ไม่ได้)
    if (dateInput.required) {
      textInput.required = true;
      dateInput.required = false;
    }
    const pickerButton = document.createElement("button");
    pickerButton.type = "button";
    pickerButton.className = "date-field-button";
    pickerButton.tabIndex = -1;
    pickerButton.title = "เลือกจากปฏิทิน";
    pickerButton.setAttribute("aria-label", "เลือกจากปฏิทิน");
    pickerButton.innerHTML = CALENDAR_ICON;

    dateInput.parentNode.insertBefore(wrapper, dateInput);
    wrapper.append(textInput, pickerButton, dateInput);
    dateInput.classList.add("date-field-native");
    dateInput.tabIndex = -1;
    dateInput.setAttribute("aria-hidden", "true");

    const syncDisplay = () => {
      textInput.value = toDisplay(nativeValue.get.call(dateInput));
      textInput.setCustomValidity("");
      textInput.disabled = dateInput.disabled;
    };

    // โค้ดของหน้าตั้งค่า dateInput.value = "..." → อัปเดตช่องที่แสดงด้วย
    Object.defineProperty(dateInput, "value", {
      configurable: true,
      get() { return nativeValue.get.call(this); },
      set(newValue) {
        nativeValue.set.call(this, newValue);
        syncDisplay();
      },
    });

    /** ยืนยันข้อความที่พิมพ์ → เขียนลงช่องวันที่จริงและแจ้งหน้าเว็บ */
    const commitText = () => {
      const isoDate = parseDisplay(textInput.value);
      if (isoDate === null) {
        textInput.setCustomValidity("รูปแบบวันที่ต้องเป็น วว/ดด/ปปปป");
        textInput.reportValidity();
        return false;
      }
      textInput.setCustomValidity("");
      if (isoDate !== nativeValue.get.call(dateInput)) {
        nativeValue.set.call(dateInput, isoDate);
        dateInput.dispatchEvent(new Event("input", { bubbles: true }));
        dateInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      textInput.value = toDisplay(isoDate);
      return true;
    };

    // ใส่ "/" ให้อัตโนมัติขณะพิมพ์ตัวเลข: 05 → 05/ , 05/11 → 05/11/
    textInput.addEventListener("input", (event) => {
      if (event.inputType && event.inputType.startsWith("delete")) return;
      if (/^\d{2}$/.test(textInput.value) || /^\d{1,2}\/\d{2}$/.test(textInput.value)) textInput.value += "/";
    });
    textInput.addEventListener("change", (event) => {
      event.stopPropagation(); // หน้าเว็บฟังอีเวนต์จากช่องวันที่จริงแทน
      commitText();
    });
    textInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !commitText()) event.preventDefault();
    });

    pickerButton.addEventListener("click", () => {
      try {
        dateInput.showPicker();
      } catch {
        dateInput.focus();
        dateInput.click();
      }
    });
    // เลือกจากปฏิทิน → แสดงผลใหม่ (อีเวนต์เดิมของช่องวันที่จริงส่งต่อให้หน้าเว็บตามปกติ)
    dateInput.addEventListener("input", syncDisplay);
    dateInput.addEventListener("change", syncDisplay);
    // form.reset() ไม่เรียก setter ของ value จึงต้องอัปเดตหลังรีเซ็ตเสร็จ
    if (dateInput.form) dateInput.form.addEventListener("reset", () => setTimeout(syncDisplay));

    syncDisplay();
  }

  const enhanceAll = (root) => {
    if (root.matches && root.matches('input[type="date"]')) enhance(root);
    if (root.querySelectorAll) root.querySelectorAll('input[type="date"]').forEach(enhance);
  };

  enhanceAll(document);
  // ช่องวันที่ที่สร้างภายหลัง (เช่น ในกล่องโต้ตอบ)
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1) enhanceAll(node);
    }));
  }).observe(document.documentElement, { childList: true, subtree: true });
})();

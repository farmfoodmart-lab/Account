/**
 * @file ธีมสว่าง/มืด
 *
 * โหลดใน <head> (สคริปต์ธรรมดา ไม่ใช่ module) เพื่อกำหนดธีมก่อนวาดหน้าครั้งแรก — หน้าจะไม่กะพริบ
 * ธีมเก็บใน localStorage ถ้ายังไม่เคยเลือก จะใช้ตามการตั้งค่าของระบบปฏิบัติการ
 * ปุ่มสลับธีมในเมนูเรียกใช้ผ่าน window.AppTheme (ดู app-shell.js)
 */
(() => {
  const THEME_STORAGE_KEY = "accounting_theme";
  const rootElement = document.documentElement;

  /** @returns {"light" | "dark" | null} ธีมที่ผู้ใช้เลือกไว้ */
  function readSavedTheme() {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    } catch {
      // localStorage ถูกปิดกั้น: ใช้ธีมของระบบแทน
    }
    return null;
  }

  function getSystemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  /** ใส่ธีมที่ <html data-theme> (CSS ใช้ค่านี้) แล้วแจ้งปุ่มธีมให้อัปเดตไอคอน */
  function applyTheme(theme) {
    rootElement.dataset.theme = theme;
    rootElement.style.colorScheme = theme;
    document.dispatchEvent(new CustomEvent("app-theme-change", { detail: theme }));
  }

  applyTheme(readSavedTheme() || getSystemTheme());

  window.AppTheme = {
    /** @returns {"light" | "dark"} */
    get() {
      return rootElement.dataset.theme === "dark" ? "dark" : "light";
    },
    /** สลับธีมและจำไว้ */
    toggle() {
      const nextTheme = this.get() === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch {
        // บันทึกไม่ได้ก็ไม่เป็นไร ธีมยังเปลี่ยนในหน้านี้
      }
      return nextTheme;
    },
  };
})();

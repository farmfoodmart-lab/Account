/**
 * @file ป๊อปอัปแจ้งเตือน
 *
 * - notify / notifySuccess : ป๊อปอัปเล็กกลางด้านบนของจอ แสดงสักครู่แล้วหายไปเอง (ไม่ขัดจังหวะการทำงาน)
 * - notifyError            : ป๊อปอัปกลางจอพร้อมปุ่ม "ตกลง" ผู้ใช้ต้องกดรับทราบ (ข้อผิดพลาดต้องไม่พลาดสายตา)
 * - logAlert               : เก็บการแจ้งเตือนที่ผิดปกติไว้ในกระดิ่งบนแถบเมนู (notifyError เรียกให้อัตโนมัติ)
 * - setStandingAlert / clearStandingAlert : แจ้งเตือนแบบสถานะค้างในกระดิ่ง (เช่น มีรายการต้องซ่อมแซม) หายเองเมื่อแก้แล้ว
 *
 * ไฟล์นี้ไม่ import ไฟล์อื่นเลย จึงใช้ได้จากทุกชั้นของโปรเจกต์ (รวมถึง core/store.js)
 * กล่องรับป๊อปอัป <div id="toasts"> ถูกสร้างโดย app-shell.js (ถ้าไม่มี จะสร้างให้เอง)
 */

/** แสดงป๊อปอัปแบบหายเองนานเท่าใดก่อนเริ่มจางหาย (มิลลิวินาที) */
const VISIBLE_DURATION_MS = 2600;
/** ระยะเวลาแอนิเมชันจางหาย ต้องตรงกับ CSS .toast.out */
const FADE_OUT_DURATION_MS = 220;

const ICONS = { info: "i", success: "✓", error: "!" };

/**
 * ที่เก็บการแจ้งเตือนผิดปกติในเบราว์เซอร์นี้ (กระดิ่งใน app-shell.js อ่านจากคีย์เดียวกัน)
 * ⚠️ ห้ามเปลี่ยนชื่อคีย์และชื่ออีเวนต์ เพราะ app-shell.js ใช้ร่วมกัน
 */
const ALERT_STORAGE_KEY = "app_alerts";
const ALERT_CHANGED_EVENT = "app-alerts-changed";
/** เก็บไว้มากสุดกี่รายการ (เก่าสุดถูกลบก่อน) */
const MAX_ALERTS = 100;
/** ข้อความเดิมซ้ำภายในช่วงนี้ = นับรวมเป็นรายการเดียว (มิลลิวินาที) */
const DUPLICATE_WINDOW_MS = 60 * 1000;

/**
 * เก็บการแจ้งเตือนที่ผิดปกติไว้ในกระดิ่ง (ไม่แสดงป๊อปอัป)
 * @param {string} message
 * @param {{ title?: string }} [options]
 */
export function logAlert(message, { title = "แจ้งเตือน" } = {}) {
  try {
    const alerts = JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY) || "[]");
    const now = Date.now();
    const latest = alerts[0];
    if (latest && latest.message === message && latest.title === title && now - latest.time < DUPLICATE_WINDOW_MS) {
      latest.count = (latest.count || 1) + 1;
      latest.time = now;
      latest.read = false;
    } else {
      alerts.unshift({
        id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        time: now,
        title,
        message: String(message),
        page: location.pathname,
        pageTitle: document.title.split("·")[0].trim(),
        read: false,
      });
    }
    localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alerts.slice(0, MAX_ALERTS)));
    window.dispatchEvent(new Event(ALERT_CHANGED_EVENT));
  } catch {
    // เบราว์เซอร์ปิดการใช้ localStorage → ข้ามการเก็บประวัติ (ป๊อปอัปยังแสดงตามปกติ)
  }
}

/**
 * การแจ้งเตือนแบบ "สถานะค้าง" ในกระดิ่ง: มีได้รายการเดียวต่อ id อัปเดตแทนที่ ไม่ซ้อนกัน
 * - ค้างเป็นสีแดงบนกระดิ่งตลอด (เปิดดูแล้วก็ยังนับเป็นยังไม่ได้อ่าน และลบเองไม่ได้) จนกว่าจะเรียก clearStandingAlert
 * @param {string} id รหัสคงที่ของเรื่องนี้ เช่น "doc-number-repair"
 * @param {string} message
 * @param {{ title?: string, page?: string, pageTitle?: string }} [options] page = ลิงก์ไปหน้าที่แก้ไขได้
 */
export function setStandingAlert(id, message, { title = "แจ้งเตือน", page = location.pathname, pageTitle } = {}) {
  try {
    const alerts = JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY) || "[]");
    const existing = alerts.find((alert) => alert.id === id);
    if (existing && existing.sticky && existing.message === message && existing.title === title) return;
    const alert = {
      id,
      time: Date.now(),
      title,
      message: String(message),
      page,
      pageTitle: pageTitle || document.title.split("·")[0].trim(),
      read: false,
      sticky: true, // app-shell.js: นับเป็นยังไม่ได้อ่านเสมอ ซ่อนปุ่มลบ และ "ล้างทั้งหมด" ไม่ลบ
    };
    const otherAlerts = alerts.filter((item) => item.id !== id);
    localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify([alert, ...otherAlerts].slice(0, MAX_ALERTS)));
    window.dispatchEvent(new Event(ALERT_CHANGED_EVENT));
  } catch {
    // เบราว์เซอร์ปิดการใช้ localStorage → ข้าม
  }
}

/**
 * ลบการแจ้งเตือนแบบสถานะค้าง เมื่อปัญหาหายไปแล้ว
 * @param {string} id
 */
export function clearStandingAlert(id) {
  try {
    const alerts = JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY) || "[]");
    if (!alerts.some((alert) => alert.id === id)) return;
    localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alerts.filter((alert) => alert.id !== id)));
    window.dispatchEvent(new Event(ALERT_CHANGED_EVENT));
  } catch {
    // เบราว์เซอร์ปิดการใช้ localStorage → ข้าม
  }
}

function getPopupContainer() {
  let container = document.getElementById("toasts");
  if (!container) {
    container = document.createElement("div");
    container.id = "toasts";
    container.className = "toasts";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  return container;
}

/**
 * ป๊อปอัปแจ้งข้อมูลที่หายไปเอง
 * @param {string} message
 * @param {"info" | "success"} [variant="info"]
 */
export function notify(message, variant = "info") {
  const popup = document.createElement("div");
  popup.className = `toast ${variant}`;
  popup.setAttribute("role", "status");
  popup.innerHTML = `<span class="toast-icon" aria-hidden="true">${ICONS[variant] || ICONS.info}</span><span class="toast-message"></span>`;
  popup.querySelector(".toast-message").textContent = message;
  getPopupContainer().appendChild(popup);

  const dismiss = () => {
    popup.classList.add("out");
    window.setTimeout(() => popup.remove(), FADE_OUT_DURATION_MS);
  };
  popup.addEventListener("click", dismiss); // คลิกเพื่อปิดก่อนเวลาได้
  window.setTimeout(dismiss, VISIBLE_DURATION_MS);
}

/** แจ้งว่าทำรายการสำเร็จ */
export function notifySuccess(message) {
  notify(message, "success");
}

/**
 * ป๊อปอัปแจ้งข้อผิดพลาดกลางจอ ต้องกด "ตกลง" เพื่อปิด
 * @param {string} message
 * @param {{ title?: string }} [options]
 * @returns {Promise<void>} resolve เมื่อผู้ใช้ปิดป๊อปอัป (ใช้ await เพื่อโฟกัสช่องที่ผิดต่อได้)
 */
export function notifyError(message, { title = "ไม่สามารถทำรายการได้" } = {}) {
  logAlert(message, { title });
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog is-error";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-labelledby", "app-error-title");
    dialog.innerHTML = `
      <form method="dialog">
        <div class="app-dialog-mark" aria-hidden="true">${ICONS.error}</div>
        <h2 id="app-error-title"></h2>
        <p class="app-dialog-message"></p>
        <div class="app-dialog-actions"><button type="submit" value="ok" autofocus>ตกลง</button></div>
      </form>`;
    // ใช้ textContent เพื่อไม่ให้ข้อความถูกตีความเป็น HTML
    dialog.querySelector("#app-error-title").textContent = title;
    dialog.querySelector(".app-dialog-message").textContent = message;
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    }, { once: true });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

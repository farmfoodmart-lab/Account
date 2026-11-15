/**
 * @file กล่องโต้ตอบ (modal dialog) ที่ใช้ทั้งระบบ
 *
 * ทุกฟังก์ชันคืนค่าเป็น Promise เพื่อให้เรียกแบบ `await` ได้ เช่น
 *   if (!(await confirmDialog("ลบรายการนี้?"))) return;
 */

/**
 * แปลงอักขระพิเศษของ HTML (ใช้ภายในไฟล์นี้ เพื่อให้คอมโพเนนต์ไม่ต้องพึ่งไฟล์อื่น)
 * @param {unknown} text
 * @returns {string}
 */
function escapeAttribute(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/**
 * กล่องยืนยันการทำรายการ
 * @param {string} message ข้อความอธิบาย
 * @param {object} [options]
 * @param {string} [options.title="ยืนยันการทำรายการ"] หัวข้อ
 * @param {string} [options.confirmText="ยืนยัน"] ข้อความบนปุ่มยืนยัน
 * @param {"danger" | "primary"} [options.tone="danger"] danger = ปุ่มสีแดง (เช่นการลบ), primary = ปุ่มสีหลัก
 * @returns {Promise<boolean>} true เมื่อผู้ใช้กดยืนยัน
 */
export function confirmDialog(message, options = {}) {
  const { title = "ยืนยันการทำรายการ", confirmText = "ยืนยัน", tone = "danger" } = options;
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = `app-dialog${tone === "primary" ? " is-prompt" : ""}`;
    dialog.setAttribute("aria-labelledby", "app-dialog-title");
    dialog.innerHTML = `
      <form method="dialog">
        <div class="app-dialog-mark" aria-hidden="true">${tone === "primary" ? "i" : "!"}</div>
        <h2 id="app-dialog-title"></h2>
        <p class="app-dialog-message"></p>
        <div class="app-dialog-actions">
          <button type="submit" class="secondary" value="cancel" autofocus>ยกเลิก</button>
          <button type="submit" value="confirm"></button>
        </div>
      </form>`;
    // ใช้ textContent เพื่อให้ข้อความจากผู้ใช้ไม่ถูกตีความเป็น HTML
    dialog.querySelector("#app-dialog-title").textContent = title;
    dialog.querySelector('button[value="confirm"]').textContent = confirmText;
    dialog.querySelector(".app-dialog-message").textContent = message;

    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm");
      dialog.remove();
    }, { once: true });

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/**
 * @typedef {object} DialogField ช่องกรอกข้อมูลหนึ่งช่องในกล่องฟอร์ม
 * @property {string} name ชื่อคีย์ของค่าที่จะคืนกลับ
 * @property {string} label ป้ายกำกับ
 * @property {"text" | "number" | "date" | "select" | "checkbox"} [type="text"]
 * @property {string | number | boolean} [value] ค่าเริ่มต้น
 * @property {Array<{value: string, label: string, group?: string}>} [options] ตัวเลือก (เฉพาะ select)
 * @property {number | string} [min]
 * @property {number | string} [max]
 * @property {string} [step]
 * @property {boolean} [required]
 * @property {string} [hint] คำอธิบายใต้ช่องกรอก
 */

/**
 * สร้าง HTML ของช่องกรอกหนึ่งช่อง
 * @param {DialogField} field
 * @returns {string}
 */
function renderField(field) {
  const name = escapeAttribute(field.name);
  const label = escapeAttribute(field.label);
  const hint = field.hint ? `<span class="hint-text">${escapeAttribute(field.hint)}</span>` : "";

  if (field.type === "checkbox") {
    return `<label class="field check-field"><input type="checkbox" name="${name}"${field.value ? " checked" : ""}> <span>${label}</span></label>`;
  }

  if (field.type === "select") {
    let optionsHtml = "";
    let currentGroup = null;
    (field.options || []).forEach((option) => {
      // จัดตัวเลือกที่มี group เดียวกันไว้ใน <optgroup> เดียวกัน
      if (option.group !== undefined && option.group !== currentGroup) {
        if (currentGroup !== null) optionsHtml += "</optgroup>";
        optionsHtml += `<optgroup label="${escapeAttribute(option.group)}">`;
        currentGroup = option.group;
      }
      const selected = String(option.value) === String(field.value) ? " selected" : "";
      optionsHtml += `<option value="${escapeAttribute(option.value)}"${selected}>${escapeAttribute(option.label)}</option>`;
    });
    if (currentGroup !== null) optionsHtml += "</optgroup>";
    return `<label class="field"><span>${label}</span><select name="${name}"${field.required ? " required" : ""}>${optionsHtml}</select>${hint}</label>`;
  }

  const attributes = [
    `type="${escapeAttribute(field.type || "text")}"`,
    `name="${name}"`,
    `value="${escapeAttribute(field.value)}"`,
    field.min != null ? `min="${escapeAttribute(field.min)}"` : "",
    field.max != null ? `max="${escapeAttribute(field.max)}"` : "",
    field.step ? `step="${escapeAttribute(field.step)}"` : "",
    field.required ? "required" : "",
  ].join(" ");
  return `<label class="field"><span>${label}</span><input ${attributes}>${hint}</label>`;
}

/**
 * กล่องฟอร์มหลายช่อง เช่น กล่องรับชำระเงิน (วันที่ / จำนวนเงิน / บัญชี)
 * @param {object} options
 * @param {string} options.title หัวข้อ
 * @param {string} [options.message] ข้อความอธิบายใต้หัวข้อ
 * @param {DialogField[]} options.fields ช่องกรอกข้อมูล
 * @param {string} [options.confirmText="บันทึก"] ข้อความบนปุ่มยืนยัน
 * @param {string} [options.icon="฿"] สัญลักษณ์ที่มุมบนซ้าย
 * @returns {Promise<Record<string, string | boolean> | null>} ค่าที่กรอก ({ name: value }) หรือ null เมื่อกดยกเลิก
 */
export function formDialog({ title, message = "", fields, confirmText = "บันทึก", icon = "฿" }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog is-prompt";
    dialog.setAttribute("aria-labelledby", "app-dialog-title");
    dialog.innerHTML = `
      <form method="dialog">
        <div class="app-dialog-mark" aria-hidden="true">${escapeAttribute(icon)}</div>
        <h2 id="app-dialog-title">${escapeAttribute(title)}</h2>
        ${message ? `<p class="app-dialog-message">${escapeAttribute(message)}</p>` : ""}
        ${fields.map(renderField).join("")}
        <div class="app-dialog-actions">
          <button type="button" class="secondary" data-cancel>ยกเลิก</button>
          <button type="submit" value="confirm">${escapeAttribute(confirmText)}</button>
        </div>
      </form>`;

    const form = dialog.querySelector("form");
    let submittedValues = null;

    dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
    // เบราว์เซอร์ตรวจ required/min/max ให้ก่อนเกิด submit จึงเก็บค่าได้ทันที
    form.addEventListener("submit", () => {
      submittedValues = {};
      fields.forEach((field) => {
        const input = form.elements[field.name];
        submittedValues[field.name] = field.type === "checkbox" ? input.checked : input.value;
      });
    });
    dialog.addEventListener("close", () => {
      resolve(submittedValues);
      dialog.remove();
    }, { once: true });

    document.body.appendChild(dialog);
    dialog.showModal();
    const firstInput = form.querySelector("input:not([type=checkbox]), select");
    if (firstInput) firstInput.focus();
  });
}

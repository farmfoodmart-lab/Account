/**
 * Small UI helpers shared across the app: toast notifications and file downloads.
 */

const TOAST_DURATION_MS = 3200;
const TOAST_FADE_MS = 220;

/**
 * Show a transient message in the bottom-right corner.
 * @param {string} message
 * @param {'info'|'success'|'error'} variant
 */
export function toast(message, variant = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;

  const toastElement = document.createElement('div');
  toastElement.className = `toast ${variant}`;
  toastElement.textContent = message;
  host.appendChild(toastElement);

  window.setTimeout(() => {
    toastElement.classList.add('out');
    window.setTimeout(() => toastElement.remove(), TOAST_FADE_MS);
  }, TOAST_DURATION_MS);
}

export function toastSuccess(message) {
  toast(message, 'success');
}

export function toastError(message) {
  toast(message, 'error');
}

/**
 * Modal confirmation. Resolves true when the user confirms.
 * @param {string} message
 * @param {{title?: string, confirmText?: string, tone?: 'danger'|'primary'}} [options]
 */
export function confirmAction(message, options = {}) {
  const { title = 'ยืนยันการทำรายการ', confirmText = 'ยืนยัน', tone = 'danger' } = options;
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = `app-dialog${tone === 'primary' ? ' is-prompt' : ''}`;
    dialog.setAttribute('aria-labelledby', 'app-dialog-title');
    dialog.innerHTML = `
      <form method="dialog">
        <div class="app-dialog-mark" aria-hidden="true">${tone === 'primary' ? 'i' : '!'}</div>
        <h2 id="app-dialog-title"></h2>
        <p class="app-dialog-message"></p>
        <div class="app-dialog-actions">
          <button type="submit" class="secondary" value="cancel" autofocus>ยกเลิก</button>
          <button type="submit" value="confirm"></button>
        </div>
      </form>`;
    dialog.querySelector('#app-dialog-title').textContent = title;
    dialog.querySelector('button[value="confirm"]').textContent = confirmText;
    dialog.querySelector('.app-dialog-message').textContent = message;
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
      dialog.remove();
    }, { once: true });

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/**
 * Modal with a single input. Resolves the entered string, or null on cancel.
 * @param {{title: string, message?: string, label: string, type?: string, value?: string|number,
 *          min?: number, max?: number, step?: string, confirmText?: string}} options
 */
export function promptDialog(options) {
  const {
    title,
    message = '',
    label,
    type = 'text',
    value = '',
    min,
    max,
    step,
    confirmText = 'ตกลง',
  } = options;
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog is-prompt';
    dialog.setAttribute('aria-labelledby', 'app-dialog-title');
    dialog.innerHTML = `
      <form method="dialog">
        <div class="app-dialog-mark" aria-hidden="true">฿</div>
        <h2 id="app-dialog-title"></h2>
        <p class="app-dialog-message"></p>
        <label class="field"><span class="prompt-label"></span><input name="value"></label>
        <div class="app-dialog-actions">
          <button type="button" class="secondary" data-cancel>ยกเลิก</button>
          <button type="submit" value="confirm"></button>
        </div>
      </form>`;
    dialog.querySelector('#app-dialog-title').textContent = title;
    const messageElement = dialog.querySelector('.app-dialog-message');
    messageElement.textContent = message;
    messageElement.hidden = !message;
    dialog.querySelector('.prompt-label').textContent = label;
    dialog.querySelector('button[value="confirm"]').textContent = confirmText;
    const input = dialog.querySelector('input');
    input.type = type;
    input.value = value;
    if (min != null) input.min = String(min);
    if (max != null) input.max = String(max);
    if (step) input.step = step;
    input.required = true;

    let result = null;
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', () => {
      result = input.value;
    });
    dialog.addEventListener('close', () => {
      resolve(result);
      dialog.remove();
    }, { once: true });
    document.body.appendChild(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}

/**
 * Modal form with several fields. Resolves { name: value } or null on cancel.
 * Field: { name, label, type?: 'text'|'number'|'date'|'select'|'checkbox', value?, options?: [{value,label,group?}],
 *          min?, max?, step?, required?, hint? }
 */
export function formDialog({ title, message = '', fields, confirmText = 'บันทึก', icon = '฿' }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog is-prompt';
    dialog.setAttribute('aria-labelledby', 'app-dialog-title');
    const escape = (text) => String(text == null ? '' : text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const fieldHtml = fields.map((field) => {
      if (field.type === 'checkbox') {
        return `<label class="field check-field"><input type="checkbox" name="${escape(field.name)}"${field.value ? ' checked' : ''}> <span>${escape(field.label)}</span></label>`;
      }
      if (field.type === 'select') {
        let lastGroup = null;
        let options = '';
        (field.options || []).forEach((option) => {
          if (option.group !== undefined && option.group !== lastGroup) {
            if (lastGroup !== null) options += '</optgroup>';
            options += `<optgroup label="${escape(option.group)}">`;
            lastGroup = option.group;
          }
          options += `<option value="${escape(option.value)}"${String(option.value) === String(field.value) ? ' selected' : ''}>${escape(option.label)}</option>`;
        });
        if (lastGroup !== null) options += '</optgroup>';
        return `<label class="field"><span>${escape(field.label)}</span><select name="${escape(field.name)}"${field.required ? ' required' : ''}>${options}</select>${field.hint ? `<span class="hint-text">${escape(field.hint)}</span>` : ''}</label>`;
      }
      const attrs = [
        `type="${escape(field.type || 'text')}"`,
        `name="${escape(field.name)}"`,
        `value="${escape(field.value)}"`,
        field.min != null ? `min="${escape(field.min)}"` : '',
        field.max != null ? `max="${escape(field.max)}"` : '',
        field.step ? `step="${escape(field.step)}"` : '',
        field.required ? 'required' : '',
      ].join(' ');
      return `<label class="field"><span>${escape(field.label)}</span><input ${attrs}>${field.hint ? `<span class="hint-text">${escape(field.hint)}</span>` : ''}</label>`;
    }).join('');
    dialog.innerHTML = `
      <form method="dialog">
        <div class="app-dialog-mark" aria-hidden="true">${escape(icon)}</div>
        <h2 id="app-dialog-title">${escape(title)}</h2>
        ${message ? `<p class="app-dialog-message">${escape(message)}</p>` : ''}
        ${fieldHtml}
        <div class="app-dialog-actions">
          <button type="button" class="secondary" data-cancel>ยกเลิก</button>
          <button type="submit" value="confirm">${escape(confirmText)}</button>
        </div>
      </form>`;
    let result = null;
    const form = dialog.querySelector('form');
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', () => {
      result = {};
      fields.forEach((field) => {
        const input = form.elements[field.name];
        result[field.name] = field.type === 'checkbox' ? input.checked : input.value;
      });
    });
    dialog.addEventListener('close', () => {
      resolve(result);
      dialog.remove();
    }, { once: true });
    document.body.appendChild(dialog);
    dialog.showModal();
    const first = form.querySelector('input:not([type=checkbox]), select');
    if (first) first.focus();
  });
}

export function debounce(fn, wait = 160) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

/**
 * Trigger a browser download for arbitrary text content.
 */
export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download CSV with a UTF-8 BOM so Excel opens Thai text correctly.
 */
export function downloadCsvFile(filename, csv) {
  downloadText(filename, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}

export function downloadJson(filename, data) {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}

export function todayIso() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function fileStamp() {
  return todayIso().replace(/-/g, '');
}

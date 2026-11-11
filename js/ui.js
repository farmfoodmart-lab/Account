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

export function confirmAction(message) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';
    dialog.setAttribute('aria-labelledby', 'app-dialog-title');
    dialog.innerHTML = `
      <form method="dialog">
        <div class="app-dialog-mark" aria-hidden="true">?</div>
        <h2 id="app-dialog-title">ยืนยันการทำรายการ</h2>
        <p class="app-dialog-message"></p>
        <div class="app-dialog-actions">
          <button type="submit" class="secondary" value="cancel" autofocus>ยกเลิก</button>
          <button type="submit" value="confirm">ยืนยัน</button>
        </div>
      </form>`;
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

import { fmtInt, load, replaceState, save, state } from "../../js/data.js";
import {
  confirmAction,
  downloadJson,
  fileStamp,
  toastError,
  toastSuccess,
} from "../../js/ui.js";

const settingsForm = document.getElementById("settings-form");
const backupStatusMessage = document.getElementById("backup-msg");
const backupFileInput = document.getElementById("backup-import");

function renderSettings() {
  const settings = state.settings || {};
  document.getElementById("settings-company").value = settings.company || "";
  document.getElementById("settings-period-start").value = settings.periodStart || "";
  document.getElementById("settings-period-end").value = settings.periodEnd || "";
  document.getElementById("settings-currency").value = settings.currency || "THB";
  document.getElementById("settings-note").value = settings.note || "";
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const periodStart = document.getElementById("settings-period-start").value;
  const periodEnd = document.getElementById("settings-period-end").value;
  if (periodStart && periodEnd && periodStart > periodEnd) {
    toastError("วันที่เริ่มต้นงวดต้องไม่มากกว่าวันที่สิ้นสุด");
    return;
  }
  const previous = JSON.parse(JSON.stringify(state));
  replaceState({
    ...state,
    settings: {
      company: document.getElementById("settings-company").value.trim(),
      periodStart,
      periodEnd,
      currency: document.getElementById("settings-currency").value.trim() || "THB",
      note: document.getElementById("settings-note").value.trim(),
    },
  });
  if (!(await save(["settings"]))) {
    replaceState(previous);
    renderSettings();
    return;
  }
  toastSuccess("บันทึกการตั้งค่าเรียบร้อย");
});

document.getElementById("backup-export").addEventListener("click", () => {
  downloadJson(`accounting-backup-${fileStamp()}.json`, {
    exportedAt: new Date().toISOString(),
    version: 1,
    data: state,
  });
  backupStatusMessage.textContent = "ดาวน์โหลดไฟล์สำรองข้อมูลเรียบร้อย";
  toastSuccess("สำรองข้อมูลเรียบร้อย");
});

backupFileInput.addEventListener("change", async () => {
  const file = backupFileInput.files[0];
  if (!file) return;
  if (!(await confirmAction(`กู้คืนข้อมูลจากไฟล์ "${file.name}"? ข้อมูลปัจจุบันจะถูกเขียนทับทั้งหมด`))) {
    backupFileInput.value = "";
    return;
  }
  const previous = JSON.parse(JSON.stringify(state));
  try {
    const parsed = JSON.parse(await file.text());
    const payload = parsed && parsed.data ? parsed.data : parsed;
    if (!payload || !Array.isArray(payload.accounts)) {
      throw new Error("ไฟล์ไม่ใช่ไฟล์สำรองของระบบนี้");
    }
    replaceState(payload);
    if (!(await save())) {
      replaceState(previous);
      renderSettings();
      backupStatusMessage.textContent = "กู้คืนไม่สำเร็จ: บันทึกข้อมูลไม่ผ่าน";
      return;
    }
    renderSettings();
    backupStatusMessage.textContent = `กู้คืนข้อมูลเรียบร้อย (${fmtInt(state.accounts.length)} บัญชี, ${fmtInt(state.entries.length)} รายการ)`;
    toastSuccess("กู้คืนข้อมูลเรียบร้อย");
  } catch (error) {
    replaceState(previous);
    renderSettings();
    console.error(error);
    backupStatusMessage.textContent = `กู้คืนไม่สำเร็จ: ${error.message || error}`;
    toastError("กู้คืนข้อมูลไม่สำเร็จ");
  } finally {
    backupFileInput.value = "";
  }
});

if (await load()) renderSettings();

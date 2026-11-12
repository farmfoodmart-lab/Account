import {
  ACCOUNT_ROLES,
  AMOUNT_EPSILON,
  accountLabel,
  accountOptionsHtml,
  authReady,
  fmt,
  fmtDateDMY,
  fmtInt,
  isLocked,
  load,
  onDataRefresh,
  replaceState,
  roleAccount,
  save,
  state,
} from "../../js/data.js";
import { accountNet, collectTotals } from "../../js/reports.js";
import { round2, sortEntries, upsertEntry } from "../../js/posting.js";
import {
  confirmAction,
  downloadJson,
  fileStamp,
  toastError,
  toastSuccess,
} from "../../js/ui.js";

const $ = (id) => document.getElementById(id);
const settingsForm = $("settings-form");
const backupStatusMessage = $("backup-msg");
const backupFileInput = $("backup-import");

function renderAccountMap() {
  const map = state.settings.accountMap || {};
  $("settings-account-map").innerHTML = Object.entries(ACCOUNT_ROLES).map(([role, config]) => {
    const resolved = roleAccount(role);
    const hint = map[role] ? "" : resolved ? `อัตโนมัติ: ${accountLabel(resolved)}` : "ไม่พบบัญชีที่เหมาะสม";
    return `<label class="field"><span>${config.label}</span><select data-role="${role}">${accountOptionsHtml(map[role] || "", "— เลือกอัตโนมัติ —")}</select><span class="hint-text">${hint}</span></label>`;
  }).join("");
}

function renderLockStatus() {
  const lock = state.settings.lockDate;
  $("lock-status").innerHTML = lock
    ? `<span class="badge warning dot">ล็อกถึง ${fmtDateDMY(lock)}</span>`
    : '<span class="badge">ยังไม่ล็อกงวด</span>';
  $("lock-date").value = lock || "";
}

/** Revenue/expense balances up to `date` that a closing entry would transfer. */
function closingPreview(date) {
  const totals = collectTotals(state.entries, { to: date });
  const rows = state.accounts
    .filter((account) => account.type === "revenue" || account.type === "expense")
    .map((account) => ({ account, net: round2(accountNet(account, totals)) }))
    .filter((row) => Math.abs(row.net) >= AMOUNT_EPSILON);
  const profit = rows.reduce((sum, row) => sum + (row.account.type === "revenue" ? row.net : -row.net), 0);
  return { rows, profit: round2(profit) };
}

function renderClosePreview() {
  const date = $("close-date").value;
  if (!date) {
    $("close-preview").textContent = "เลือกวันที่สิ้นงวดเพื่อดูยอดที่จะปิด";
    return;
  }
  const { rows, profit } = closingPreview(date);
  const retained = roleAccount("retained");
  $("close-preview").innerHTML = rows.length
    ? `ปิด ${fmtInt(rows.length)} บัญชี · ${profit >= 0 ? "กำไร" : "ขาดทุน"}สุทธิ <strong>${fmt(Math.abs(profit))}</strong> โอนเข้า ${retained ? accountLabel(retained) : '<span class="unbalanced">ยังไม่มีบัญชีกำไรสะสม</span>'}`
    : "ไม่มียอดรายได้/ค่าใช้จ่ายคงค้างให้ปิด (อาจปิดบัญชีไปแล้ว)";
}

function renderStats() {
  const stats = [
    ["ผังบัญชี", state.accounts.length],
    ["รายการบันทึก", state.entries.length],
    ["ลูกค้า (ทะเบียน)", state.customers.length],
    ["รายชื่อจากไฟล์", state.customerNames.length],
    ["ลูกหนี้", state.receivables.length],
    ["เจ้าหนี้", state.payables.length],
    ["คำอธิบายอัตโนมัติ", state.autoDesc.length],
    ["ต้นทุน/ขาย", state.customerCosts.length],
    ["เอกสารรับเข้า", state.incomingDocs.length],
  ];
  $("settings-stats").innerHTML = stats.map(([label, count]) => `<div><small>${label}</small><strong>${fmtInt(count)}</strong></div>`).join("");
}

function renderSettings() {
  const settings = state.settings || {};
  $("settings-company").value = settings.company || "";
  $("settings-tax-id").value = settings.taxId || "";
  $("settings-period-start").value = settings.periodStart || "";
  $("settings-period-end").value = settings.periodEnd || "";
  $("settings-currency").value = settings.currency || "THB";
  $("settings-note").value = settings.note || "";
  $("settings-vat-rate").value = settings.vatRate ?? 7;
  if (!$("close-date").value) $("close-date").value = settings.periodEnd || "";
  renderAccountMap();
  renderLockStatus();
  renderClosePreview();
  renderStats();
}

async function saveSettings(patch, message) {
  const previous = JSON.parse(JSON.stringify(state));
  replaceState({ ...state, settings: { ...state.settings, ...patch } });
  if (!(await save(["settings"]))) {
    replaceState(previous);
    renderSettings();
    return false;
  }
  renderSettings();
  toastSuccess(message);
  return true;
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const periodStart = $("settings-period-start").value;
  const periodEnd = $("settings-period-end").value;
  if (periodStart && periodEnd && periodStart > periodEnd) {
    toastError("วันที่เริ่มต้นงวดต้องไม่มากกว่าวันที่สิ้นสุด");
    return;
  }
  const accountMap = {};
  settingsForm.querySelectorAll("[data-role]").forEach((select) => {
    if (select.value) accountMap[select.dataset.role] = select.value;
  });
  await saveSettings({
    company: $("settings-company").value.trim(),
    taxId: $("settings-tax-id").value.trim(),
    periodStart,
    periodEnd,
    currency: $("settings-currency").value.trim() || "THB",
    note: $("settings-note").value.trim(),
    vatRate: Number($("settings-vat-rate").value) || 0,
    accountMap,
  }, "บันทึกการตั้งค่าเรียบร้อย");
});

/* ---------- period close & lock ---------- */
$("close-date").addEventListener("change", renderClosePreview);

$("close-run").addEventListener("click", async () => {
  const date = $("close-date").value;
  if (!date) return toastError("เลือกวันที่ปิดบัญชี");
  if (isLocked(date)) return toastError("วันที่นี้อยู่ในงวดที่ล็อกแล้ว ปลดล็อกก่อนหากต้องการปิดบัญชีใหม่");
  const retained = roleAccount("retained");
  if (!retained) return toastError("ยังไม่มีบัญชีกำไรสะสม (ประเภทส่วนของเจ้าของ) — เพิ่มในผังบัญชีหรือกำหนดในหัวข้อบัญชีสำหรับลงบัญชีอัตโนมัติ");
  const { rows, profit } = closingPreview(date);
  if (!rows.length) return toastError("ไม่มียอดรายได้/ค่าใช้จ่ายให้ปิด");
  const lockAfter = $("close-lock").checked;
  if (!(await confirmAction(`สร้างรายการปิดบัญชี ณ วันที่ ${fmtDateDMY(date)}: ปิด ${rows.length} บัญชี ${profit >= 0 ? "กำไร" : "ขาดทุน"}สุทธิ ${fmt(Math.abs(profit))} โอนเข้า ${accountLabel(retained)}${lockAfter ? " และล็อกงวดถึงวันที่นี้" : ""}?`, { title: "ปิดงวดบัญชี", confirmText: "ปิดบัญชี", tone: "primary" }))) return;

  // Debit revenues / credit expenses to zero them; the difference goes to retained earnings.
  const lines = rows.map(({ account, net }) => {
    const debitSide = account.type === "revenue" ? net : -net;
    return debitSide > 0 ? { accountId: account.id, debit: debitSide, credit: 0 } : { accountId: account.id, debit: 0, credit: -debitSide };
  });
  if (profit > 0) lines.push({ accountId: retained.id, debit: 0, credit: profit });
  else if (profit < 0) lines.push({ accountId: retained.id, debit: -profit, credit: 0 });
  const entries = state.entries.slice();
  const entryId = upsertEntry(entries, { date, desc: `ปิดบัญชีรายได้และค่าใช้จ่ายเข้ากำไรสะสม ณ ${fmtDateDMY(date)}`, lines, source: { type: "closing", id: date } });
  const closing = entries.find((entry) => entry.id === entryId);
  closing.kind = "closing";

  const previous = JSON.parse(JSON.stringify(state));
  replaceState({ ...state, entries: sortEntries(entries), settings: { ...state.settings, ...(lockAfter ? { lockDate: date } : {}) } });
  if (!(await save(lockAfter ? ["entries", "settings"] : ["entries"]))) {
    replaceState(previous);
    renderSettings();
    return;
  }
  renderSettings();
  toastSuccess(`สร้างรายการปิดบัญชี ${closing.docNo} เรียบร้อย${lockAfter ? " และล็อกงวดแล้ว" : ""}`);
});

$("lock-save").addEventListener("click", async () => {
  const date = $("lock-date").value;
  if (!date) return toastError("เลือกวันที่ล็อก");
  if (!(await confirmAction(`ล็อกรายการทั้งหมดที่ลงวันที่ถึง ${fmtDateDMY(date)}? รายการในช่วงนี้จะแก้ไข/ลบ/เพิ่มไม่ได้`, { title: "ล็อกงวดบัญชี", confirmText: "ล็อก", tone: "primary" }))) return;
  await saveSettings({ lockDate: date }, `ล็อกงวดถึง ${fmtDateDMY(date)} แล้ว`);
});

$("lock-clear").addEventListener("click", async () => {
  if (!state.settings.lockDate) return;
  if (!(await confirmAction("ปลดล็อกงวดบัญชี? รายการในงวดที่ปิดแล้วจะแก้ไขได้อีกครั้ง"))) return;
  await saveSettings({ lockDate: "" }, "ปลดล็อกงวดบัญชีแล้ว");
});

/* ---------- backup ---------- */
$("backup-export").addEventListener("click", () => {
  downloadJson(`accounting-backup-${fileStamp()}.json`, {
    exportedAt: new Date().toISOString(),
    version: 2,
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

if (await load()) {
  renderSettings();
  onDataRefresh(renderSettings);
  authReady.then((user) => {
    if (user) $("settings-user").textContent = `เข้าสู่ระบบเป็น ${user.email || ""}`;
  });
}

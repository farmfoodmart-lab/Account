import {
  TYPES,
  TYPE_ORDER,
  compareAccounts,
  esc,
  fmtAcc,
  fmtInt,
  load,
  normalDebit,
  replaceState,
  save,
  state,
  typeBadge,
  uid, onDataRefresh
} from "../../js/data.js";
import { collectTotals, accountNet } from "../../js/reports.js";
import { confirmAction, debounce, downloadCsvFile, fileStamp, toast, toastError, toastSuccess } from "../../js/ui.js";
import { toCsv } from "../../js/csv.js";

const $ = (id) => document.getElementById(id);
const accountForm = $("account-form");
const submitButton = $("account-submit");
const cancelButton = $("account-cancel");
const typeSelect = $("account-type");
const codeInput = $("account-code");
const nameInput = $("account-name");
const accountTableBody = document.querySelector("#accounts-table tbody");
let editingAccountId = null;
let typeFilter = "";
let usage = new Map();
let totals = new Map();

const TYPE_HINTS = {
  asset: "สินทรัพย์ · ด้านปกติ: เดบิต · แสดงในงบแสดงฐานะการเงิน · รหัสแนะนำขึ้นต้นด้วย 1",
  liability: "หนี้สิน · ด้านปกติ: เครดิต · แสดงในงบแสดงฐานะการเงิน · รหัสแนะนำขึ้นต้นด้วย 2",
  equity: "ส่วนของเจ้าของ · ด้านปกติ: เครดิต · แสดงในงบแสดงฐานะการเงิน · รหัสแนะนำขึ้นต้นด้วย 3",
  revenue: "รายได้ · ด้านปกติ: เครดิต · แสดงในงบกำไรขาดทุน · รหัสแนะนำขึ้นต้นด้วย 4",
  expense: "ค่าใช้จ่าย · ด้านปกติ: เดบิต · แสดงในงบกำไรขาดทุน · รหัสแนะนำขึ้นต้นด้วย 5",
};
const TYPE_PREFIX = { asset: "1", liability: "2", equity: "3", revenue: "4", expense: "5" };

/** Standard chart of accounts for a Thai SME. Only codes not yet present are added. */
const STANDARD_CHART = [
  ["1101", "เงินสด", "asset"],
  ["1102", "เงินฝากธนาคาร", "asset"],
  ["1103", "ลูกหนี้การค้า", "asset"],
  ["1104", "สินค้าคงเหลือ", "asset"],
  ["1105", "วัสดุสิ้นเปลือง", "asset"],
  ["1106", "ค่าใช้จ่ายจ่ายล่วงหน้า", "asset"],
  ["1107", "ภาษีซื้อ", "asset"],
  ["1201", "อุปกรณ์สำนักงาน", "asset"],
  ["1202", "ค่าเสื่อมราคาสะสม - อุปกรณ์สำนักงาน", "asset"],
  ["2101", "เจ้าหนี้การค้า", "liability"],
  ["2102", "ค่าใช้จ่ายค้างจ่าย", "liability"],
  ["2103", "ภาษีขาย", "liability"],
  ["2104", "ภาษีหัก ณ ที่จ่ายค้างจ่าย", "liability"],
  ["2201", "เงินกู้ยืมระยะยาว", "liability"],
  ["3101", "ทุน", "equity"],
  ["3102", "ถอนใช้ส่วนตัว", "equity"],
  ["3201", "กำไรสะสม", "equity"],
  ["4101", "รายได้จากการขาย", "revenue"],
  ["4102", "รายได้ค่าบริการ", "revenue"],
  ["4201", "รายได้อื่น", "revenue"],
  ["5101", "ต้นทุนขาย", "expense"],
  ["5201", "เงินเดือนและค่าจ้าง", "expense"],
  ["5202", "ค่าเช่า", "expense"],
  ["5203", "ค่าสาธารณูปโภค", "expense"],
  ["5204", "ค่าเสื่อมราคา", "expense"],
  ["5205", "ค่าธรรมเนียมธนาคาร", "expense"],
  ["5206", "ค่าใช้จ่ายเบ็ดเตล็ด", "expense"],
];

function computeUsage() {
  usage = new Map();
  state.entries.forEach((entry) => entry.lines.forEach((line) => {
    usage.set(line.accountId, (usage.get(line.accountId) || 0) + 1);
  }));
  totals = collectTotals(state.entries);
}

function suggestCode(type) {
  const prefix = TYPE_PREFIX[type];
  if (!prefix) return "";
  const codes = state.accounts
    .filter((account) => account.type === type && /^\d+$/.test(String(account.code)) && String(account.code).startsWith(prefix))
    .map((account) => Number(account.code));
  return codes.length ? String(Math.max(...codes) + 1) : `${prefix}101`;
}

function resetForm() {
  editingAccountId = null;
  accountForm.reset();
  accountForm.classList.remove("is-editing");
  $("account-form-title").textContent = "เพิ่มบัญชีใหม่";
  submitButton.textContent = "เพิ่มบัญชี";
  cancelButton.hidden = true;
  $("account-type-hint").textContent = "เลือกหมวดบัญชีเพื่อดูด้านปกติและรหัสที่แนะนำ";
}

function renderChips() {
  const counts = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
  state.accounts.forEach((account) => { if (account.type in counts) counts[account.type] += 1; });
  $("account-type-chips").innerHTML = [
    `<button type="button" class="chip" data-type="" aria-pressed="${!typeFilter}">ทั้งหมด<span class="count">${fmtInt(state.accounts.length)}</span></button>`,
    ...TYPE_ORDER.map((type) => `<button type="button" class="chip" data-type="${type}" aria-pressed="${typeFilter === type}">${TYPES[type]}<span class="count">${fmtInt(counts[type])}</span></button>`),
  ].join("");
}

function renderAccounts() {
  renderChips();
  if (!state.accounts.length) {
    accountTableBody.innerHTML = '<tr><td colspan="7" class="muted">ยังไม่มีบัญชี — กรอกฟอร์มด้านบน หรือกด “เพิ่มผังบัญชีมาตรฐาน” เพื่อเริ่มต้นอย่างรวดเร็ว</td></tr>';
    return;
  }
  const needle = $("account-search").value.trim().toLowerCase();
  const accounts = state.accounts
    .filter((account) => !typeFilter || account.type === typeFilter)
    .filter((account) => !needle || `${account.code} ${account.name}`.toLowerCase().includes(needle))
    .sort(compareAccounts);
  if (!accounts.length) {
    accountTableBody.innerHTML = '<tr><td colspan="7" class="muted">ไม่พบบัญชีที่ค้นหา</td></tr>';
    return;
  }

  let lastType = null;
  accountTableBody.innerHTML = accounts.map((account) => {
    const head = !typeFilter && account.type !== lastType
      ? `<tr class="group-head"><td colspan="7">${esc(TYPES[account.type] || "อื่น ๆ")}</td></tr>`
      : "";
    lastType = account.type;
    const used = usage.get(account.id) || 0;
    const net = accountNet(account, totals);
    return `${head}<tr>
      <td class="code">${esc(account.code)}</td>
      <td>${used ? `<a href="../ledger/ledger.html?account=${encodeURIComponent(account.id)}" title="ดูบัญชีแยกประเภท">${esc(account.name)}</a>` : esc(account.name)}</td>
      <td>${typeBadge(account.type)}</td>
      <td><span class="${normalDebit(account.type) ? "dr" : "cr"}">${normalDebit(account.type) ? "เดบิต (Dr)" : "เครดิต (Cr)"}</span></td>
      <td class="right">${used ? fmtInt(used) : '<span class="muted">-</span>'}</td>
      <td class="right${net < 0 ? " neg" : ""}">${used ? fmtAcc(net) : ""}</td>
      <td class="actions-cell">
        <button type="button" class="small secondary" data-edit-account="${esc(account.id)}">แก้ไข</button>
        <button type="button" class="small danger" data-delete-account="${esc(account.id)}"${used ? ' disabled title="บัญชีนี้ถูกใช้ในรายการแล้ว ลบไม่ได้"' : ""}>ลบ</button>
      </td>
    </tr>`;
  }).join("");
}

accountTableBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.editAccount) {
    const account = state.accounts.find((item) => item.id === button.dataset.editAccount);
    if (!account) return;
    editingAccountId = account.id;
    codeInput.value = account.code;
    nameInput.value = account.name;
    typeSelect.value = account.type;
    $("account-type-hint").textContent = TYPE_HINTS[account.type] || "";
    accountForm.classList.add("is-editing");
    $("account-form-title").textContent = `แก้ไขบัญชี ${account.code}`;
    submitButton.textContent = "บันทึกการแก้ไข";
    cancelButton.hidden = false;
    accountForm.scrollIntoView({ behavior: "smooth", block: "start" });
    nameInput.focus();
    if (usage.get(account.id)) toast("บัญชีนี้มีรายการแล้ว การเปลี่ยนหมวดจะมีผลกับงบการเงินทั้งหมด");
    return;
  }
  if (button.dataset.deleteAccount) {
    const accountId = button.dataset.deleteAccount;
    if (usage.get(accountId)) {
      toastError("บัญชีนี้ถูกใช้ในรายการแล้ว ลบไม่ได้");
      return;
    }
    const account = state.accounts.find((item) => item.id === accountId);
    if (!(await confirmAction(`ยืนยันการลบบัญชี ${account?.code || ""} ${account?.name || ""}?`))) return;
    const previousState = JSON.parse(JSON.stringify(state));
    replaceState({ ...state, accounts: state.accounts.filter((item) => item.id !== accountId) });
    if (!(await save(["accounts"]))) {
      replaceState(previousState);
      renderAccounts();
      return;
    }
    if (editingAccountId === accountId) resetForm();
    renderAccounts();
    toastSuccess("ลบบัญชีเรียบร้อย");
  }
});

$("account-type-chips").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-type]");
  if (!chip) return;
  typeFilter = chip.dataset.type;
  renderAccounts();
});
$("account-search").addEventListener("input", debounce(renderAccounts, 150));

typeSelect.addEventListener("change", () => {
  $("account-type-hint").textContent = TYPE_HINTS[typeSelect.value] || "";
  if (!editingAccountId && !codeInput.value.trim()) codeInput.value = suggestCode(typeSelect.value);
});

cancelButton.addEventListener("click", () => {
  resetForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = codeInput.value.trim();
  const name = nameInput.value.trim();
  const type = typeSelect.value;
  if (!code || !name || !type) return toastError("กรอกหมวด รหัส และชื่อบัญชีให้ครบ");
  if (state.accounts.some((account) => String(account.code) === code && account.id !== editingAccountId)) {
    toastError(`รหัสบัญชี ${code} มีอยู่แล้ว`);
    codeInput.focus();
    return;
  }
  const previous = JSON.parse(JSON.stringify(state));
  const isEdit = Boolean(editingAccountId);
  const accounts = state.accounts.slice();
  if (isEdit) {
    const index = accounts.findIndex((item) => item.id === editingAccountId);
    if (index < 0) return resetForm();
    accounts[index] = { ...accounts[index], code, name, type };
  } else {
    accounts.push({ id: uid(), code, name, type });
  }
  accounts.sort((left, right) => String(left.code).localeCompare(String(right.code), "th-TH", { numeric: true }));
  replaceState({ ...state, accounts });
  if (!(await save(["accounts"]))) {
    replaceState(previous);
    renderAccounts();
    return;
  }
  const keepType = type;
  resetForm();
  renderAccounts();
  toastSuccess(isEdit ? "แก้ไขบัญชีเรียบร้อย" : `เพิ่มบัญชี ${code} ${name} เรียบร้อย`);
  if (!isEdit) {
    // Fast data entry: keep the type and suggest the next code.
    typeSelect.value = keepType;
    $("account-type-hint").textContent = TYPE_HINTS[keepType] || "";
    codeInput.value = suggestCode(keepType);
    nameInput.focus();
  }
});

$("account-template").addEventListener("click", async () => {
  const existing = new Set(state.accounts.map((account) => String(account.code)));
  const missing = STANDARD_CHART.filter(([code]) => !existing.has(code));
  if (!missing.length) {
    toast("มีบัญชีมาตรฐานครบแล้ว");
    return;
  }
  if (!(await confirmAction(`เพิ่มบัญชีมาตรฐานสำหรับธุรกิจขนาดเล็ก ${missing.length} บัญชี (ข้ามรหัสที่มีอยู่แล้ว)?`, { title: "เพิ่มผังบัญชีมาตรฐาน", confirmText: "เพิ่มบัญชี", tone: "primary" }))) return;
  const previous = JSON.parse(JSON.stringify(state));
  const accounts = [...state.accounts, ...missing.map(([code, name, type]) => ({ id: uid(), code, name, type }))];
  accounts.sort((left, right) => String(left.code).localeCompare(String(right.code), "th-TH", { numeric: true }));
  replaceState({ ...state, accounts });
  if (!(await save(["accounts"]))) {
    replaceState(previous);
    return;
  }
  renderAccounts();
  toastSuccess(`เพิ่ม ${missing.length} บัญชีเรียบร้อย`);
});

$("account-export").addEventListener("click", () => {
  if (!state.accounts.length) return toastError("ไม่มีบัญชีให้ส่งออก");
  const rows = state.accounts.slice().sort(compareAccounts).map((account) => [account.code, account.name, TYPES[account.type] || account.type, normalDebit(account.type) ? "เดบิต" : "เครดิต", usage.get(account.id) || 0, accountNet(account, totals)]);
  downloadCsvFile(`chart-of-accounts-${fileStamp()}.csv`, toCsv(["รหัส", "ชื่อบัญชี", "หมวด", "ด้านปกติ", "จำนวนรายการ", "ยอดคงเหลือ"], rows));
  toastSuccess("ส่งออกผังบัญชีเรียบร้อย");
});

await load(["accounts", "entries"]);
computeUsage();
resetForm();
renderAccounts();
onDataRefresh(() => {
  computeUsage();
  renderAccounts();
});

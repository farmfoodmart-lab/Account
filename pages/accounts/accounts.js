import {
  esc,
  load,
  replaceState,
  save,
  state,
  TYPES,
  uid,
} from "../../js/data.js";
import { confirmAction, toast, toastError, toastSuccess } from "../../js/ui.js";

const accountForm = document.getElementById("account-form");
const submitButton = document.getElementById("account-submit");
const cancelButton = document.getElementById("account-cancel");
const accountTableBody = document.querySelector("#accounts-table tbody");
let editingAccountId = null;

function resetForm() {
  editingAccountId = null;
  accountForm.reset();
  submitButton.textContent = "เพิ่มบัญชี";
  cancelButton.hidden = true;
}

function renderAccounts() {
  if (!state.accounts.length) {
    accountTableBody.innerHTML = '<tr><td colspan="4" class="muted">ยังไม่มีบัญชี</td></tr>';
    return;
  }

  accountTableBody.innerHTML = state.accounts
    .slice()
    .sort((leftAccount, rightAccount) => String(leftAccount.code).localeCompare(String(rightAccount.code), "th-TH", { numeric: true }))
    .map(
      (account) => `<tr>
        <td>${esc(account.code)}</td>
        <td>${esc(account.name)}</td>
        <td>${TYPES[account.type] || esc(account.type)}</td>
        <td class="actions-cell">
          <button class="small secondary" data-edit-account="${esc(account.id)}">แก้ไข</button>
          <button class="small danger" data-delete-account="${esc(account.id)}">ลบ</button>
        </td>
      </tr>`,
    )
    .join("");

  accountTableBody.querySelectorAll("[data-edit-account]").forEach((button) => {
    button.addEventListener("click", () => {
      const account = state.accounts.find((existingAccount) => existingAccount.id === button.dataset.editAccount);
      if (!account) return;
      editingAccountId = account.id;
      document.getElementById("account-code").value = account.code;
      document.getElementById("account-name").value = account.name;
      document.getElementById("account-type").value = account.type;
      submitButton.textContent = "บันทึกการแก้ไข";
      cancelButton.hidden = false;
      document.getElementById("account-code").focus();
    });
  });

  accountTableBody.querySelectorAll("[data-delete-account]").forEach((button) => {
    button.addEventListener("click", async () => {
      const accountId = button.dataset.deleteAccount;
      const used = state.entries.some((entry) =>
        entry.lines.some((line) => line.accountId === accountId),
      );
      if (used) {
        toastError("บัญชีนี้ถูกใช้ในรายการแล้ว ลบไม่ได้");
        return;
      }
      if (!(await confirmAction("ยืนยันการลบหมวดหมู่บัญชีนี้?"))) return;

      const previousState = JSON.parse(JSON.stringify(state));
      const remainingAccounts = state.accounts.filter((account) => account.id !== accountId);
      replaceState({ ...state, accounts: remainingAccounts });
      if (!(await save(["accounts"]))) {
        replaceState(previousState);
        renderAccounts();
        return;
      }
      renderAccounts();
      toastSuccess("ลบหมวดหมู่บัญชีเรียบร้อย");
    });
  });
}

cancelButton.addEventListener("click", () => {
  resetForm();
  toast("ยกเลิกการแก้ไขแล้ว");
});

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = document.getElementById("account-code").value.trim();
  const name = document.getElementById("account-name").value.trim();
  const type = document.getElementById("account-type").value;
  if (!code || !name || !type) return;

  if (
    state.accounts.some(
      (account) => account.code === code && account.id !== editingAccountId,
    )
  ) {
    toastError(`รหัสบัญชี ${code} มีอยู่แล้ว`);
    return;
  }

  const previous = JSON.parse(JSON.stringify(state));
  const isEdit = Boolean(editingAccountId);
  const accounts = state.accounts.slice();
  if (isEdit) {
    const account = accounts.find((item) => item.id === editingAccountId);
    if (!account) {
      resetForm();
      return;
    }
    Object.assign(account, { code, name, type });
  } else {
    accounts.push({ id: uid(), code, name, type });
  }
  accounts.sort((leftAccount, rightAccount) => String(leftAccount.code).localeCompare(String(rightAccount.code), "th-TH", { numeric: true }));
  replaceState({ ...state, accounts });

  if (!(await save(["accounts"]))) {
    replaceState(previous);
    renderAccounts();
    return;
  }

  resetForm();
  renderAccounts();
  toastSuccess(isEdit ? "แก้ไขหมวดหมู่บัญชีเรียบร้อย" : "เพิ่มหมวดหมู่บัญชีเรียบร้อย");
});

await load(["accounts", "entries"]);
renderAccounts();

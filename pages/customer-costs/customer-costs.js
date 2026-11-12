import { esc, fmt, fmtDateDMY, load, onDataRefresh, replaceState, save, state } from "../../js/data.js";
import { confirmAction, toastError, toastSuccess } from "../../js/ui.js";
import { renderImportedFiles } from "../imported-files.js";

const customerCostsTableBody = document.querySelector("#customer-costs-table tbody");

function renderCustomerCosts() {
  if (!state.customerCosts.length) {
    customerCostsTableBody.innerHTML = '<tr><td colspan="5" class="muted">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  customerCostsTableBody.innerHTML = state.customerCosts.map((customerCost, customerCostIndex) => `<tr>
    <td>${esc(fmtDateDMY(customerCost.date || ""))}</td><td>${esc(customerCost.name || "")}</td>
    <td class="right">${fmt(customerCost.cost)}</td><td class="right">${fmt(customerCost.price)}</td>
    <td><button class="small danger" data-delete-customer-cost="${customerCostIndex}">ลบ</button></td></tr>`).join("");
  customerCostsTableBody.querySelectorAll("[data-delete-customer-cost]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmAction("ยืนยันการลบรายการนี้?"))) return;
      const previousState = JSON.parse(JSON.stringify(state));
      const customerCosts = state.customerCosts.slice();
      customerCosts.splice(Number(button.dataset.deleteCustomerCost), 1);
      replaceState({ ...state, customerCosts });
      if (!(await save(["customerCosts"]))) {
        replaceState(previousState);
        renderCustomerCosts();
        return;
      }
      renderCustomerCosts();
      toastSuccess("ลบรายการเรียบร้อย");
    });
  });
}

if (await load(["customerCosts"])) {
  renderCustomerCosts();
  renderImportedFiles("customer-cost-import-files", "customer_costs", renderCustomerCosts);
  onDataRefresh(renderCustomerCosts);
}

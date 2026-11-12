/**
 * Shared page logic for the receivables (ลูกหนี้) and payables (เจ้าหนี้) subledgers.
 * Documents and their settlements post to the general ledger automatically.
 */
import {
  AMOUNT_EPSILON,
  accountLabel,
  accountOptionsHtml,
  customerLabel,
  esc,
  fmt,
  fmtDateDMY,
  fmtInt,
  getAccount,
  getCustomer,
  isLocked,
  load,
  lockMessage,
  nextSeqNo,
  onDataRefresh,
  replaceState,
  roleAccount,
  save,
  state,
  uid,
} from "../js/data.js";
import {
  confirmAction,
  debounce,
  downloadCsvFile,
  fileStamp,
  formDialog,
  todayIso,
  toast,
  toastError,
  toastSuccess,
} from "../js/ui.js";
import { accountNet, collectTotals, receivableAging, toIsoDate } from "../js/reports.js";
import { toCsv } from "../js/csv.js";
import {
  cashAccountOptions,
  computeVat,
  docAmounts,
  documentLines,
  linkedEntryIds,
  round2,
  settlementLines,
  sortEntries,
  upsertEntry,
} from "../js/posting.js";

const CONFIGS = {
  receivable: {
    dataKey: "receivables",
    extraKeys: ["customers"],
    docCode: "INV",
    noun: "ลูกหนี้",
    partyNoun: "ลูกค้า",
    settleVerb: "รับชำระ",
    settledLabel: "รับชำระแล้ว",
    controlRole: "receivable",
    counterType: "revenue",
    counterRole: "revenue",
    docDesc: "ขายเชื่อ",
    settleDesc: "รับชำระหนี้",
  },
  payable: {
    dataKey: "payables",
    extraKeys: ["incomingDocs"],
    docCode: "AP",
    noun: "เจ้าหนี้",
    partyNoun: "ผู้ขาย/ซัพพลายเออร์",
    settleVerb: "จ่ายชำระ",
    settledLabel: "จ่ายแล้ว",
    controlRole: "payable",
    counterType: "expense",
    counterRole: "expense",
    docDesc: "ซื้อเชื่อ/ค่าใช้จ่ายค้างจ่าย",
    settleDesc: "จ่ายชำระหนี้",
  },
};

export async function initSubledger(kind) {
  const cfg = CONFIGS[kind];
  const $ = (id) => document.getElementById(id);
  const form = $("sl-form");
  const tableBody = document.querySelector("#sl-table tbody");
  let editingId = null;
  let statusFilter = "open";
  let expandedId = null;

  const records = () => state[cfg.dataKey];
  const remainingOf = (record) => Math.max(0, round2(docAmounts(record).total - (Number(record.paid) || 0)));

  function partyName(record) {
    if (kind === "receivable") {
      const customer = getCustomer(record.customerId);
      return customer ? customerLabel(customer) : record.customerName || "-";
    }
    return record.vendorName || "-";
  }

  function statusOf(record, today) {
    if (remainingOf(record) <= AMOUNT_EPSILON) return "paid";
    const due = toIsoDate(record.due);
    return due && due < today ? "overdue" : "pending";
  }

  function daysOverdue(record, today) {
    const due = toIsoDate(record.due);
    return due ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(due)) / 86400000)) : 0;
  }

  /* ---------- form ---------- */
  function renderPartyOptions() {
    if (kind === "receivable") {
      const select = $("sl-party");
      const current = select.value;
      select.innerHTML = state.customers.length
        ? '<option value="">-- เลือกลูกค้า --</option>' + state.customers.map((customer) => `<option value="${esc(customer.id)}">${esc(customerLabel(customer))}</option>`).join("")
        : '<option value="">ยังไม่มีลูกค้าในทะเบียน — เพิ่มที่หน้ารายชื่อลูกค้า</option>';
      if (current) select.value = current;
    } else {
      const names = new Set();
      state.payables.forEach((record) => record.vendorName && names.add(record.vendorName));
      state.incomingDocs.forEach((record) => record.supplier && names.add(String(record.supplier).trim()));
      $("sl-vendors").innerHTML = [...names].sort((a, b) => a.localeCompare(b, "th")).map((name) => `<option value="${esc(name)}"></option>`).join("");
    }
  }

  function renderCounterOptions(selected = "") {
    const select = $("sl-counter");
    const fallback = roleAccount(cfg.counterRole);
    select.innerHTML = accountOptionsHtml(selected || fallback?.id || "", "-- เลือกบัญชี --");
  }

  function updateAmounts() {
    const { vat, total } = computeVat($("sl-net").value, $("sl-vat-rate").value);
    $("sl-vat").value = fmt(vat);
    $("sl-total").value = fmt(total);
  }

  function setPostedState(record) {
    const postBox = $("sl-post");
    const note = $("sl-post-note");
    if (record && record.entryId) {
      const entry = state.entries.find((item) => item.id === record.entryId);
      postBox.checked = true;
      postBox.disabled = true;
      note.innerHTML = `ลงบัญชีแล้ว${entry ? ` <a href="../journal/journal.html">${esc(entry.docNo || "")}</a>` : ""} — แก้ไขเอกสารนี้จะปรับรายการบัญชีให้อัตโนมัติ`;
    } else {
      postBox.disabled = false;
      postBox.checked = !record;
      note.textContent = kind === "receivable"
        ? "Dr ลูกหนี้การค้า / Cr รายได้ และภาษีขาย"
        : "Dr ค่าใช้จ่าย และภาษีซื้อ / Cr เจ้าหนี้การค้า";
    }
  }

  function resetForm() {
    editingId = null;
    form.reset();
    form.classList.remove("is-editing");
    $("sl-form-title").textContent = `เพิ่ม${cfg.noun}`;
    $("sl-submit").textContent = `เพิ่ม${cfg.noun}`;
    $("sl-cancel").hidden = true;
    $("sl-date").value = todayIso();
    $("sl-vat-rate").value = "0";
    renderCounterOptions();
    setPostedState(null);
    updateAmounts();
  }

  function fillForm(record) {
    editingId = record.id;
    renderPartyOptions();
    if (kind === "receivable") $("sl-party").value = record.customerId || "";
    else {
      $("sl-party").value = record.vendorName || "";
      $("sl-party-tax").value = record.vendorTaxId || "";
    }
    const { net } = docAmounts(record);
    $("sl-docno").value = record.docNo || "";
    $("sl-date").value = toIsoDate(record.date) || "";
    $("sl-due").value = toIsoDate(record.due) || "";
    $("sl-net").value = net || "";
    $("sl-vat-rate").value = String(record.vatRate || 0);
    if (![...$("sl-vat-rate").options].some((option) => option.value === String(record.vatRate || 0))) $("sl-vat-rate").value = "0";
    $("sl-note").value = record.note || "";
    renderCounterOptions(record.counterAccountId);
    setPostedState(record);
    updateAmounts();
    form.classList.add("is-editing");
    $("sl-form-title").textContent = `แก้ไข${cfg.noun} ${record.docNo || ""}`;
    $("sl-submit").textContent = "บันทึกการแก้ไข";
    $("sl-cancel").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- summary ---------- */
  function renderSummary(today) {
    const list = records();
    const total = list.reduce((sum, record) => sum + docAmounts(record).total, 0);
    const paid = list.reduce((sum, record) => sum + (Number(record.paid) || 0), 0);
    const outstanding = list.reduce((sum, record) => sum + remainingOf(record), 0);
    const overdue = list.filter((record) => statusOf(record, today) === "overdue");
    const overdueAmount = overdue.reduce((sum, record) => sum + remainingOf(record), 0);
    const settledPct = total > AMOUNT_EPSILON ? (paid / total) * 100 : 0;
    $("sl-summary").innerHTML = `
      <div class="stat"><div class="muted">ยอด${cfg.noun}รวม</div><div class="stat-value">${fmt(total)}</div><div class="stat-sub">${fmtInt(list.length)} เอกสาร</div></div>
      <div class="stat accent-revenue"><div class="muted">${cfg.settledLabel}</div><div class="stat-value">${fmt(paid)}</div><div class="stat-sub">${settledPct.toFixed(1)}% ของยอดรวม</div></div>
      <div class="stat accent-asset"><div class="muted">คงค้าง</div><div class="stat-value">${fmt(outstanding)}</div><div class="stat-sub">รอ${cfg.settleVerb}</div></div>
      <div class="stat${overdue.length ? " is-alert" : ""}"><div class="muted">เกินกำหนด</div><div class="stat-value ${overdue.length ? "unbalanced" : ""}">${fmt(overdueAmount)}</div><div class="stat-sub">${fmtInt(overdue.length)} เอกสาร</div></div>`;

    // Reconciliation: subledger outstanding vs. the control account in the general ledger.
    const control = roleAccount(cfg.controlRole);
    const recon = $("sl-recon");
    if (!control) {
      recon.innerHTML = `<div class="banner warn">ยังไม่พบบัญชีคุม${cfg.noun} — <a href="../settings/settings.html">กำหนดบัญชีที่หน้าการตั้งค่า</a> หรือเพิ่มผังบัญชีมาตรฐาน</div>`;
    } else {
      const glBalance = accountNet(control, collectTotals(state.entries));
      const unposted = list.filter((record) => !record.entryId);
      const difference = round2(glBalance - outstanding);
      const ok = Math.abs(difference) < AMOUNT_EPSILON;
      recon.innerHTML = `<div class="banner ${ok ? "ok" : "warn"}">
        <strong>${ok ? "✓ กระทบยอดตรงกัน" : "กระทบยอดไม่ตรงกัน"}</strong>
        <span>บัญชีคุม ${esc(accountLabel(control))} ${fmt(glBalance)} · ทะเบียน${cfg.noun}คงค้าง ${fmt(outstanding)}${ok ? "" : ` · ผลต่าง ${fmt(Math.abs(difference))}`}</span>
        ${unposted.length ? `<span class="muted" style="margin-left:auto">${fmtInt(unposted.length)} เอกสารยังไม่ลงบัญชี — กดปุ่ม “ลงบัญชี” ในตาราง</span>` : ""}
      </div>`;
    }

    const buckets = receivableAging(list.map((record) => ({ ...record, amount: docAmounts(record).total })), today);
    const agingTotal = buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
    const colors = ["var(--success)", "var(--warning)", "#d9822b", "var(--type-liability)", "var(--danger)"];
    $("sl-aging").innerHTML = agingTotal > AMOUNT_EPSILON ? `<div class="card">
      <div class="card-head"><h3>วิเคราะห์อายุ${cfg.noun}</h3><span class="muted">ณ วันที่ ${esc(fmtDateDMY(today))}</span></div>
      <div class="meter">${buckets.map((bucket, index) => bucket.amount > 0 ? `<span style="width:${(bucket.amount / agingTotal) * 100}%;background:${colors[index]}" title="${esc(bucket.label)} ${fmt(bucket.amount)}"></span>` : "").join("")}</div>
      <div class="kv" style="margin-top:12px">${buckets.map((bucket, index) => `<div><small><span class="legend-dot" style="background:${colors[index]}"></span>${esc(bucket.label)}</small><strong>${fmt(bucket.amount)}</strong> <span class="muted">(${fmtInt(bucket.count)})</span></div>`).join("")}</div>
    </div>` : "";
  }

  function renderChips(today) {
    const counts = { open: 0, overdue: 0, paid: 0, all: records().length };
    records().forEach((record) => {
      const status = statusOf(record, today);
      if (status === "paid") counts.paid += 1;
      else counts.open += 1;
      if (status === "overdue") counts.overdue += 1;
    });
    const labels = { open: "ค้างชำระทั้งหมด", overdue: "เกินกำหนด", paid: "ชำระครบแล้ว", all: "ทั้งหมด" };
    $("sl-status-filter").innerHTML = Object.entries(labels).map(([key, label]) =>
      `<button type="button" class="chip" data-status="${key}" aria-pressed="${statusFilter === key}">${label}<span class="count">${fmtInt(counts[key])}</span></button>`).join("");
  }

  function visibleRecords(today) {
    const needle = $("sl-search").value.trim().toLowerCase();
    return records().filter((record) => {
      const status = statusOf(record, today);
      if (statusFilter === "open" && status === "paid") return false;
      if (statusFilter === "overdue" && status !== "overdue") return false;
      if (statusFilter === "paid" && status !== "paid") return false;
      return !needle || `${partyName(record)} ${record.docNo || ""} ${record.note || ""}`.toLowerCase().includes(needle);
    });
  }

  function historyRow(record) {
    const payments = record.payments || [];
    const rows = payments.map((payment) => {
      const entry = payment.entryId ? state.entries.find((item) => item.id === payment.entryId) : null;
      return `<tr><td>${esc(fmtDateDMY(payment.date))}</td><td>${esc(accountLabel(getAccount(payment.accountId)))}</td><td class="right">${fmt(payment.amount)}</td><td>${entry ? `<span class="badge success">${esc(entry.docNo || "ลงบัญชีแล้ว")}</span>` : '<span class="badge">ไม่ลงบัญชี</span>'}</td>
        <td class="actions-cell"><button type="button" class="small danger" data-delete-payment="${esc(record.id)}|${esc(payment.id)}">ลบ</button></td></tr>`;
    }).join("");
    const legacyPaid = round2((Number(record.paid) || 0) - payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
    return `<tr class="history-row"><td colspan="9"><div class="history">
      <strong>ประวัติ${cfg.settleVerb}</strong>
      ${rows || legacyPaid > AMOUNT_EPSILON ? `<table><thead><tr><th>วันที่</th><th>บัญชี</th><th class="right">จำนวนเงิน</th><th>รายการบัญชี</th><th></th></tr></thead><tbody>${rows}
        ${legacyPaid > AMOUNT_EPSILON ? `<tr><td colspan="2" class="muted" style="padding:8px 14px;text-align:left">ยอดชำระยกมา (ก่อนใช้ระบบเชื่อมบัญชี)</td><td class="right">${fmt(legacyPaid)}</td><td colspan="2"></td></tr>` : ""}</tbody></table>` : '<p class="muted">ยังไม่มีการชำระ</p>'}
    </div></td></tr>`;
  }

  function renderTable() {
    const today = todayIso();
    renderSummary(today);
    renderChips(today);
    if (!records().length) {
      tableBody.innerHTML = `<tr><td colspan="9" class="muted">ยังไม่มีรายการ${cfg.noun}</td></tr>`;
      return;
    }
    const rows = visibleRecords(today).sort((left, right) => (toIsoDate(left.due) || "9999").localeCompare(toIsoDate(right.due) || "9999"));
    if (!rows.length) {
      tableBody.innerHTML = '<tr><td colspan="9" class="muted">ไม่มีรายการในสถานะนี้</td></tr>';
      return;
    }
    tableBody.innerHTML = rows.map((record) => {
      const { total, vat } = docAmounts(record);
      const paid = Number(record.paid) || 0;
      const status = statusOf(record, today);
      const badge = status === "paid"
        ? '<span class="badge success dot">ชำระครบ</span>'
        : status === "overdue"
          ? `<span class="badge danger dot">เกินกำหนด ${fmtInt(daysOverdue(record, today))} วัน</span>`
          : paid > 0 ? '<span class="badge info dot">ชำระบางส่วน</span>' : '<span class="badge warning dot">รอชำระ</span>';
      const posted = record.entryId ? '<span class="badge success" title="ลงบัญชีแยกประเภทแล้ว">GL ✓</span>' : `<button type="button" class="small ghost" data-post="${esc(record.id)}" title="สร้างรายการบัญชีให้เอกสารนี้">ลงบัญชี</button>`;
      const historyCount = (record.payments || []).length;
      const main = `<tr${expandedId === record.id ? ' class="is-expanded"' : ""}>
        <td>${esc(partyName(record))}${record.note ? `<span class="cell-sub">${esc(record.note)}</span>` : ""}</td>
        <td class="nowrap">${esc(record.docNo || "-")}<span class="cell-sub">${posted}</span></td>
        <td class="nowrap">${esc(fmtDateDMY(record.date))}</td>
        <td class="nowrap">${esc(record.due ? fmtDateDMY(record.due) : "-")}</td>
        <td class="right">${fmt(total)}${vat > AMOUNT_EPSILON ? `<span class="cell-sub">VAT ${fmt(vat)}</span>` : ""}</td>
        <td class="right">${fmt(paid)}${historyCount || paid > 0 ? `<span class="cell-sub"><button type="button" class="link-btn" data-history="${esc(record.id)}">${expandedId === record.id ? "ซ่อนประวัติ" : `ประวัติ (${fmtInt(historyCount)})`}</button></span>` : ""}</td>
        <td class="right"><strong>${fmt(remainingOf(record))}</strong></td>
        <td>${badge}</td>
        <td class="actions-cell">${status !== "paid" ? `<button type="button" class="small" data-settle="${esc(record.id)}">${cfg.settleVerb}</button>` : ""}<button type="button" class="small secondary" data-edit="${esc(record.id)}">แก้ไข</button><button type="button" class="small danger" data-delete="${esc(record.id)}">ลบ</button></td>
      </tr>`;
      return main + (expandedId === record.id ? historyRow(record) : "");
    }).join("");
  }

  /* ---------- persistence ---------- */
  async function persist(nextRecords, nextEntries, message) {
    const previous = JSON.parse(JSON.stringify(state));
    replaceState({ ...state, [cfg.dataKey]: nextRecords, ...(nextEntries ? { entries: sortEntries(nextEntries) } : {}) });
    if (!(await save(nextEntries ? [cfg.dataKey, "entries"] : [cfg.dataKey]))) {
      replaceState(previous);
      renderTable();
      return false;
    }
    renderPartyOptions();
    renderTable();
    toastSuccess(message);
    return true;
  }

  /** True when any journal entry linked to this document falls in a closed period. */
  const lockedDates = (record) =>
    (record.entryId && isLocked(record.date)) ||
    (record.payments || []).some((payment) => payment.entryId && isLocked(payment.date));

  async function settle(record) {
    const remaining = remainingOf(record);
    const cash = cashAccountOptions();
    if (!cash.options.length) return toastError("ยังไม่มีบัญชีสินทรัพย์สำหรับรับ/จ่ายเงิน");
    const values = await formDialog({
      title: `${cfg.settleVerb} ${record.docNo || ""}`.trim(),
      message: `${partyName(record)} · คงค้าง ${fmt(remaining)}`,
      confirmText: `บันทึก${cfg.settleVerb}`,
      fields: [
        { name: "date", label: "วันที่", type: "date", value: todayIso(), required: true },
        { name: "amount", label: "จำนวนเงิน", type: "number", value: remaining.toFixed(2), min: 0.01, max: remaining, step: "0.01", required: true },
        { name: "accountId", label: kind === "receivable" ? "รับเงินเข้าบัญชี" : "จ่ายเงินจากบัญชี", type: "select", value: cash.defaultId, options: cash.options, required: true },
        { name: "post", label: "ลงบัญชีแยกประเภทอัตโนมัติ", type: "checkbox", value: Boolean(record.entryId) },
      ],
    });
    if (!values) return;
    const amount = round2(values.amount);
    if (amount <= 0 || amount - remaining > AMOUNT_EPSILON) return toastError("จำนวนเงินไม่ถูกต้อง");
    if (values.post && isLocked(values.date)) return toastError(lockMessage());
    if (values.post && !record.entryId && !(await confirmAction(`เอกสารนี้ยังไม่ได้ลงบัญชี การลงบัญชี${cfg.settleVerb}อย่างเดียวจะทำให้ยอดบัญชีคุม${cfg.noun}ติดลบ ต้องการดำเนินการต่อหรือไม่?`, { title: "ยังไม่ได้ลงบัญชีเอกสาร", confirmText: "ดำเนินการต่อ", tone: "primary" }))) return;

    const payment = { id: uid(), date: values.date, amount, accountId: values.accountId };
    const entries = values.post ? state.entries.slice() : null;
    if (values.post) {
      const result = settlementLines(kind, payment);
      if (result.error) return toastError(result.error);
      payment.entryId = upsertEntry(entries, {
        date: payment.date,
        desc: `${cfg.settleDesc} ${record.docNo || ""} ${partyName(record)}`.trim(),
        lines: result.lines,
        source: { type: kind === "receivable" ? "receipt" : "payment", id: record.id, paymentId: payment.id, docNo: record.docNo || "" },
        ...(kind === "receivable" && record.customerId ? { customerId: record.customerId, customerName: partyName(record) } : {}),
      });
    }
    const next = records().map((item) => item.id === record.id
      ? { ...item, paid: round2((Number(item.paid) || 0) + amount), payments: [...(item.payments || []), payment], lastPaidAt: payment.date }
      : item);
    await persist(next, entries, `บันทึก${cfg.settleVerb} ${fmt(amount)} เรียบร้อย${values.post ? " และลงบัญชีแล้ว" : ""}`);
  }

  async function postExisting(record) {
    if (isLocked(record.date)) return toastError(lockMessage());
    const result = documentLines(kind, record);
    if (result.error) return toastError(result.error);
    const legacyPaid = round2((Number(record.paid) || 0) - (record.payments || []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
    const cash = cashAccountOptions();
    const fields = [{ name: "confirm", label: "ยืนยันว่าเอกสารนี้ยังไม่เคยบันทึกในสมุดรายวัน (ป้องกันการลงบัญชีซ้ำ)", type: "checkbox", value: false }];
    if (legacyPaid > AMOUNT_EPSILON) {
      fields.push(
        { name: "postPaid", label: `ลงบัญชี${cfg.settleVerb}ยอดเดิม ${fmt(legacyPaid)} ด้วย`, type: "checkbox", value: true },
        { name: "paidDate", label: `วันที่${cfg.settleVerb}`, type: "date", value: toIsoDate(record.lastPaidAt) || toIsoDate(record.date) || todayIso() },
        { name: "accountId", label: "บัญชีเงินสด/ธนาคาร", type: "select", value: cash.defaultId, options: cash.options },
      );
    }
    const values = await formDialog({
      title: `ลงบัญชี ${record.docNo || ""}`.trim(),
      message: `${partyName(record)} · ${fmt(docAmounts(record).total)} — ระบบจะสร้างรายการในสมุดรายวันลงวันที่ ${fmtDateDMY(record.date)}`,
      confirmText: "ลงบัญชี",
      fields,
    });
    if (!values) return;
    if (!values.confirm) return toastError("กรุณาติ๊กยืนยันก่อนลงบัญชี");
    const entries = state.entries.slice();
    const updated = { ...record, payments: [...(record.payments || [])] };
    updated.entryId = upsertEntry(entries, {
      date: toIsoDate(record.date) || record.date,
      desc: `${cfg.docDesc} ${record.docNo || ""} ${partyName(record)}`.trim(),
      lines: result.lines,
      source: { type: kind, id: record.id, docNo: record.docNo || "" },
      ...(kind === "receivable" && record.customerId ? { customerId: record.customerId, customerName: partyName(record) } : {}),
    });
    if (values.postPaid) {
      if (isLocked(values.paidDate)) return toastError(lockMessage());
      const payment = { id: uid(), date: values.paidDate, amount: legacyPaid, accountId: values.accountId };
      const settlement = settlementLines(kind, payment);
      if (settlement.error) return toastError(settlement.error);
      payment.entryId = upsertEntry(entries, {
        date: payment.date,
        desc: `${cfg.settleDesc} ${record.docNo || ""} ${partyName(record)}`.trim(),
        lines: settlement.lines,
        source: { type: kind === "receivable" ? "receipt" : "payment", id: record.id, paymentId: payment.id, docNo: record.docNo || "" },
      });
      updated.payments.push(payment);
    }
    await persist(records().map((item) => (item.id === record.id ? updated : item)), entries, `ลงบัญชี ${record.docNo || ""} เรียบร้อย`);
  }

  async function deletePayment(recordId, paymentId) {
    const record = records().find((item) => item.id === recordId);
    const payment = record?.payments?.find((item) => item.id === paymentId);
    if (!payment) return;
    if (payment.entryId && isLocked(payment.date)) return toastError(lockMessage());
    if (!(await confirmAction(`ลบรายการ${cfg.settleVerb} ${fmt(payment.amount)} วันที่ ${fmtDateDMY(payment.date)}${payment.entryId ? " และรายการบัญชีที่เชื่อมไว้" : ""}?`))) return;
    const entries = payment.entryId ? state.entries.filter((entry) => entry.id !== payment.entryId) : null;
    const next = records().map((item) => item.id === recordId
      ? { ...item, paid: Math.max(0, round2((Number(item.paid) || 0) - payment.amount)), payments: item.payments.filter((p) => p.id !== paymentId) }
      : item);
    await persist(next, entries, `ลบรายการ${cfg.settleVerb}เรียบร้อย`);
  }

  async function deleteRecord(record) {
    if (lockedDates(record)) return toastError(lockMessage());
    const linked = linkedEntryIds(record);
    if (!(await confirmAction(`ลบ${cfg.noun} ${record.docNo || ""}${linked.length ? ` และรายการบัญชีที่เชื่อมไว้ ${linked.length} รายการ` : ""}?`))) return;
    const entries = linked.length ? state.entries.filter((entry) => !linked.includes(entry.id)) : null;
    if (await persist(records().filter((item) => item.id !== record.id), entries, `ลบ${cfg.noun}เรียบร้อย`) && editingId === record.id) resetForm();
  }

  /* ---------- events ---------- */
  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const find = (id) => records().find((item) => item.id === id);
    if (button.dataset.settle) return settle(find(button.dataset.settle));
    if (button.dataset.post) return postExisting(find(button.dataset.post));
    if (button.dataset.edit) return fillForm(find(button.dataset.edit));
    if (button.dataset.delete) return deleteRecord(find(button.dataset.delete));
    if (button.dataset.history) {
      expandedId = expandedId === button.dataset.history ? null : button.dataset.history;
      renderTable();
      return;
    }
    if (button.dataset.deletePayment) {
      const [recordId, paymentId] = button.dataset.deletePayment.split("|");
      deletePayment(recordId, paymentId);
    }
  });

  $("sl-status-filter").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-status]");
    if (!chip) return;
    statusFilter = chip.dataset.status;
    renderTable();
  });
  $("sl-search").addEventListener("input", debounce(renderTable, 150));
  $("sl-net").addEventListener("input", updateAmounts);
  $("sl-vat-rate").addEventListener("change", updateAmounts);
  $("sl-cancel").addEventListener("click", () => {
    resetForm();
    toast("ยกเลิกการแก้ไขแล้ว");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const existing = editingId ? records().find((item) => item.id === editingId) : null;
    const date = $("sl-date").value;
    const due = $("sl-due").value;
    const vatRate = Number($("sl-vat-rate").value) || 0;
    const { net, vat, total } = computeVat($("sl-net").value, vatRate);
    const partyValue = $("sl-party").value.trim();
    if (!partyValue) return toastError(`ระบุ${cfg.partyNoun}ก่อน`);
    if (!date) return toastError("ระบุวันที่เอกสาร");
    if (net <= 0) return toastError("จำนวนเงินต้องมากกว่า 0");
    if (due && due < date) return toastError("วันครบกำหนดต้องไม่ก่อนวันที่เอกสาร");
    if (existing && total + AMOUNT_EPSILON < (Number(existing.paid) || 0)) return toastError("ยอดรวมต้องไม่น้อยกว่ายอดที่ชำระแล้ว");
    const willPost = $("sl-post").checked || Boolean(existing?.entryId);
    if (willPost && (isLocked(date) || (existing?.entryId && isLocked(existing.date)))) return toastError(lockMessage());

    const id = existing?.id || uid();
    const docNo = $("sl-docno").value.trim() || nextSeqNo(records(), cfg.docCode, date, id);
    if (records().some((item) => item.docNo === docNo && item.id !== id)) return toastError(`เลขที่เอกสาร ${docNo} มีอยู่แล้ว`);

    const record = {
      ...(existing || { id, paid: 0, payments: [] }),
      docNo,
      date,
      due,
      net,
      vatRate,
      vat,
      amount: total,
      counterAccountId: $("sl-counter").value,
      note: $("sl-note").value.trim(),
    };
    if (kind === "receivable") record.customerId = partyValue;
    else {
      record.vendorName = partyValue;
      record.vendorTaxId = $("sl-party-tax").value.trim();
    }

    let entries = null;
    if (willPost) {
      const result = documentLines(kind, record);
      if (result.error) return toastError(result.error);
      entries = state.entries.slice();
      record.entryId = upsertEntry(entries, {
        entryId: record.entryId,
        date,
        desc: `${cfg.docDesc} ${docNo} ${partyName(record)}`.trim(),
        lines: result.lines,
        source: { type: kind, id, docNo },
        ...(kind === "receivable" ? { customerId: record.customerId, customerName: partyName(record) } : {}),
      });
    }
    const next = existing ? records().map((item) => (item.id === id ? record : item)) : [...records(), record];
    next.sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));
    if (await persist(next, entries, `${existing ? "แก้ไข" : "เพิ่ม"}${cfg.noun} ${docNo} เรียบร้อย${willPost ? " (ลงบัญชีแล้ว)" : ""}`)) resetForm();
  });

  $("sl-export").addEventListener("click", () => {
    const today = todayIso();
    const rows = visibleRecords(today);
    if (!rows.length) return toastError("ไม่มีรายการให้ส่งออก");
    const labels = { paid: "ชำระครบ", overdue: "เกินกำหนด", pending: "รอชำระ" };
    downloadCsvFile(`${cfg.dataKey}-${fileStamp()}.csv`, toCsv(
      [cfg.partyNoun, "เลขที่", "วันที่", "ครบกำหนด", "ก่อน VAT", "VAT", "ยอดรวม", cfg.settledLabel, "คงค้าง", "สถานะ", "เกินกำหนด (วัน)", "ลงบัญชี", "หมายเหตุ"],
      rows.map((record) => {
        const { net, vat, total } = docAmounts(record);
        return [partyName(record), record.docNo, fmtDateDMY(record.date), fmtDateDMY(record.due), net, vat, total, Number(record.paid) || 0, remainingOf(record), labels[statusOf(record, today)], daysOverdue(record, today), record.entryId ? "ใช่" : "ไม่", record.note || ""];
      }),
    ));
    toastSuccess(`ส่งออก ${fmtInt(rows.length)} รายการ`);
  });

  if (await load([cfg.dataKey, "accounts", "entries", ...cfg.extraKeys])) {
    renderPartyOptions();
    resetForm();
    renderTable();
    if (location.hash === "#new") {
      form.scrollIntoView({ block: "start" });
      $("sl-party").focus();
      history.replaceState(null, "", location.pathname);
    }
    onDataRefresh(() => {
      renderPartyOptions();
      renderTable();
    });
  }
}

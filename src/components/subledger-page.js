/**
 * @file หน้าทะเบียนลูกหนี้/เจ้าหนี้ (ใช้ร่วมกันทั้งสองหน้า)
 *
 * ข้อมูลทั้งหมดดึงมาจากสมุดรายวันทั่วไป (ดู src/accounting/subledger.js) — ไม่มีฟอร์มเพิ่มลูกหนี้/เจ้าหนี้แยก
 * หน้านี้ทำได้:
 * - ดูยอดคงค้าง อายุหนี้ สรุปรายคู่ค้า และประวัติการชำระของแต่ละเอกสาร
 * - รับชำระ/จ่ายชำระ: สร้างรายการในสมุดรายวันให้ (Dr เงินสด / Cr ลูกหนี้ หรือ Dr เจ้าหนี้ / Cr เงินสด)
 * - ย้ายข้อมูลลูกหนี้/เจ้าหนี้ที่บันทึกด้วยระบบเดิม ให้มาอยู่ในสมุดรายวัน (ครั้งเดียว)
 */
import { commitChanges, loadData, onDataRefresh, state } from "../core/store.js";
import { watchDocumentNumberRepair } from "./document-number-repair-job.js";
import { AMOUNT_EPSILON } from "../accounting/constants.js";
import { findAccountForRole, formatAccountLabel } from "../accounting/accounts.js";
import { findCustomerById, formatCustomerLabel } from "../accounting/customers.js";
import { getLockedPeriodMessage, isDateLocked } from "../accounting/journal.js";
import { buildAgingBuckets } from "../accounting/statements.js";
import {
  buildDocumentLines,
  buildSettlementLines,
  getCashAccountOptions,
  roundMoney,
  sortEntriesByDate,
  upsertJournalEntry,
} from "../accounting/posting.js";
import { buildSubledger } from "../accounting/subledger.js";
import { notifyError, notifySuccess } from "./notifications.js";
import { formDialog } from "./dialogs.js";
import { createMonthFilter } from "./month-filter.js";
import { buildCsv } from "../utils/csv.js";
import { daysBetween, getFileDateStamp, getTodayIso, toIsoDate } from "../utils/date.js";
import { byId } from "../utils/dom.js";
import { downloadCsv } from "../utils/download.js";
import { escapeHtml, formatDate, formatMoney, formatNumber } from "../utils/format.js";
import { debounce } from "../utils/timing.js";

/** ข้อความและการเรียงลำดับที่ต่างกันระหว่างหน้าลูกหนี้กับหน้าเจ้าหนี้ */
const PAGE_SETTINGS = {
  receivable: {
    legacyCollection: "receivables",
    noun: "ลูกหนี้",
    controlAccountName: "ลูกหนี้การค้า",
    settleVerb: "รับชำระ",
    settledLabel: "รับชำระแล้ว",
    documentDescription: "ขายเชื่อ",
    settlementDescription: "รับชำระหนี้",
    cashFieldLabel: "รับเงินเข้าบัญชี",
    // เรียงตามเลขที่เอกสาร (รหัสเอกสาร-ปีเดือน-ลำดับ) จากน้อยไปมาก — ไม่มีเลขที่ไว้ท้ายสุด
    compareDocuments: (left, right) => (left.docNo ? 0 : 1) - (right.docNo ? 0 : 1)
      || String(left.docNo || "").localeCompare(String(right.docNo || ""), "th-TH", { numeric: true })
      || left.date.localeCompare(right.date),
  },
  payable: {
    legacyCollection: "payables",
    noun: "เจ้าหนี้",
    controlAccountName: "เจ้าหนี้การค้า",
    settleVerb: "จ่ายชำระ",
    settledLabel: "จ่ายแล้ว",
    documentDescription: "ซื้อเชื่อ",
    settlementDescription: "จ่ายชำระหนี้",
    cashFieldLabel: "จ่ายเงินจากบัญชี",
    // เรียงตามวันครบกำหนด (ไม่มีวันครบกำหนดไว้ท้ายสุด)
    compareDocuments: (left, right) => (left.due || "9999").localeCompare(right.due || "9999"),
  },
};

const AGING_COLORS = ["var(--success)", "var(--warning)", "#d9822b", "var(--type-liability)", "var(--danger)"];
const STATUS_FILTER_LABELS = { open: "ค้างชำระทั้งหมด", overdue: "เกินกำหนด", paid: "ชำระครบแล้ว", all: "ทั้งหมด" };

/**
 * เริ่มต้นหน้าทะเบียน
 * @param {"receivable" | "payable"} subledgerType
 */
export async function initSubledgerPage(subledgerType) {
  const settings = PAGE_SETTINGS[subledgerType];
  const tableBody = document.querySelector("#subledger-table tbody");

  /** ตัวกรองสถานะ: open | overdue | paid | all */
  let statusFilter = "open";
  /** entryId ของเอกสารที่เปิดดูประวัติการชำระอยู่ */
  let expandedEntryId = null;
  /** ทะเบียนที่คำนวณล่าสุด (คำนวณใหม่ทุกครั้งที่วาดหน้า) */
  let subledger = { controlAccount: null, documents: [], parties: [] };
  /** ช่องกรองวันที่เอกสาร (มีเฉพาะหน้าที่วางช่องไว้ เช่น หน้าลูกหนี้) — ว่าง = ไม่จำกัด */
  const dateFromInput = byId("subledger-date-from");
  const dateToInput = byId("subledger-date-to");
  const dateClearButton = byId("subledger-date-clear");
  const getDateRange = () => ({ from: dateFromInput?.value || "", to: dateToInput?.value || "" });

  /** @returns {"paid" | "overdue" | "pending"} */
  function getStatus(subledgerDocument, today) {
    if (subledgerDocument.outstanding < AMOUNT_EPSILON) return "paid";
    return subledgerDocument.due && subledgerDocument.due < today ? "overdue" : "pending";
  }

  const getDaysOverdue = (subledgerDocument, today) =>
    (subledgerDocument.due ? Math.max(0, daysBetween(subledgerDocument.due, today)) : 0);

  const findDocument = (entryId) => subledger.documents.find((item) => item.entryId === entryId);

  /* ---------------------------------------------------------------- */
  /* การ์ดสรุป อายุหนี้ และสรุปรายคู่ค้า                                  */
  /* ---------------------------------------------------------------- */

  function renderSummaryCards(today) {
    const { documents } = subledger;
    const totalAmount = documents.reduce((total, item) => total + item.amount, 0);
    const totalPaid = documents.reduce((total, item) => total + item.paid, 0);
    const totalOutstanding = documents.reduce((total, item) => total + item.outstanding, 0);
    const overdueDocuments = documents.filter((item) => getStatus(item, today) === "overdue");
    const overdueAmount = overdueDocuments.reduce((total, item) => total + item.outstanding, 0);
    const settledPercent = totalAmount > AMOUNT_EPSILON ? (totalPaid / totalAmount) * 100 : 0;

    byId("subledger-summary").innerHTML = `
      <div class="stat"><div class="muted">ยอด${settings.noun}รวม</div><div class="stat-value">${formatMoney(totalAmount)}</div><div class="stat-sub">${formatNumber(documents.length)} เอกสาร</div></div>
      <div class="stat accent-revenue"><div class="muted">${settings.settledLabel}</div><div class="stat-value">${formatMoney(totalPaid)}</div><div class="stat-sub">${settledPercent.toFixed(1)}% ของยอดรวม</div></div>
      <div class="stat accent-asset"><div class="muted">คงค้าง</div><div class="stat-value">${formatMoney(totalOutstanding)}</div><div class="stat-sub">${escapeHtml(formatAccountLabel(subledger.controlAccount))}</div></div>
      <div class="stat${overdueDocuments.length ? " is-alert" : ""}"><div class="muted">เกินกำหนด</div><div class="stat-value ${overdueDocuments.length ? "unbalanced" : ""}">${formatMoney(overdueAmount)}</div><div class="stat-sub">${formatNumber(overdueDocuments.length)} เอกสาร</div></div>`;
  }

  function renderAging(today) {
    const buckets = buildAgingBuckets(subledger.documents.map((item) => ({ amount: item.amount, paid: item.paid, due: item.due })), today);
    const agingTotal = buckets.reduce((total, bucket) => total + bucket.amount, 0);
    if (agingTotal < AMOUNT_EPSILON) {
      byId("subledger-aging").innerHTML = "";
      return;
    }
    const meterSegments = buckets.map((bucket, index) => (bucket.amount > 0
      ? `<span style="width:${(bucket.amount / agingTotal) * 100}%;background:${AGING_COLORS[index]}" title="${escapeHtml(bucket.label)} ${formatMoney(bucket.amount)}"></span>`
      : "")).join("");
    const bucketCards = buckets.map((bucket, index) => `<div>
      <small><span class="legend-dot" style="background:${AGING_COLORS[index]}"></span>${escapeHtml(bucket.label)}</small>
      <strong>${formatMoney(bucket.amount)}</strong> <span class="muted">(${formatNumber(bucket.count)})</span>
    </div>`).join("");
    byId("subledger-aging").innerHTML = `<div class="card">
      <div class="card-head"><h3>วิเคราะห์อายุ${settings.noun}</h3><span class="muted">ณ วันที่ ${escapeHtml(formatDate(today))}</span></div>
      <div class="meter">${meterSegments}</div>
      <div class="info-grid" style="margin-top:12px">${bucketCards}</div>
    </div>`;
  }

  function renderPartySummary() {
    const partyRows = subledger.parties.map((party) => `<tr>
      <td>${escapeHtml(party.partyName)}</td>
      <td class="right">${formatNumber(party.documentCount)}</td>
      <td class="right">${formatMoney(party.invoiced)}</td>
      <td class="right">${formatMoney(party.paid)}</td>
      <td class="right"><strong>${formatMoney(party.outstanding)}</strong></td>
      <td class="right">${party.unappliedCredit ? formatMoney(party.unappliedCredit) : "-"}</td>
    </tr>`).join("");
    document.querySelector("#subledger-parties tbody").innerHTML = partyRows || '<tr><td colspan="6" class="muted">ยังไม่มีข้อมูล</td></tr>';
    byId("subledger-parties-count").textContent = `${formatNumber(subledger.parties.length)} ราย`;
  }

  /* ---------------------------------------------------------------- */
  /* ตารางเอกสาร                                                        */
  /* ---------------------------------------------------------------- */

  function renderStatusChips(today) {
    const counts = { open: 0, overdue: 0, paid: 0, all: subledger.documents.length };
    subledger.documents.forEach((item) => {
      const status = getStatus(item, today);
      if (status === "paid") counts.paid += 1;
      else counts.open += 1;
      if (status === "overdue") counts.overdue += 1;
    });
    byId("subledger-status-filter").innerHTML = Object.entries(STATUS_FILTER_LABELS).map(([status, label]) =>
      `<button type="button" class="chip" data-status="${status}" aria-pressed="${statusFilter === status}">${label}<span class="count">${formatNumber(counts[status])}</span></button>`).join("");
  }

  function getVisibleDocuments(today) {
    const searchText = byId("subledger-search").value.trim().toLowerCase();
    const { from, to } = getDateRange();
    return subledger.documents.filter((item) => {
      const status = getStatus(item, today);
      if (statusFilter === "open" && status === "paid") return false;
      if (statusFilter === "overdue" && status !== "overdue") return false;
      if (statusFilter === "paid" && status !== "paid") return false;
      const documentDate = toIsoDate(item.date);
      if (from && documentDate < from) return false;
      if (to && documentDate > to) return false;
      return !searchText || `${item.partyName} ${item.docNo} ${item.desc}`.toLowerCase().includes(searchText);
    });
  }

  function renderStatusBadge(item, status, today) {
    if (status === "paid") return '<span class="badge success dot">ชำระครบ</span>';
    if (status === "overdue") return `<span class="badge danger dot">เกินกำหนด ${formatNumber(getDaysOverdue(item, today))} วัน</span>`;
    return item.paid > 0 ? '<span class="badge info dot">ชำระบางส่วน</span>' : '<span class="badge warning dot">รอชำระ</span>';
  }

  /** ลิงก์ไปสมุดรายวัน โดยค้นหาเลขที่เอกสารให้ */
  const journalLink = (documentNumber) =>
    `<a href="../journal/journal.html?q=${encodeURIComponent(documentNumber)}" title="ดูรายการในสมุดรายวัน">${escapeHtml(documentNumber || "-")}</a>`;

  function renderPaymentHistoryRow(item) {
    const paymentRows = item.payments.map((payment) => `<tr>
      <td>${escapeHtml(formatDate(payment.date))}</td>
      <td>${journalLink(payment.docNo)}</td>
      <td class="right">${formatMoney(payment.amount)}</td>
    </tr>`).join("");
    const historyTable = paymentRows
      ? `<table><thead><tr><th>วันที่</th><th>รายการในสมุดรายวัน</th><th class="right">จำนวนเงิน</th></tr></thead><tbody>${paymentRows}</tbody></table>`
      : '<p class="muted">ยังไม่มีการชำระ</p>';
    return `<tr class="history-row"><td colspan="9"><div class="history"><strong>ประวัติ${settings.settleVerb}</strong>${historyTable}</div></td></tr>`;
  }

  function renderDocumentRow(item, today) {
    const status = getStatus(item, today);
    const isExpanded = expandedEntryId === item.entryId;
    const historyToggle = item.payments.length
      ? `<span class="cell-sub"><button type="button" class="link-button" data-history="${escapeHtml(item.entryId)}">${isExpanded ? "ซ่อนประวัติ" : `ประวัติ (${formatNumber(item.payments.length)})`}</button></span>`
      : "";
    const settleButton = status !== "paid"
      ? `<button type="button" class="small" data-settle="${escapeHtml(item.entryId)}">${settings.settleVerb}</button>`
      : "";
    const mainRow = `<tr${isExpanded ? ' class="is-expanded"' : ""}>
      <td>${escapeHtml(item.partyName)}<span class="cell-sub">${escapeHtml(item.desc)}</span></td>
      <td class="nowrap">${journalLink(item.docNo)}</td>
      <td class="nowrap">${escapeHtml(formatDate(item.date))}</td>
      <td class="nowrap">${escapeHtml(item.due ? formatDate(item.due) : "-")}</td>
      <td class="right">${formatMoney(item.amount)}</td>
      <td class="right">${formatMoney(item.paid)}${historyToggle}</td>
      <td class="right"><strong>${formatMoney(item.outstanding)}</strong></td>
      <td>${renderStatusBadge(item, status, today)}</td>
      <td class="actions-cell">${settleButton}</td>
    </tr>`;
    return mainRow + (isExpanded ? renderPaymentHistoryRow(item) : "");
  }

  function renderPage() {
    subledger = buildSubledger(subledgerType);
    if (dateClearButton) {
      const { from, to } = getDateRange();
      dateClearButton.hidden = !from && !to;
    }
    const today = getTodayIso();
    renderLegacyMigrationBanner();

    if (!subledger.controlAccount) {
      byId("subledger-summary").innerHTML = "";
      byId("subledger-aging").innerHTML = "";
      tableBody.innerHTML = `<tr><td colspan="9" class="muted">ยังไม่พบบัญชี${settings.controlAccountName} — <a href="../settings/settings.html">กำหนดที่หน้าการตั้งค่า</a> หรือเพิ่มผังบัญชีมาตรฐาน</td></tr>`;
      return;
    }

    renderSummaryCards(today);
    renderAging(today);
    renderPartySummary();
    renderStatusChips(today);

    if (!subledger.documents.length) {
      tableBody.innerHTML = `<tr><td colspan="9" class="muted">ยังไม่มีรายการ${settings.noun} — บันทึกรายการที่ใช้บัญชี${settings.controlAccountName}ในสมุดรายวัน พร้อมระบุคู่ค้า</td></tr>`;
      return;
    }
    const visibleDocuments = getVisibleDocuments(today)
      .sort(settings.compareDocuments);
    tableBody.innerHTML = visibleDocuments.length
      ? visibleDocuments.map((item) => renderDocumentRow(item, today)).join("")
      : '<tr><td colspan="9" class="muted">ไม่มีรายการตามตัวกรองนี้</td></tr>';
  }

  /* ---------------------------------------------------------------- */
  /* รับชำระ / จ่ายชำระ                                                  */
  /* ---------------------------------------------------------------- */

  async function recordSettlement(item) {
    const cashAccounts = getCashAccountOptions();
    if (!cashAccounts.options.length) {
      notifyError("ยังไม่มีบัญชีสินทรัพย์สำหรับรับ/จ่ายเงิน");
      return;
    }
    const values = await formDialog({
      title: `${settings.settleVerb} ${item.docNo}`.trim(),
      message: `${item.partyName} · คงค้าง ${formatMoney(item.outstanding)} — ระบบจะบันทึกรายการในสมุดรายวันให้`,
      confirmText: `บันทึก${settings.settleVerb}`,
      fields: [
        { name: "date", label: "วันที่", type: "date", value: getTodayIso(), required: true },
        { name: "amount", label: "จำนวนเงิน", type: "number", value: item.outstanding.toFixed(2), min: 0.01, max: item.outstanding, step: "0.01", required: true },
        { name: "accountId", label: settings.cashFieldLabel, type: "select", value: cashAccounts.defaultAccountId, options: cashAccounts.options, required: true },
      ],
    });
    if (!values) return;

    const amount = roundMoney(values.amount);
    if (amount <= 0 || amount - item.outstanding > AMOUNT_EPSILON) {
      notifyError("จำนวนเงินไม่ถูกต้อง");
      return;
    }
    if (isDateLocked(values.date)) {
      notifyError(getLockedPeriodMessage());
      return;
    }
    const posting = buildSettlementLines(subledgerType, { accountId: values.accountId, amount });
    if (posting.error) {
      notifyError(posting.error);
      return;
    }

    const entries = state.entries.slice();
    const entryId = upsertJournalEntry(entries, {
      date: values.date,
      desc: `${settings.settlementDescription} ${item.docNo} ${item.partyName}`.trim(),
      lines: posting.lines,
      customerId: item.customerId,
      customerName: item.customerName,
    });
    // ระบุว่าการชำระนี้ตัดเอกสารใบไหน (ไม่ใช่ตัดเอกสารเก่าสุดโดยอัตโนมัติ)
    const settlementEntry = entries.find((entry) => entry.id === entryId);
    settlementEntry.appliesTo = item.entryId;

    const savePromise = commitChanges({ entries: sortEntriesByDate(entries) });
    renderPage();
    if (await savePromise) notifySuccess(`บันทึก${settings.settleVerb} ${formatMoney(amount)} ในสมุดรายวัน (${settlementEntry.docNo}) เรียบร้อย`);
    else renderPage();
  }

  /* ---------------------------------------------------------------- */
  /* ย้ายข้อมูลจากระบบเดิม (ฟอร์มลูกหนี้/เจ้าหนี้แบบแยก)                     */
  /* ---------------------------------------------------------------- */

  const getLegacyRecords = () => state[settings.legacyCollection].filter((record) => !record.migratedAt);

  function renderLegacyMigrationBanner() {
    const container = byId("subledger-legacy");
    const legacyRecords = getLegacyRecords();
    if (!legacyRecords.length) {
      container.innerHTML = "";
      return;
    }
    const unpostedCount = legacyRecords.filter((record) => !record.entryId).length;
    container.innerHTML = `<div class="banner warn">
      <span>มีข้อมูล${settings.noun}จากระบบเดิม <strong>${formatNumber(legacyRecords.length)}</strong> เอกสาร${unpostedCount ? ` (ยังไม่ลงบัญชี ${formatNumber(unpostedCount)})` : ""} — ย้ายเข้าสมุดรายวันเพื่อให้แสดงในทะเบียนนี้</span>
      <button type="button" class="small" id="subledger-migrate" style="margin-left:auto">ย้ายข้อมูล</button>
    </div>`;
    byId("subledger-migrate").addEventListener("click", migrateLegacyRecords);
  }

  /** คู่ค้าของข้อมูลระบบเดิม (ลูกหนี้อ้างอิงทะเบียนลูกค้า, เจ้าหนี้เก็บชื่อผู้ขายเป็นข้อความ) */
  function getLegacyPartyFields(record) {
    if (subledgerType === "receivable") {
      const customer = findCustomerById(record.customerId);
      return { customerId: record.customerId || "", customerName: customer ? formatCustomerLabel(customer) : record.customerName || "" };
    }
    return { customerId: "", customerName: record.vendorName || "" };
  }

  async function migrateLegacyRecords() {
    const legacyRecords = getLegacyRecords();
    const unpostedRecords = legacyRecords.filter((record) => !record.entryId);
    const cashAccount = findAccountForRole("cash");
    const fields = unpostedRecords.length
      ? [{ name: "confirm", label: `ยืนยันว่าเอกสารที่ยังไม่ลงบัญชี ${unpostedRecords.length} ฉบับ ยังไม่เคยบันทึกในสมุดรายวัน (ป้องกันการลงบัญชีซ้ำ)`, type: "checkbox", value: false }]
      : [];
    const values = await formDialog({
      title: `ย้ายข้อมูล${settings.noun}เข้าสมุดรายวัน`,
      message: `เอกสารที่ลงบัญชีแล้ว: เติมคู่ค้าและวันครบกำหนดในรายการเดิม · เอกสารที่ยังไม่ลงบัญชี: สร้างรายการใหม่ รวมยอดที่ชำระแล้ว (ใช้บัญชี ${formatAccountLabel(cashAccount)})`,
      confirmText: "ย้ายข้อมูล",
      fields,
    });
    if (!values) return;
    if (unpostedRecords.length && !values.confirm) {
      notifyError("กรุณาติ๊กยืนยันก่อนย้ายข้อมูล");
      return;
    }

    const entries = state.entries.map((entry) => ({ ...entry }));
    const findEntry = (entryId) => entries.find((entry) => entry.id === entryId);
    const migratedAt = new Date().toISOString();
    const migratedIds = new Set();

    for (const record of legacyRecords) {
      const partyFields = getLegacyPartyFields(record);
      let documentEntryId = record.entryId;

      if (!documentEntryId) {
        if (isDateLocked(record.date)) continue; // อยู่ในงวดที่ปิดแล้ว: ข้ามไว้ ย้ายหลังปลดล็อก
        const posting = buildDocumentLines(subledgerType, record);
        if (posting.error) {
          notifyError(posting.error);
          return;
        }
        documentEntryId = upsertJournalEntry(entries, {
          date: toIsoDate(record.date) || record.date,
          desc: `${settings.documentDescription} ${record.docNo || ""} ${partyFields.customerName}`.trim(),
          lines: posting.lines,
          ...partyFields,
        });
        // ยอดที่ชำระแล้วในระบบเดิม → รายการรับ/จ่ายชำระ ที่ตัดเอกสารนี้
        const legacyPaid = roundMoney(record.paid);
        if (legacyPaid > AMOUNT_EPSILON && cashAccount) {
          const settlement = buildSettlementLines(subledgerType, { accountId: cashAccount.id, amount: legacyPaid });
          const settlementEntryId = upsertJournalEntry(entries, {
            date: toIsoDate(record.lastPaidAt) || toIsoDate(record.date) || record.date,
            desc: `${settings.settlementDescription} ${record.docNo || ""} ${partyFields.customerName}`.trim(),
            lines: settlement.lines,
            ...partyFields,
          });
          findEntry(settlementEntryId).appliesTo = documentEntryId;
        }
      } else {
        // ลงบัญชีแล้ว: เติมคู่ค้าให้รายการชำระเดิม (ระบบเดิมไม่ได้บันทึกผู้ขายในสมุดรายวัน)
        (record.payments || []).forEach((payment) => {
          const paymentEntry = payment.entryId && findEntry(payment.entryId);
          if (paymentEntry) Object.assign(paymentEntry, partyFields, { appliesTo: documentEntryId });
        });
      }

      const documentEntry = findEntry(documentEntryId);
      if (documentEntry) {
        Object.assign(documentEntry, partyFields);
        if (record.due) documentEntry.due = toIsoDate(record.due);
      }
      migratedIds.add(record.id);
    }

    const legacyCollection = state[settings.legacyCollection]
      .map((record) => (migratedIds.has(record.id) ? { ...record, migratedAt } : record));
    const savePromise = commitChanges({ entries: sortEntriesByDate(entries), [settings.legacyCollection]: legacyCollection });
    renderPage();
    if (await savePromise) notifySuccess(`ย้ายข้อมูล${settings.noun} ${formatNumber(migratedIds.size)} เอกสารเข้าสมุดรายวันเรียบร้อย`);
    else renderPage();
  }

  /* ---------------------------------------------------------------- */
  /* ส่งออก CSV และผูกอีเวนต์                                            */
  /* ---------------------------------------------------------------- */

  function exportCsv() {
    const today = getTodayIso();
    const documents = getVisibleDocuments(today).sort(settings.compareDocuments);
    if (!documents.length) {
      notifyError("ไม่มีรายการให้ส่งออก");
      return;
    }
    const statusLabels = { paid: "ชำระครบ", overdue: "เกินกำหนด", pending: "รอชำระ" };
    const headers = ["คู่ค้า", "เลขที่", "วันที่", "ครบกำหนด", "คำอธิบาย", "ยอดหนี้", settings.settledLabel, "คงค้าง", "สถานะ", "เกินกำหนด (วัน)"];
    const rows = documents.map((item) => [
      item.partyName, item.docNo, formatDate(item.date), formatDate(item.due), item.desc,
      item.amount, item.paid, item.outstanding, statusLabels[getStatus(item, today)], getDaysOverdue(item, today),
    ]);
    downloadCsv(`${settings.legacyCollection}-${getFileDateStamp()}.csv`, buildCsv(headers, rows));
    notifySuccess(`ส่งออก ${formatNumber(documents.length)} รายการ`);
  }

  tableBody.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const { settle: settleEntryId, history: historyEntryId } = button.dataset;
    if (settleEntryId) {
      const item = findDocument(settleEntryId);
      if (item) recordSettlement(item);
    } else if (historyEntryId) {
      expandedEntryId = expandedEntryId === historyEntryId ? null : historyEntryId;
      renderPage();
    }
  });
  byId("subledger-status-filter").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-status]");
    if (!chip) return;
    statusFilter = chip.dataset.status;
    renderPage();
  });
  byId("subledger-search").addEventListener("input", debounce(renderPage, 150));
  byId("subledger-export").addEventListener("click", exportCsv);

  // กรองตามวันที่เอกสาร: ช่องตั้งแต่–ถึง + ตัวเลือกเดือน (เปิดหน้ามาแสดงทุกวันที่ เพื่อไม่ให้ยอดค้างเก่าถูกซ่อน)
  let monthFilter = null;
  if (dateFromInput && dateToInput) {
    const handleDateChange = () => {
      monthFilter?.sync();
      renderPage();
    };
    dateFromInput.addEventListener("change", handleDateChange);
    dateToInput.addEventListener("change", handleDateChange);
    dateClearButton?.addEventListener("click", () => {
      dateFromInput.value = "";
      dateToInput.value = "";
      handleDateChange();
    });
  }

  if (!(await loadData(["accounts", "entries", "customers", "suppliers", settings.legacyCollection]))) return;
  watchDocumentNumberRepair();
  renderPage();
  if (dateFromInput && dateToInput) {
    // รายการเดือนมาจากวันที่ของเอกสารในทะเบียน
    monthFilter = createMonthFilter({
      fromInput: dateFromInput,
      toInput: dateToInput,
      getRecords: () => subledger.documents,
      onSelect: renderPage,
    });
    monthFilter.refresh();
  }
  onDataRefresh(() => {
    renderPage();
    monthFilter?.refresh();
  });
}

/**
 * Automatic double-entry postings for the subledgers (receivables/payables).
 * Each subledger document keeps the id of the journal entry it created
 * (`entryId`, and `payments[].entryId`) so edits and deletes stay in sync.
 */
import { AMOUNT_EPSILON, getAccount, nextSeqNo, roleAccount, state, uid } from "./data.js";

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** Amount split for a document. Legacy records only have `amount` (gross). */
export function docAmounts(record) {
  const total = round2(record.amount);
  if (record.net == null || record.net === "") return { net: total, vat: 0, total };
  const net = round2(record.net);
  const vat = round2(record.vat);
  return { net, vat, total: round2(net + vat) };
}

export function computeVat(net, rate) {
  const vat = round2((Number(net) || 0) * (Number(rate) || 0) / 100);
  return { net: round2(net), vat, total: round2((Number(net) || 0) + vat) };
}

const SUBLEDGERS = {
  receivable: {
    control: "receivable",
    defaultCounter: "revenue",
    vatRole: "vatOutput",
    docSource: "receivable",
    paySource: "receipt",
  },
  payable: {
    control: "payable",
    defaultCounter: "expense",
    vatRole: "vatInput",
    docSource: "payable",
    paySource: "payment",
  },
};

/**
 * Journal lines for the document itself.
 * Receivable: Dr ลูกหนี้ (total) / Cr รายได้ (net) / Cr ภาษีขาย (vat)
 * Payable:    Dr ค่าใช้จ่าย (net) / Dr ภาษีซื้อ (vat) / Cr เจ้าหนี้ (total)
 * Returns { lines } or { error }.
 */
export function documentLines(kind, record) {
  const config = SUBLEDGERS[kind];
  const control = roleAccount(config.control);
  const counter = getAccount(record.counterAccountId) || roleAccount(config.defaultCounter);
  const { net, vat, total } = docAmounts(record);
  if (!control) return { error: `ยังไม่ได้กำหนดบัญชี${kind === "receivable" ? "ลูกหนี้การค้า" : "เจ้าหนี้การค้า"} (ตั้งค่าได้ที่หน้าการตั้งค่า > บัญชีสำหรับลงบัญชีอัตโนมัติ)` };
  if (!counter) return { error: `เลือกบัญชี${kind === "receivable" ? "รายได้" : "ค่าใช้จ่าย"}ก่อน` };
  let vatAccount = null;
  if (vat > AMOUNT_EPSILON) {
    vatAccount = roleAccount(config.vatRole);
    if (!vatAccount) return { error: `ยังไม่ได้กำหนดบัญชี${kind === "receivable" ? "ภาษีขาย" : "ภาษีซื้อ"} (ตั้งค่าได้ที่หน้าการตั้งค่า)` };
  }
  const lines = kind === "receivable"
    ? [
      { accountId: control.id, debit: total, credit: 0 },
      { accountId: counter.id, debit: 0, credit: net },
      ...(vatAccount ? [{ accountId: vatAccount.id, debit: 0, credit: vat }] : []),
    ]
    : [
      { accountId: counter.id, debit: net, credit: 0 },
      ...(vatAccount ? [{ accountId: vatAccount.id, debit: vat, credit: 0 }] : []),
      { accountId: control.id, debit: 0, credit: total },
    ];
  return { lines };
}

/**
 * Receipt (receivable): Dr เงินสด/ธนาคาร / Cr ลูกหนี้
 * Payment (payable):    Dr เจ้าหนี้ / Cr เงินสด/ธนาคาร
 */
export function settlementLines(kind, payment) {
  const control = roleAccount(SUBLEDGERS[kind].control);
  const cash = getAccount(payment.accountId);
  if (!control) return { error: "ยังไม่ได้กำหนดบัญชีคุม (ตั้งค่าได้ที่หน้าการตั้งค่า)" };
  if (!cash) return { error: "เลือกบัญชีเงินสด/ธนาคาร" };
  const amount = round2(payment.amount);
  const lines = kind === "receivable"
    ? [{ accountId: cash.id, debit: amount, credit: 0 }, { accountId: control.id, debit: 0, credit: amount }]
    : [{ accountId: control.id, debit: amount, credit: 0 }, { accountId: cash.id, debit: 0, credit: amount }];
  return { lines };
}

/**
 * Create or update a linked journal entry inside `entries` (a copy the caller saves).
 * Returns the entry id.
 */
export function upsertEntry(entries, { entryId, date, desc, lines, source, customerId, customerName }) {
  const existingIndex = entryId ? entries.findIndex((entry) => entry.id === entryId) : -1;
  const now = new Date().toISOString();
  if (existingIndex >= 0) {
    const existing = entries[existingIndex];
    entries[existingIndex] = { ...existing, date, desc, lines, source, updatedAt: now, ...(customerName ? { customerName } : {}), ...(customerId ? { customerId } : {}) };
    return existing.id;
  }
  const id = uid();
  entries.push({
    id,
    date,
    docNo: nextSeqNo(entries, "JV", date),
    kind: "general",
    desc,
    lines,
    source,
    createdAt: now,
    ...(customerName ? { customerName } : {}),
    ...(customerId ? { customerId } : {}),
  });
  return id;
}

export function sortEntries(entries) {
  entries.sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")) || String(left.id).localeCompare(String(right.id)));
  return entries;
}

export function linkedEntryIds(record) {
  return [record.entryId, ...(record.payments || []).map((payment) => payment.entryId)].filter(Boolean);
}

export const SOURCE_LABELS = {
  receivable: { label: "ตั้งลูกหนี้", page: "receivables" },
  receipt: { label: "รับชำระหนี้", page: "receivables" },
  payable: { label: "ตั้งเจ้าหนี้", page: "payables" },
  payment: { label: "จ่ายชำระหนี้", page: "payables" },
  closing: { label: "ปิดบัญชี", page: "settings" },
};

export { SUBLEDGERS };

/** Cash/bank accounts offered when recording a receipt or payment. */
export function cashAccountOptions() {
  const preferred = roleAccount("cash");
  const assets = state.accounts
    .filter((account) => account.type === "asset")
    .sort((left, right) => String(left.code).localeCompare(String(right.code), "th-TH", { numeric: true }));
  return {
    options: assets.map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` })),
    defaultId: preferred ? preferred.id : assets[0]?.id || "",
  };
}

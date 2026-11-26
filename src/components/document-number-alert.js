/**
 * @file แจ้งเตือนที่กระดิ่ง เมื่อมีเลขที่เอกสารที่ต้องซ่อมแซม
 *
 * ตรวจด้วยเงื่อนไขเดียวกับการ์ด "ซ่อมแซมลำดับเลขที่เอกสาร" ในหน้าการตั้งค่า (แท็บการปรับปรุง)
 * - มีรายการต้องซ่อมแซม → ขึ้นการแจ้งเตือนในกระดิ่ง พร้อมลิงก์ไปหน้าซ่อมแซม
 * - ซ่อมแซมแล้ว / ไม่มีปัญหา → ลบการแจ้งเตือนนั้นออกเอง
 *
 * ใช้ได้เฉพาะหน้าที่โหลดชุดข้อมูล "entries" แล้วเท่านั้น (หน้าอื่น state.entries ว่าง จะลบการแจ้งเตือนผิด ๆ)
 */

import { onDataRefresh, state } from "../core/store.js";
import { planDocumentNumberRepair } from "../accounting/journal.js";
import { clearStandingAlert, setStandingAlert } from "./notifications.js";
import { watchDocumentNumberRepair } from "./document-number-repair-job.js";

const ALERT_ID = "doc-number-repair";
/** ตรวจว่ารายการเปลี่ยนไหมทุก ๆ กี่มิลลิวินาที (เปรียบเทียบแค่การอ้างอิงอาร์เรย์ — ถูกมาก) */
const CHECK_INTERVAL_MS = 3000;
const SETTINGS_PAGE_URL = new URL("../../pages/settings/settings.html#maintenance", import.meta.url);

let lastChecked = { entries: null, lockDate: null };
let isCheckScheduled = false;

function checkDocumentNumbers() {
  isCheckScheduled = false;
  const lockDate = state.settings.lockDate || "";
  if (lastChecked.entries === state.entries && lastChecked.lockDate === lockDate) return;
  lastChecked = { entries: state.entries, lockDate };

  const plan = planDocumentNumberRepair(state.entries);
  if (!plan.changedCount) {
    clearStandingAlert(ALERT_ID);
    return;
  }
  const count = plan.changedCount.toLocaleString("th-TH");
  const monthCount = plan.monthCount.toLocaleString("th-TH");
  setStandingAlert(ALERT_ID, `เลขที่เอกสาร ${count} รายการใน ${monthCount} เดือน ไม่เรียงตามวันที่หรือข้ามเลข — กดซ่อมแซมได้ที่หน้าการตั้งค่า แท็บการปรับปรุง`, {
    title: "มีรายการที่ต้องซ่อมแซม",
    page: `${SETTINGS_PAGE_URL.pathname}${SETTINGS_PAGE_URL.hash}`,
    pageTitle: "ไปหน้าซ่อมแซม",
  });
}

/** ตรวจตอนเบราว์เซอร์ว่าง (รายการมีหลายหมื่น ไม่ให้หน้าเว็บกระตุก) */
function scheduleCheck() {
  if (isCheckScheduled) return;
  if (lastChecked.entries === state.entries && lastChecked.lockDate === (state.settings.lockDate || "")) return;
  isCheckScheduled = true;
  if ("requestIdleCallback" in window) window.requestIdleCallback(checkDocumentNumbers, { timeout: 2000 });
  else window.setTimeout(checkDocumentNumbers, 200);
}

/**
 * เริ่มเฝ้าดูเลขที่เอกสาร เรียกหลัง loadData([... "entries" ...]) สำเร็จ
 * ตรวจครั้งแรกทันที แล้วตรวจใหม่เมื่อรายการเปลี่ยน (บันทึกในหน้านี้ หรือซิงก์ได้ข้อมูลใหม่)
 */
export function watchDocumentNumbers() {
  // กดซ่อมแซมแล้วเปลี่ยนหน้ากลางคัน → หน้านี้ซ่อมแซมต่อจนเสร็จ
  watchDocumentNumberRepair();
  scheduleCheck();
  onDataRefresh(scheduleCheck);
  window.setInterval(scheduleCheck, CHECK_INTERVAL_MS);
}

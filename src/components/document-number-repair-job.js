/**
 * @file งานซ่อมแซมลำดับเลขที่เอกสาร ที่ทำต่อได้แม้ผู้ใช้เปลี่ยนหน้า
 *
 * - กดซ่อมแซมในหน้าการตั้งค่า → ตั้ง "ล็อกการบันทึก" (store.js) ไว้ใน localStorage แล้วเริ่มบันทึก
 * - ระหว่างนั้นผู้ใช้ไปหน้าอื่นได้ แต่ทุกหน้า (ทุกแท็บ) บันทึกไม่ได้จนกว่าจะซ่อมแซมเสร็จ
 * - เปลี่ยนหน้ากลางคัน การบันทึกในหน้าเดิมถูกยกเลิก → หน้าถัดไปเห็นล็อกค้าง ก็ซิงก์ข้อมูลล่าสุด
 *   แล้ววางแผนซ่อมแซมใหม่และบันทึกต่อเอง (การวางแผนให้ผลเดิมเสมอ ถ้าบันทึกไปแล้วจะเหลือ 0 รายการ = เสร็จ)
 * - หน้าที่กำลังทำงานอยู่จะต่ออายุ (heartbeat) ไว้ หน้าอื่น/แท็บอื่นจึงไม่ทำซ้อนกัน
 *   และรับช่วงต่อเมื่อหน้านั้นปิดไปหรือเงียบไปนาน
 */

import {
  commitChanges,
  getSaveLock,
  isCollectionLoaded,
  loadData,
  setSaveLock,
  state,
  waitForSync,
} from "../core/store.js";
import { planDocumentNumberRepair } from "../accounting/journal.js";
import { notifyError, notifySuccess } from "./notifications.js";

const LOCK_REASON = "doc-number-repair";
const LOCK_MESSAGE = "กำลังซ่อมแซมลำดับเลขที่เอกสาร ยังบันทึกไม่ได้จนกว่าจะซ่อมแซมเสร็จ กรุณารอสักครู่";
/** ต่ออายุทุก ๆ กี่มิลลิวินาที */
const HEARTBEAT_MS = 1000;
/** เงียบเกินนี้ = หน้าที่ทำอยู่ปิดไปแล้ว หน้าอื่นรับช่วงต่อได้ */
const STALE_MS = 5000;
/** ตรวจล็อกค้าง (เพื่อรับช่วงต่อ / ลองใหม่) ทุก ๆ กี่มิลลิวินาที */
const CHECK_INTERVAL_MS = 3000;
/** อีเวนต์ที่ยิงเมื่อสถานะงานเปลี่ยน (เริ่ม / เสร็จ / ล้มเหลว) */
const CHANGE_EVENT = "doc-number-repair-change";

const pageId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
/** @type {Promise<RepairResult> | null} งานที่หน้านี้กำลังทำ */
let runningJob = null;
let heartbeatTimer = null;
let isWatching = false;
/** ล้มเหลวล่าสุดเมื่อไร — เว้นช่วงก่อนลองใหม่ ไม่ให้แจ้งเตือนรัว ๆ */
let lastFailureAt = 0;
const RETRY_DELAY_MS = 20000;

/** @typedef {{ isSaved: boolean, changedCount: number }} RepairResult */

/** มีงานซ่อมแซมค้างอยู่ (หน้าไหนก็ได้) หรือไม่ */
export function isDocumentNumberRepairPending() {
  const lock = getSaveLock();
  return Boolean(lock && lock.reason === LOCK_REASON);
}

/** @param {() => void} callback เรียกเมื่อสถานะงานเปลี่ยน (รวมจากแท็บอื่น) */
export function onDocumentNumberRepairChange(callback) {
  window.addEventListener(CHANGE_EVENT, callback);
}

function emitChange() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** หน้าอื่นกำลังทำอยู่ และยังไม่เงียบไป */
function isOwnedElsewhere(lock) {
  return Boolean(lock.ownerId && lock.ownerId !== pageId && Date.now() - (lock.heartbeatAt || 0) < STALE_MS);
}

function claimLock() {
  const current = getSaveLock();
  setSaveLock({
    reason: LOCK_REASON,
    message: LOCK_MESSAGE,
    startedAt: current && current.reason === LOCK_REASON ? current.startedAt : Date.now(),
    ownerId: pageId,
    heartbeatAt: Date.now(),
  });
  window.clearInterval(heartbeatTimer);
  heartbeatTimer = window.setInterval(() => {
    const lock = getSaveLock();
    // ถูกปลดล็อก/หน้าอื่นรับช่วงไปแล้ว → หยุดต่ออายุ
    if (!lock || lock.reason !== LOCK_REASON || lock.ownerId !== pageId) {
      window.clearInterval(heartbeatTimer);
      return;
    }
    setSaveLock({ ...lock, heartbeatAt: Date.now() });
  }, HEARTBEAT_MS);
}

/** เลิกถือล็อก แต่ยังคงล็อกไว้ (ซ่อมแซมยังไม่เสร็จ) ให้หน้าอื่น/รอบถัดไปทำต่อ */
function releaseOwnership() {
  window.clearInterval(heartbeatTimer);
  const lock = getSaveLock();
  if (lock && lock.ownerId === pageId) setSaveLock({ ...lock, ownerId: "", heartbeatAt: 0 });
}

function finishLock() {
  window.clearInterval(heartbeatTimer);
  const lock = getSaveLock();
  if (lock && lock.reason === LOCK_REASON) setSaveLock(null);
}

/** โหลดข้อมูลที่ต้องใช้วางแผน (บางหน้าไม่ได้โหลดผังบัญชี/รายการไว้) แล้วรอให้ตรงกับเซิร์ฟเวอร์ */
async function ensureDataReady() {
  await waitForSync();
  const missing = ["accounts", "entries"].filter((collection) => !isCollectionLoaded(collection));
  if (missing.length && !(await loadData(missing))) return false;
  return waitForSync();
}

/** วางแผนจากข้อมูลล่าสุดแล้วบันทึก (ลองซ้ำหนึ่งครั้ง เผื่อชนกับเครื่องอื่น — ระบบโหลดข้อมูลใหม่ให้แล้ว) */
async function performRepair() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!(await ensureDataReady())) return { isSaved: false, changedCount: 0 };
    const plan = planDocumentNumberRepair(state.entries);
    if (!plan.changedCount) return { isSaved: true, changedCount: 0 };
    const isSaved = await commitChanges({ entries: plan.entries }, ["entries"], { ignoreSaveLock: true });
    if (isSaved) return { isSaved: true, changedCount: plan.changedCount };
  }
  return { isSaved: false, changedCount: 0 };
}

/**
 * เริ่ม (หรือทำต่อ) การซ่อมแซม — ตั้งล็อกการบันทึกก่อนเสมอ
 * @returns {Promise<RepairResult>} isSaved = ซ่อมแซมเสร็จ (ล็อกถูกปลดแล้ว)
 */
export function runDocumentNumberRepair() {
  if (runningJob) return runningJob;
  claimLock();
  emitChange();
  runningJob = (async () => {
    try {
      const result = await performRepair();
      if (result.isSaved) finishLock();
      else {
        releaseOwnership();
        lastFailureAt = Date.now();
      }
      return result;
    } catch (error) {
      console.error(error);
      releaseOwnership();
      lastFailureAt = Date.now();
      return { isSaved: false, changedCount: 0 };
    } finally {
      runningJob = null;
      emitChange();
    }
  })();
  return runningJob;
}

/** มีงานค้างที่ไม่มีหน้าไหนทำอยู่ → ทำต่อในหน้านี้ */
async function resumeIfAbandoned() {
  if (runningJob || document.prerendering) return;
  const lock = getSaveLock();
  if (!lock || lock.reason !== LOCK_REASON || isOwnedElsewhere(lock)) return;
  if (lastFailureAt && Date.now() - lastFailureAt < RETRY_DELAY_MS) return;
  const result = await runDocumentNumberRepair();
  if (result.isSaved && result.changedCount) {
    notifySuccess(`ซ่อมแซมเลขที่เอกสาร ${result.changedCount.toLocaleString("th-TH")} รายการเรียบร้อย บันทึกได้ตามปกติแล้ว`);
  } else if (result.isSaved) {
    notifySuccess("ซ่อมแซมลำดับเลขที่เอกสารเรียบร้อย บันทึกได้ตามปกติแล้ว");
  } else {
    notifyError("ซ่อมแซมลำดับเลขที่เอกสารยังไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ (ระหว่างนี้ยังบันทึกไม่ได้)");
  }
}

/**
 * เฝ้าดูงานซ่อมแซมที่ค้างอยู่ — เรียกหลัง loadData() ของหน้าสำเร็จ (ทุกหน้าที่บันทึกข้อมูลได้)
 * หน้าที่ทำงานอยู่ปิดไป/เปลี่ยนหน้า → หน้านี้ทำต่อให้จนเสร็จ
 */
export function watchDocumentNumberRepair() {
  if (isWatching) return;
  isWatching = true;
  resumeIfAbandoned();
  window.setInterval(resumeIfAbandoned, CHECK_INTERVAL_MS);
  window.addEventListener("online", () => {
    lastFailureAt = 0;
    resumeIfAbandoned();
  });
  // หน้าที่โหลดไว้ล่วงหน้า (prerender) ไม่ทำงานจนกว่าจะแสดงจริง
  if (document.prerendering) document.addEventListener("prerenderingchange", resumeIfAbandoned, { once: true });
  // แท็บอื่นเริ่มหรือซ่อมแซมเสร็จ → ให้หน้านี้วาดสถานะใหม่ (ไม่นับการต่ออายุ ซึ่งเกิดทุกวินาที)
  let wasPending = isDocumentNumberRepairPending();
  window.addEventListener("storage", () => {
    const isPending = isDocumentNumberRepairPending();
    if (isPending === wasPending) return;
    wasPending = isPending;
    emitChange();
  });
  // ออกจากหน้าระหว่างที่ทำอยู่ → ปล่อยให้หน้าถัดไปรับช่วงต่อทันที (ไม่ต้องรอให้เงียบไปก่อน)
  window.addEventListener("pagehide", () => {
    if (runningJob) releaseOwnership();
  });
}

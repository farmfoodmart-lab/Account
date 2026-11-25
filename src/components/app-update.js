/**
 * @file อัปเดตเวอร์ชันโปรแกรมจาก GitHub
 *
 * - เวอร์ชันปัจจุบันอ่านจาก version.json ในโฟลเดอร์โปรแกรม (ไฟล์เดียวที่ต้องแก้เมื่อออกเวอร์ชันใหม่)
 * - เทียบกับ version.json บน GitHub ถ้าใหม่กว่า → ถามผู้ใช้ แล้วดาวน์โหลดทุกไฟล์ใน repository มาเขียนทับในเครื่อง
 * - เขียนไฟล์ผ่าน File System Access API (เลือกโฟลเดอร์โปรแกรมครั้งแรก แล้วจำไว้ใน IndexedDB)
 *
 * วิธีออกเวอร์ชันใหม่: แก้ "version" (และ "notes") ใน version.json แล้ว push ขึ้น GitHub
 *
 * โหลดโดย app-shell.js (import แบบ dynamic) — ปุ่มอยู่ที่ท้ายเมนูด้านข้าง
 */
import { notify, notifyError, notifySuccess } from "./notifications.js";

/** ชื่อบัญชี/ชื่อ repository บน GitHub (ต้องเป็น public) */
const UPDATE_REPO = "farmfoodmart-lab/Account";
const UPDATE_BRANCH = "main";
/** ไฟล์ที่ต้องมีในโฟลเดอร์โปรแกรม (ใช้ตรวจว่าเลือกโฟลเดอร์ถูก) */
const APP_MARKER_FILE = "Accounting.html";
/** ตรวจอัตโนมัติครั้งเดียวต่อการเปิดโปรแกรม (ต่อแท็บ) */
const AUTO_CHECK_KEY = "app-update-checked";

const APP_ROOT_URL = new URL("../../", import.meta.url);

const versionLabel = document.getElementById("app-version");
const checkButton = document.getElementById("update-check");

let currentVersion = "";
let isBusy = false;

/* ------------------------------------------------------------------ */
/* เวอร์ชัน                                                              */
/* ------------------------------------------------------------------ */

/**
 * URL ไฟล์บน GitHub
 * @param {string} path
 * @param {string} [ref] รหัส commit (ไฟล์ตายตัว ไม่ติดแคช) หรือชื่อ branch (แคชของ GitHub อาจช้าได้ถึง 5 นาที)
 */
function rawUrl(path, ref = UPDATE_BRANCH) {
  return `https://raw.githubusercontent.com/${UPDATE_REPO}/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (ต่างจากข้อผิดพลาดอื่น เพื่อแจ้งผู้ใช้ได้ตรงสาเหตุ) */
class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * fetch พร้อมแปลงข้อผิดพลาดให้อ่านเข้าใจ
 * @param {string} url
 * @param {{ bustCache?: boolean }} [options] bustCache = เติม ?t= กันแคช (ไม่ต้องใช้กับ URL ที่อ้าง commit)
 */
async function request(url, { bustCache = true } = {}) {
  const target = bustCache ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url;
  let response;
  try {
    response = await fetch(target, { cache: "no-store" });
  } catch (error) {
    throw new NetworkError(`เชื่อมต่อ ${new URL(url).host} ไม่ได้ (${(error && error.message) || error})`);
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} — ${url}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

/**
 * รหัส commit ล่าสุดของ branch — ใช้อ่าน version.json และดาวน์โหลดไฟล์จาก commit เดียวกันทั้งหมด
 * (ไม่ติดแคชของ GitHub และไม่ได้ไฟล์ปนกันระหว่างเวอร์ชัน)
 * อ่านไม่ได้ (เช่น เกินโควตา API) → ใช้ชื่อ branch แทน
 */
async function getLatestCommitRef() {
  try {
    const commit = await fetchJson(`https://api.github.com/repos/${UPDATE_REPO}/commits/${UPDATE_BRANCH}`, { bustCache: false });
    return typeof commit.sha === "string" && commit.sha ? commit.sha : UPDATE_BRANCH;
  } catch {
    return UPDATE_BRANCH;
  }
}

/** @returns {-1 | 0 | 1} */
function compareVersions(left, right) {
  const toParts = (version) => String(version).split(".").map((part) => parseInt(part, 10) || 0);
  const a = toParts(left);
  const b = toParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchJson(url, options) {
  return (await request(url, options)).json();
}

async function readLocalVersion() {
  try {
    const local = await fetchJson(new URL("version.json", APP_ROOT_URL).href);
    return String(local.version || "");
  } catch {
    return "";
  }
}

/** ป้องกันเส้นทางไฟล์ที่ออกนอกโฟลเดอร์โปรแกรม */
function isSafePath(path) {
  return typeof path === "string" && path !== "" && !path.startsWith("/") && !path.includes("\\")
    && path.split("/").every((part) => part && part !== "." && part !== "..");
}

/**
 * รายชื่อไฟล์ที่ต้องอัปเดต: ใช้ "files" ใน version.json ถ้ามี ไม่เช่นนั้นใช้ทุกไฟล์ใน repository
 * @param {{ files?: string[] }} release
 * @returns {Promise<string[]>}
 */
async function listReleaseFiles(release) {
  if (Array.isArray(release.files) && release.files.length) return release.files;
  const ref = release.ref || UPDATE_BRANCH;
  const tree = await fetchJson(`https://api.github.com/repos/${UPDATE_REPO}/git/trees/${ref}?recursive=1`, { bustCache: false });
  if (!Array.isArray(tree.tree) || tree.truncated) throw new Error("อ่านรายชื่อไฟล์บน GitHub ไม่ครบ");
  return tree.tree.filter((node) => node.type === "blob").map((node) => node.path);
}

/* ------------------------------------------------------------------ */
/* โฟลเดอร์โปรแกรม (จำไว้ใน IndexedDB)                                      */
/* ------------------------------------------------------------------ */

function withHandleStore(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("accounting-updater", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const transaction = open.result.transaction("handles", mode);
      const request = action(transaction.objectStore("handles"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

async function getAppFolder() {
  let folder = null;
  try {
    folder = await withHandleStore("readonly", (store) => store.get("app-folder"));
  } catch {
    folder = null;
  }
  if (folder && (await folder.requestPermission({ mode: "readwrite" })) === "granted") return folder;

  notify(`เลือกโฟลเดอร์ที่ติดตั้งโปรแกรม (โฟลเดอร์ที่มีไฟล์ ${APP_MARKER_FILE})`);
  folder = await window.showDirectoryPicker({ id: "accounting-app", mode: "readwrite" });
  try {
    await folder.getFileHandle(APP_MARKER_FILE);
  } catch {
    throw new Error(`โฟลเดอร์นี้ไม่มีไฟล์ ${APP_MARKER_FILE} กรุณาเลือกโฟลเดอร์ของโปรแกรม`);
  }
  try {
    await withHandleStore("readwrite", (store) => store.put(folder, "app-folder"));
  } catch {
    // ไม่จำก็ได้ ครั้งหน้าเลือกใหม่
  }
  return folder;
}

async function writeFile(folder, path, data) {
  const parts = path.split("/");
  let directory = folder;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
  const handle = await directory.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

/* ------------------------------------------------------------------ */
/* ตรวจสอบและอัปเดต                                                       */
/* ------------------------------------------------------------------ */

function setBusy(busy) {
  isBusy = busy;
  if (!checkButton) return;
  checkButton.disabled = busy;
  checkButton.classList.toggle("is-spinning", busy);
}

function markUpdateAvailable(version) {
  if (!checkButton) return;
  checkButton.classList.toggle("has-update", Boolean(version));
  checkButton.title = version ? `มีเวอร์ชันใหม่ v${version} — คลิกเพื่ออัปเดต` : "ตรวจสอบการอัปเดตโปรแกรม";
}

/** @returns {Promise<object | null>} ข้อมูลเวอร์ชันใหม่ หรือ null ถ้าใช้เวอร์ชันล่าสุดแล้ว */
async function fetchNewerRelease() {
  const ref = await getLatestCommitRef();
  let release;
  try {
    release = await fetchJson(rawUrl("version.json", ref), { bustCache: ref === UPDATE_BRANCH });
  } catch (error) {
    if (error && error.status === 404) {
      throw new Error(`ไม่พบข้อมูลเวอร์ชันบน GitHub (${UPDATE_REPO}) — repository ยังไม่ได้สร้าง ยังเป็น Private หรือยังไม่ได้ push version.json ขึ้น branch ${UPDATE_BRANCH}`);
    }
    throw error;
  }
  if (!release || !release.version) throw new Error("ข้อมูลเวอร์ชันบน GitHub ไม่ถูกต้อง");
  // จำ commit ไว้ ดาวน์โหลดไฟล์จาก commit เดียวกับ version.json ที่อ่าน
  return compareVersions(release.version, currentVersion) > 0 ? { ...release, ref } : null;
}

/** ดาวน์โหลดไฟล์เดียว ลองใหม่สูงสุด 3 ครั้ง (เครือข่ายสะดุด / GitHub ปฏิเสธชั่วคราว) */
async function downloadFile(path, ref) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await request(rawUrl(path, ref), { bustCache: ref === UPDATE_BRANCH });
      return { path, data: await response.blob() };
    } catch (error) {
      lastError = error;
      if (error && error.status === 404) break; // ไม่มีไฟล์จริง ลองใหม่ก็ไม่เจอ
      await new Promise((resolve) => window.setTimeout(resolve, 600 * attempt));
    }
  }
  throw new Error(`ดาวน์โหลดไฟล์ ${path} ไม่สำเร็จ: ${(lastError && lastError.message) || lastError}`);
}

/** ดาวน์โหลดทีละไม่กี่ไฟล์พร้อมกัน (ยิงพร้อมกันทั้งหมดอาจถูก GitHub ปฏิเสธ) */
async function downloadAll(paths, ref, onProgress) {
  const results = new Array(paths.length);
  let nextIndex = 0;
  let doneCount = 0;
  const worker = async () => {
    while (nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await downloadFile(paths[index], ref);
      doneCount += 1;
      onProgress(doneCount, paths.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, paths.length) }, worker));
  return results;
}

/**
 * @param {object} release ผลจาก fetchNewerRelease (มี ref = commit)
 * @param {(text: string) => void} [onStatus] แสดงความคืบหน้า
 */
async function applyUpdate(release, onStatus = () => {}) {
  if (!window.showDirectoryPicker) {
    // เบราว์เซอร์นี้เขียนไฟล์ลงเครื่องเองไม่ได้ → ดาวน์โหลด ZIP ไปแตกทับแทน
    window.open(`https://github.com/${UPDATE_REPO}/archive/refs/heads/${UPDATE_BRANCH}.zip`, "_blank");
    notify("ดาวน์โหลดไฟล์ ZIP แล้วแตกไฟล์ทับโฟลเดอร์โปรแกรมเดิม");
    return;
  }
  const folder = await getAppFolder();
  // โฟลเดอร์พัฒนาโปรแกรม (มี .git) → ห้ามเขียนทับ ไม่เช่นนั้นงานที่ยังไม่ได้ commit จะหาย
  const isGitFolder = await folder.getDirectoryHandle(".git").then(() => true, () => false);
  if (isGitFolder) throw new Error("โฟลเดอร์นี้เป็นโฟลเดอร์พัฒนาโปรแกรม (มี .git) ระบบจะไม่เขียนทับ เพื่อไม่ให้งานที่ยังไม่ได้ commit หาย — ใช้ git pull แทน");
  const files = await listReleaseFiles(release);
  if (!files.length || !files.every(isSafePath)) throw new Error("รายการไฟล์ในเวอร์ชันใหม่ไม่ถูกต้อง");

  // ดาวน์โหลดครบทุกไฟล์ก่อน ถ้าไฟล์ใดล้มเหลวจะไม่เขียนทับอะไรเลย
  const downloads = await downloadAll(files, release.ref || UPDATE_BRANCH, (done, total) => {
    onStatus(`กำลังดาวน์โหลด ${done}/${total}...`);
  });
  // version.json เขียนเป็นไฟล์สุดท้าย: ถ้าเขียนไม่ครบ เวอร์ชันในเครื่องยังเป็นเวอร์ชันเดิม (กดอัปเดตซ้ำได้)
  downloads.sort((left, right) => (left.path === "version.json") - (right.path === "version.json"));
  onStatus("กำลังติดตั้ง...");
  for (const file of downloads) await writeFile(folder, file.path, file.data);

  notifySuccess(`อัปเดตเป็น v${release.version} แล้ว กำลังเปิดโปรแกรมใหม่...`);
  window.setTimeout(() => window.location.reload(), 1200);
}

function reportUpdateError(error, title = "อัปเดตไม่สำเร็จ") {
  console.error(title, error);
  if (error && error.name === "AbortError") notify("ยกเลิกการอัปเดต");
  else if (error instanceof NetworkError) notifyError(`${error.message}\nกรุณาตรวจสอบอินเทอร์เน็ต แล้วลองใหม่อีกครั้ง`, { title });
  else notifyError((error && error.message) || String(error) || "อัปเดตไม่สำเร็จ", { title });
}

/* ------------------------------------------------------------------ */
/* การ์ดแจ้งเตือนเวอร์ชันใหม่ (อยู่จนกว่าจะกดปุ่ม)                            */
/* ------------------------------------------------------------------ */

/** รายละเอียดการอัปเดตจาก "notes" ใน version.json — เป็นข้อความเดียว หรือรายการ (array) ก็ได้ */
function getReleaseNotes(release) {
  const notes = Array.isArray(release.notes) ? release.notes : String(release.notes || "").split(/\n+/);
  return notes.map((note) => String(note).trim()).filter(Boolean);
}

let updateCard = null;

function closeUpdateCard() {
  if (!updateCard) return;
  const card = updateCard;
  updateCard = null;
  card.classList.add("out");
  window.setTimeout(() => card.remove(), 220);
}

/** แสดงการ์ดเวอร์ชันใหม่ พร้อมรายละเอียดและปุ่ม "อัปเดตเลย" */
function showUpdateCard(release) {
  closeUpdateCard();
  const card = document.createElement("div");
  card.className = "toast update-toast";
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-labelledby", "update-toast-title");
  card.innerHTML = `
    <span class="toast-icon" aria-hidden="true">↻</span>
    <div class="update-toast-body">
      <strong id="update-toast-title"></strong>
      <span class="update-toast-current"></span>
      <ul class="update-toast-notes"></ul>
      <div class="update-toast-actions">
        <button type="button" class="secondary small" data-action="later">ไว้ทีหลัง</button>
        <button type="button" class="small" data-action="update">อัปเดตเลย</button>
      </div>
    </div>`;
  // ใช้ textContent: ข้อความมาจาก GitHub ห้ามตีความเป็น HTML
  card.querySelector("#update-toast-title").textContent = `มีเวอร์ชันใหม่ v${release.version}`;
  card.querySelector(".update-toast-current").textContent = `เวอร์ชันปัจจุบัน v${currentVersion}`;
  const notesList = card.querySelector(".update-toast-notes");
  getReleaseNotes(release).forEach((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    notesList.appendChild(item);
  });
  notesList.hidden = !notesList.children.length;

  const updateButton = card.querySelector('[data-action="update"]');
  const laterButton = card.querySelector('[data-action="later"]');
  laterButton.addEventListener("click", closeUpdateCard);
  updateButton.addEventListener("click", async () => {
    if (isBusy) return;
    setBusy(true);
    updateButton.disabled = true;
    laterButton.disabled = true;
    updateButton.textContent = "กำลังอัปเดต...";
    try {
      await applyUpdate(release, (text) => { updateButton.textContent = text; });
      closeUpdateCard();
    } catch (error) {
      updateButton.disabled = false;
      laterButton.disabled = false;
      updateButton.textContent = "อัปเดตเลย";
      reportUpdateError(error);
    } finally {
      setBusy(false);
    }
  });

  let container = document.getElementById("toasts");
  if (!container) {
    container = document.createElement("div");
    container.id = "toasts";
    container.className = "toasts";
    document.body.appendChild(container);
  }
  container.appendChild(card);
  updateCard = card;
  updateButton.focus({ preventScroll: true });
}

async function checkForUpdates() {
  if (isBusy) return;
  setBusy(true);
  try {
    const release = await fetchNewerRelease();
    markUpdateAvailable(release ? release.version : "");
    if (!release) {
      closeUpdateCard();
      notifySuccess(`คุณใช้เวอร์ชันล่าสุดแล้ว (v${currentVersion})`);
      return;
    }
    showUpdateCard(release);
  } catch (error) {
    reportUpdateError(error, "ตรวจสอบการอัปเดตไม่สำเร็จ");
  } finally {
    setBusy(false);
  }
}

/** ตรวจเงียบ ๆ ครั้งเดียวต่อการเปิดโปรแกรม: มีเวอร์ชันใหม่ → แสดงจุดที่ปุ่ม และการ์ดแจ้งเตือนพร้อมปุ่มอัปเดต */
async function autoCheck() {
  try {
    if (sessionStorage.getItem(AUTO_CHECK_KEY)) return;
    sessionStorage.setItem(AUTO_CHECK_KEY, "1");
  } catch {
    // ไม่มี sessionStorage → ตรวจทุกครั้งที่เปิดหน้า
  }
  try {
    const release = await fetchNewerRelease();
    if (!release) return;
    markUpdateAvailable(release.version);
    showUpdateCard(release);
  } catch {
    // ออฟไลน์/ยังไม่ได้ตั้งค่า repository → ไม่รบกวนผู้ใช้
  }
}

currentVersion = await readLocalVersion();
if (versionLabel) versionLabel.textContent = currentVersion ? `v${currentVersion}` : "";
if (checkButton) {
  checkButton.hidden = !currentVersion;
  checkButton.addEventListener("click", checkForUpdates);
}
if (currentVersion && location.protocol !== "file:") autoCheck();

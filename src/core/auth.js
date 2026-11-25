/**
 * @file การเข้าสู่ระบบ / ออกจากระบบ (Firebase Authentication แบบอีเมลและรหัสผ่าน)
 *
 * ทุกหน้า (ยกเว้นหน้าเข้าสู่ระบบ) ต้องมีผู้ใช้ที่ล็อกอินอยู่
 * ถ้าไม่มี จะถูกส่งไปหน้า pages/login/login.html พร้อมพารามิเตอร์ ?next= เพื่อกลับมาหน้าเดิมหลังล็อกอิน
 *
 * วิธีเข้าสู่ระบบที่รองรับ
 * - อีเมล + รหัสผ่าน
 * - ชื่อผู้ใช้ + รหัสผ่าน: Firebase ต้องใช้อีเมล จึงแปลงชื่อผู้ใช้เป็นอีเมลภายใน "<ชื่อผู้ใช้>@accountai.local"
 * - บัญชี Google (หน้าต่าง popup)
 * - บัญชีกลาง "admin": ถ้ายังไม่มีในระบบ จะสร้างให้อัตโนมัติเมื่อกรอกรหัสผ่านที่กำหนดไว้ถูกต้อง
 *
 * เพื่อให้หน้าเปิดได้ทันที ระบบจะจำ uid ของผู้ใช้ล่าสุดไว้ใน localStorage
 * ถ้าเคยล็อกอินบนเครื่องนี้แล้ว หน้าเว็บจะแสดงข้อมูลจากแคชได้เลย ระหว่างที่ Firebase ตรวจสอบสิทธิ์อยู่เบื้องหลัง
 */
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  firebaseAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "./firebase.js";
import { clearCache } from "./local-cache.js";

/** คีย์ใน localStorage ที่เก็บ uid ของผู้ใช้ล่าสุดบนเครื่องนี้ */
const REMEMBERED_USER_KEY = "accounting_user";

/** URL หน้าเข้าสู่ระบบ (คำนวณจากตำแหน่งไฟล์นี้ จึงใช้ได้ทุกหน้า) */
const LOGIN_PAGE_URL = new URL("../../pages/login/login.html", import.meta.url).href;

const isOnLoginPage = () => /\/pages\/login\//.test(location.pathname);

/**
 * อ่าน uid ที่จำไว้
 * @returns {string} สตริงว่างถ้ายังไม่เคยล็อกอินบนเครื่องนี้
 */
export function getRememberedUserId() {
  try {
    return localStorage.getItem(REMEMBERED_USER_KEY) || "";
  } catch {
    return "";
  }
}

/** @param {string} userId สตริงว่าง = ลบค่าที่จำไว้ */
function setRememberedUserId(userId) {
  try {
    if (userId) localStorage.setItem(REMEMBERED_USER_KEY, userId);
    else localStorage.removeItem(REMEMBERED_USER_KEY);
  } catch {
    // localStorage ถูกปิดกั้น: ข้ามได้ ระบบจะรอ Firebase ตรวจสอบทุกครั้งแทน
  }
}

/**
 * จำผู้ใช้ที่ล็อกอิน ถ้าเป็นคนละคนกับคนก่อนหน้า ให้ล้างแคชข้อมูลของคนเดิมทิ้ง
 * @param {{ uid: string }} user
 */
export async function rememberUser(user) {
  if (getRememberedUserId() !== user.uid) await clearCache();
  setRememberedUserId(user.uid);
}

/**
 * ⚠️ ปิดระบบล็อกอินไว้ชั่วคราว: ไม่แสดงหน้าเข้าสู่ระบบ เข้าบัญชีกลาง (admin) ให้อัตโนมัติ
 * (Firestore อนุญาตเฉพาะผู้ใช้ที่ล็อกอินแล้ว จึงยังต้องล็อกอิน แต่ทำให้เองเบื้องหลัง)
 * รหัสผ่านอยู่ในไฟล์ account.passwod ที่โฟลเดอร์โปรแกรม (ไม่ขึ้น GitHub เพราะอยู่ใน .gitignore)
 * ใช้คำสุดท้ายในไฟล์เป็นรหัสผ่าน — เครื่องที่ไม่มีไฟล์นี้จะใช้หน้าล็อกอินตามปกติ
 * เปิดระบบล็อกอินกลับ: เปลี่ยนเป็น false
 */
const AUTO_LOGIN_ENABLED = true;
const PASSWORD_FILE_NAMES = ["account.passwod", "account.password"];

/** อ่านรหัสผ่านจากไฟล์ในโฟลเดอร์โปรแกรม @returns {Promise<string>} */
async function readAutoLoginPassword() {
  for (const fileName of PASSWORD_FILE_NAMES) {
    try {
      const response = await fetch(new URL(`../../${fileName}`, import.meta.url), { cache: "no-store" });
      if (!response.ok) continue;
      const words = (await response.text()).trim().split(/\s+/);
      if (words[words.length - 1]) return words[words.length - 1];
    } catch {
      // ไม่มีไฟล์ → ลองชื่อถัดไป
    }
  }
  return "";
}

/** @returns {Promise<object | null>} ผู้ใช้ที่ล็อกอินอัตโนมัติ หรือ null ถ้าทำไม่ได้ */
async function autoSignIn() {
  if (!AUTO_LOGIN_ENABLED) return null;
  try {
    const password = await readAutoLoginPassword();
    if (!password) return null;
    return await signIn(SHARED_ACCOUNT_USERNAME, password);
  } catch (error) {
    console.warn("ล็อกอินอัตโนมัติไม่สำเร็จ ใช้หน้าเข้าสู่ระบบแทน", error);
    return null;
  }
}

/**
 * Promise ที่ได้ผู้ใช้ปัจจุบัน (หรือ null) เมื่อ Firebase Auth โหลดสถานะเสร็จ
 * ยังไม่ได้ล็อกอิน → ลองล็อกอินอัตโนมัติก่อน (ถ้าเปิดไว้)
 * @type {Promise<import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js").User | null>}
 */
export const authReady = new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
    unsubscribe();
    if (user || isOnLoginPage()) resolve(user);
    else autoSignIn().then(resolve);
  });
});

let isRedirecting = false;

/** ล้างข้อมูลในเครื่องแล้วพาไปหน้าเข้าสู่ระบบ (เรียกซ้ำได้ ทำงานครั้งเดียว) */
export async function redirectToLogin() {
  if (isRedirecting || isOnLoginPage()) return;
  isRedirecting = true;
  setRememberedUserId("");
  await clearCache();
  const returnPath = encodeURIComponent(location.pathname + location.search);
  location.replace(`${LOGIN_PAGE_URL}?next=${returnPath}`);
}

/** แสดงอีเมลผู้ใช้ที่มุมล่างของเมนูด้านข้าง */
function showSignedInEmail(user) {
  const emailElement = document.getElementById("user-email");
  if (emailElement) emailElement.textContent = getUserDisplayName(user);
}

// ติดตามสถานะตลอดอายุหน้า: ถ้าหลุดจากระบบ (เช่น ออกจากระบบจากอีกแท็บ) ให้กลับไปหน้าเข้าสู่ระบบ
onAuthStateChanged(firebaseAuth, (user) => {
  showSignedInEmail(user);
  if (user) return;
  // ปิดระบบล็อกอินไว้: ล็อกอินอัตโนมัติก่อน ทำไม่ได้จึงไปหน้าเข้าสู่ระบบ
  // if (!user) redirectToLogin();
  authReady.then((readyUser) => {
    if (!readyUser && !firebaseAuth.currentUser) redirectToLogin();
  });
});

/* ------------------------------------------------------------------ */
/* ชื่อผู้ใช้ ↔ อีเมล                                                    */
/* ------------------------------------------------------------------ */

/** โดเมนของอีเมลภายในสำหรับผู้ใช้ที่เข้าระบบด้วยชื่อผู้ใช้ (ไม่ใช่อีเมลจริง ส่งอีเมลไม่ได้) */
const USERNAME_EMAIL_DOMAIN = "accountai.local";

/** ชื่อผู้ใช้ที่อนุญาต: a-z 0-9 . _ - ยาว 3-32 ตัว */
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

/** บัญชีกลาง */
export const SHARED_ACCOUNT_USERNAME = "admin";
/**
 * SHA-256 ของรหัสผ่านบัญชีกลาง (เก็บเฉพาะค่าแฮช ไม่เก็บรหัสผ่านตรง ๆ ในโค้ด)
 * ใช้เพียงครั้งแรกเพื่อสร้างบัญชีกลางใน Firebase — หลังจากนั้น Firebase เป็นผู้ตรวจรหัสผ่านเอง
 */
const SHARED_ACCOUNT_PASSWORD_SHA256 = "192b9081a645390641e70e76aaeec24a1c337fa6c03f70515cb7e1197cd17900";

/**
 * แปลงสิ่งที่ผู้ใช้กรอก (อีเมลหรือชื่อผู้ใช้) เป็นอีเมลสำหรับ Firebase
 * @param {string} identifier เช่น "somchai@gmail.com" หรือ "admin"
 * @returns {string}
 */
export function toLoginEmail(identifier) {
  const value = String(identifier || "").trim().toLowerCase();
  if (value.includes("@")) return value;
  if (!USERNAME_PATTERN.test(value)) {
    const error = new Error("ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดล่าง หรือขีด ความยาว 3-32 ตัวอักษร");
    error.code = "app/invalid-username";
    throw error;
  }
  return `${value}@${USERNAME_EMAIL_DOMAIN}`;
}

/**
 * ชื่อสำหรับแสดงผล: ผู้ใช้แบบชื่อผู้ใช้แสดงเฉพาะชื่อ ไม่แสดงโดเมนภายใน
 * @param {{ email?: string | null, displayName?: string | null } | null} user
 */
export function getUserDisplayName(user) {
  if (!user) return "";
  const email = user.email || "";
  if (email.endsWith(`@${USERNAME_EMAIL_DOMAIN}`)) return email.slice(0, -USERNAME_EMAIL_DOMAIN.length - 1);
  return email || user.displayName || "ผู้ใช้";
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* เข้าสู่ระบบ / สมัคร / ลืมรหัสผ่าน                                      */
/* ------------------------------------------------------------------ */

/**
 * เข้าสู่ระบบด้วยอีเมลหรือชื่อผู้ใช้ และรหัสผ่าน
 * @param {string} identifier อีเมล หรือชื่อผู้ใช้
 * @param {string} password
 */
export async function signIn(identifier, password) {
  const email = toLoginEmail(identifier);
  try {
    const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
    await rememberUser(credential.user);
    return credential.user;
  } catch (error) {
    // บัญชีกลางยังไม่เคยถูกสร้าง: สร้างให้ เฉพาะเมื่อรหัสผ่านตรงกับที่กำหนด
    const isSharedAccount = email === toLoginEmail(SHARED_ACCOUNT_USERNAME);
    const mayNotExist = ["auth/invalid-credential", "auth/user-not-found"].includes(error.code);
    if (isSharedAccount && mayNotExist && (await sha256Hex(password)) === SHARED_ACCOUNT_PASSWORD_SHA256) {
      try {
        return await registerUser(SHARED_ACCOUNT_USERNAME, password);
      } catch (createError) {
        // มีบัญชีอยู่แล้ว (รหัสผ่านถูกเปลี่ยนไปแล้ว) → แจ้งข้อผิดพลาดเดิม
        if (createError.code !== "auth/email-already-in-use") throw createError;
      }
    }
    throw error;
  }
}

/** เข้าสู่ระบบด้วยบัญชี Google (เปิดหน้าต่าง popup) */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await signInWithPopup(firebaseAuth, provider);
  await rememberUser(credential.user);
  return credential.user;
}

/**
 * สร้างบัญชีผู้ใช้ใหม่ (ด้วยอีเมลหรือชื่อผู้ใช้) แล้วเข้าสู่ระบบทันที
 * @param {string} identifier อีเมล หรือชื่อผู้ใช้
 * @param {string} password อย่างน้อย 6 ตัวอักษร (ข้อกำหนดของ Firebase)
 */
export async function registerUser(identifier, password) {
  const credential = await createUserWithEmailAndPassword(firebaseAuth, toLoginEmail(identifier), password);
  await rememberUser(credential.user);
  return credential.user;
}

/**
 * ส่งอีเมลลิงก์ตั้งรหัสผ่านใหม่ (ใช้ได้เฉพาะผู้ใช้ที่ลงทะเบียนด้วยอีเมลจริง)
 * @param {string} identifier
 */
export function sendPasswordReset(identifier) {
  const email = toLoginEmail(identifier);
  if (email.endsWith(`@${USERNAME_EMAIL_DOMAIN}`)) {
    const error = new Error("บัญชีแบบชื่อผู้ใช้ไม่มีอีเมลสำหรับรีเซ็ตรหัสผ่าน — ติดต่อผู้ดูแลระบบให้ตั้งรหัสผ่านใหม่ใน Firebase Console");
    error.code = "app/username-reset";
    return Promise.reject(error);
  }
  return sendPasswordResetEmail(firebaseAuth, email);
}

/* ------------------------------------------------------------------ */
/* ยืนยันตัวตนซ้ำก่อนทำงานสำคัญ (เช่น ลบไฟล์ที่นำเข้า)                     */
/* ------------------------------------------------------------------ */

/** ข้อความภาษาไทยเมื่อยืนยันตัวตนไม่ผ่าน */
const VERIFY_ERROR_MESSAGES = {
  "auth/invalid-credential": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
  "auth/wrong-password": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
  "auth/user-mismatch": "ต้องใช้ชื่อผู้ใช้ของบัญชีที่เข้าสู่ระบบอยู่",
  "app/user-mismatch": "ต้องใช้ชื่อผู้ใช้ของบัญชีที่เข้าสู่ระบบอยู่",
  "app/invalid-username": "รูปแบบชื่อผู้ใช้ไม่ถูกต้อง",
  "app/not-signed-in": "ยังไม่ได้เข้าสู่ระบบ",
  "auth/too-many-requests": "ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
  "auth/network-request-failed": "เชื่อมต่ออินเทอร์เน็ตไม่ได้",
};

/** ข้อความภาษาไทยของข้อผิดพลาดจาก verifyCredentials */
export function getVerifyErrorMessage(error) {
  return VERIFY_ERROR_MESSAGES[error?.code] || `ยืนยันตัวตนไม่สำเร็จ: ${error?.message || error}`;
}

/**
 * ตรวจชื่อผู้ใช้ (หรืออีเมล) และรหัสผ่านของผู้ใช้ที่เข้าสู่ระบบอยู่ กับ Firebase (ไม่ออกจากระบบ / ไม่เปลี่ยนผู้ใช้)
 * @param {string} identifier ชื่อผู้ใช้ หรืออีเมล
 * @param {string} password
 * @returns {Promise<void>} ผ่าน = resolve · ไม่ผ่าน = reject (ใช้ getVerifyErrorMessage แปลงเป็นข้อความ)
 */
export async function verifyCredentials(identifier, password) {
  const user = firebaseAuth.currentUser;
  if (!user) throw Object.assign(new Error("not signed in"), { code: "app/not-signed-in" });
  const email = toLoginEmail(identifier);
  if (email !== String(user.email || "").toLowerCase()) {
    throw Object.assign(new Error("user mismatch"), { code: "app/user-mismatch" });
  }
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
}

/** ออกจากระบบ ล้างแคชข้อมูลในเครื่อง แล้วกลับไปหน้าเข้าสู่ระบบ */
export async function logOut() {
  setRememberedUserId("");
  await clearCache();
  await signOut(firebaseAuth);
  location.replace(LOGIN_PAGE_URL);
}

// app-shell.js เป็นสคริปต์ธรรมดา (ไม่ใช่ module) จึงเรียกออกจากระบบผ่าน window
window.AppAuth = { logOut };

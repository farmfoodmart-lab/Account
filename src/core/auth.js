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
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  firebaseAuth,
  onAuthStateChanged,
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
 * Promise ที่ได้ผู้ใช้ปัจจุบัน (หรือ null) เมื่อ Firebase Auth โหลดสถานะเสร็จ
 * @type {Promise<import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js").User | null>}
 */
export const authReady = new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
    unsubscribe();
    resolve(user);
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
  if (!user) redirectToLogin();
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

/** ออกจากระบบ ล้างแคชข้อมูลในเครื่อง แล้วกลับไปหน้าเข้าสู่ระบบ */
export async function logOut() {
  setRememberedUserId("");
  await clearCache();
  await signOut(firebaseAuth);
  location.replace(LOGIN_PAGE_URL);
}

// app-shell.js เป็นสคริปต์ธรรมดา (ไม่ใช่ module) จึงเรียกออกจากระบบผ่าน window
window.AppAuth = { logOut };

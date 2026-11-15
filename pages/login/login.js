/**
 * @file หน้าเข้าสู่ระบบ / สร้างบัญชีผู้ใช้ / ลืมรหัสผ่าน
 *
 * เข้าสู่ระบบได้ด้วย: อีเมล, ชื่อผู้ใช้ (รวมบัญชีกลาง admin) หรือบัญชี Google
 *
 * หลังเข้าสู่ระบบสำเร็จ จะกลับไปหน้าที่ผู้ใช้ตั้งใจเปิด (พารามิเตอร์ ?next=)
 */
import { authReady, registerUser, sendPasswordReset, signIn, signInWithGoogle } from "../../src/core/auth.js";
import { notifyError, notifySuccess } from "../../src/components/notifications.js";
import { byId } from "../../src/utils/dom.js";

const loginForm = byId("login-form");
const errorElement = byId("login-error");
const helpBanner = byId("login-help");

/** true = กำลังอยู่ในโหมดสร้างบัญชีผู้ใช้ใหม่ */
let isRegisterMode = false;

/** ข้อความภาษาไทยของรหัสข้อผิดพลาดจาก Firebase Auth */
const AUTH_ERROR_MESSAGES = {
  "auth/invalid-credential": "อีเมล/ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง",
  "auth/wrong-password": "อีเมล/ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง",
  "auth/user-not-found": "ไม่พบผู้ใช้นี้ — กด “สร้างบัญชีผู้ใช้” หากยังไม่เคยลงทะเบียน",
  "auth/invalid-email": "รูปแบบอีเมลไม่ถูกต้อง",
  "auth/email-already-in-use": "อีเมล/ชื่อผู้ใช้นี้ลงทะเบียนแล้ว — กลับไปเข้าสู่ระบบ",
  "auth/popup-closed-by-user": "ปิดหน้าต่าง Google ก่อนเข้าสู่ระบบเสร็จ",
  "auth/popup-blocked": "เบราว์เซอร์บล็อกหน้าต่าง popup — อนุญาต popup สำหรับเว็บนี้แล้วลองอีกครั้ง",
  "auth/unauthorized-domain": "โดเมนนี้ยังไม่ได้รับอนุญาตให้ใช้ Google — เพิ่มใน Firebase Console → Authentication → Settings → Authorized domains",
  "auth/weak-password": "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร",
  "auth/too-many-requests": "พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่",
  "auth/network-request-failed": "เชื่อมต่ออินเทอร์เน็ตไม่ได้",
};

/** รหัสข้อผิดพลาดที่หมายถึง "ยังไม่ได้เปิดใช้ Email/Password ใน Firebase Console" */
const PROVIDER_DISABLED_CODES = ["auth/operation-not-allowed", "auth/configuration-not-found"];

/**
 * หน้าที่จะไปหลังเข้าสู่ระบบ
 * รับเฉพาะ path ภายในแอป (กันการส่งผู้ใช้ไปเว็บอื่นผ่านพารามิเตอร์ next)
 * @returns {string}
 */
function getReturnUrl() {
  const requestedPath = new URLSearchParams(location.search).get("next") || "";
  const isSafeAppPath = /^\/[^/]/.test(requestedPath) && requestedPath.includes("/pages/") && !requestedPath.includes("/login/");
  return isSafeAppPath ? requestedPath : "../dashboard/dashboard.html";
}

/**
 * แสดงข้อผิดพลาดเป็นป๊อปอัป
 * @param {Error & { code?: string }} error
 * @param {"password" | "google"} [method="password"] วิธีที่ใช้เข้าสู่ระบบ (บอกผู้ใช้ว่าต้องเปิดผู้ให้บริการใดใน Firebase)
 */
function showAuthError(error, method = "password") {
  const errorCode = error && error.code;
  errorElement.textContent = "";
  if (PROVIDER_DISABLED_CODES.includes(errorCode)) {
    const providerName = method === "google" ? "Google" : "Email/Password";
    helpBanner.hidden = false;
    helpBanner.innerHTML = `ผู้ดูแลระบบต้องเปิดใช้งานก่อน: Firebase Console → Authentication → Sign-in method → เปิด <strong>${providerName}</strong>`;
    notifyError(`ยังไม่ได้เปิดใช้การเข้าสู่ระบบแบบ ${providerName} ใน Firebase`, { title: "เข้าสู่ระบบไม่สำเร็จ" });
    return;
  }
  // ข้อผิดพลาดที่ระบบสร้างเอง (app/...) มีข้อความภาษาไทยอยู่แล้ว
  const message = AUTH_ERROR_MESSAGES[errorCode]
    || (String(errorCode).startsWith("app/") ? error.message : `เข้าสู่ระบบไม่สำเร็จ: ${(error && error.message) || error}`);
  notifyError(message, { title: "เข้าสู่ระบบไม่สำเร็จ" });
}

/** สลับระหว่างโหมด "เข้าสู่ระบบ" กับ "สร้างบัญชีผู้ใช้" */
function setRegisterMode(enabled) {
  isRegisterMode = enabled;
  byId("login-title").textContent = enabled ? "สร้างบัญชีผู้ใช้" : "เข้าสู่ระบบ";
  byId("login-sub").textContent = enabled
    ? "ใช้อีเมล หรือตั้งชื่อผู้ใช้ (a-z, 0-9) และรหัสผ่านอย่างน้อย 6 ตัวอักษร"
    : "ใช้อีเมลหรือชื่อผู้ใช้ และรหัสผ่านที่ลงทะเบียนไว้";
  byId("login-submit").textContent = enabled ? "สร้างบัญชีและเข้าสู่ระบบ" : "เข้าสู่ระบบ";
  byId("login-toggle").textContent = enabled ? "มีบัญชีแล้ว? เข้าสู่ระบบ" : "ยังไม่มีบัญชี? สร้างบัญชีผู้ใช้";
  byId("login-password").autocomplete = enabled ? "new-password" : "current-password";
  errorElement.textContent = "";
}

async function handlePasswordReset() {
  const identifier = byId("login-email").value.trim();
  if (!identifier) {
    await notifyError("กรอกอีเมลก่อน แล้วกด “ลืมรหัสผ่าน” อีกครั้ง");
    byId("login-email").focus();
    return;
  }
  try {
    await sendPasswordReset(identifier);
    errorElement.textContent = "";
    notifySuccess("ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว");
  } catch (error) {
    showAuthError(error);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  errorElement.textContent = "";
  const submitButton = byId("login-submit");
  submitButton.disabled = true;
  try {
    const identifier = byId("login-email").value.trim(); // อีเมลหรือชื่อผู้ใช้
    const password = byId("login-password").value;
    if (isRegisterMode) await registerUser(identifier, password);
    else await signIn(identifier, password);
    location.replace(getReturnUrl());
  } catch (error) {
    showAuthError(error);
  } finally {
    submitButton.disabled = false;
  }
}

async function handleGoogleSignIn() {
  const googleButton = byId("login-google");
  googleButton.disabled = true;
  try {
    await signInWithGoogle();
    location.replace(getReturnUrl());
  } catch (error) {
    showAuthError(error, "google");
  } finally {
    googleButton.disabled = false;
  }
}

byId("login-toggle").addEventListener("click", () => setRegisterMode(!isRegisterMode));
byId("login-google").addEventListener("click", handleGoogleSignIn);
byId("login-reset").addEventListener("click", handlePasswordReset);
loginForm.addEventListener("submit", handleSubmit);

// เปิดหน้านี้ทั้งที่ล็อกอินอยู่แล้ว: ไปหน้าถัดไปทันที
const currentUser = await authReady;
if (currentUser) location.replace(getReturnUrl());
else byId("login-email").focus();

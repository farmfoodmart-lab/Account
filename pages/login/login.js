import { authReady, register, resetPassword, signIn } from "../../js/data.js";
import { toastSuccess } from "../../js/ui.js";

const $ = (id) => document.getElementById(id);
const form = $("login-form");
const errorElement = $("login-error");
const help = $("login-help");
let registerMode = false;

function nextUrl() {
  const next = new URLSearchParams(location.search).get("next") || "";
  // Only allow same-site paths inside this app.
  return /^\/[^/]/.test(next) && next.includes("/pages/") && !next.includes("/login/") ? next : "../dashboard/dashboard.html";
}

const MESSAGES = {
  "auth/invalid-credential": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  "auth/wrong-password": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  "auth/user-not-found": "ไม่พบผู้ใช้นี้ — กด “สร้างบัญชีผู้ใช้” หากยังไม่เคยลงทะเบียน",
  "auth/invalid-email": "รูปแบบอีเมลไม่ถูกต้อง",
  "auth/email-already-in-use": "อีเมลนี้ลงทะเบียนแล้ว — กลับไปเข้าสู่ระบบ",
  "auth/weak-password": "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร",
  "auth/too-many-requests": "พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่",
  "auth/network-request-failed": "เชื่อมต่ออินเทอร์เน็ตไม่ได้",
};

function showError(error) {
  const code = error && error.code;
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") {
    errorElement.textContent = "ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วยอีเมลใน Firebase";
    help.hidden = false;
    help.innerHTML = 'ผู้ดูแลระบบต้องเปิดใช้งานก่อน: Firebase Console → Authentication → Sign-in method → เปิด <strong>Email/Password</strong> แล้วกลับมาสร้างบัญชีผู้ใช้ที่หน้านี้';
    return;
  }
  errorElement.textContent = MESSAGES[code] || `เข้าสู่ระบบไม่สำเร็จ: ${(error && error.message) || error}`;
}

function setMode(isRegister) {
  registerMode = isRegister;
  $("login-title").textContent = isRegister ? "สร้างบัญชีผู้ใช้" : "เข้าสู่ระบบ";
  $("login-sub").textContent = isRegister ? "ตั้งรหัสผ่านอย่างน้อย 6 ตัวอักษร" : "ใช้อีเมลและรหัสผ่านที่ลงทะเบียนไว้";
  $("login-submit").textContent = isRegister ? "สร้างบัญชีและเข้าสู่ระบบ" : "เข้าสู่ระบบ";
  $("login-toggle").textContent = isRegister ? "มีบัญชีแล้ว? เข้าสู่ระบบ" : "ยังไม่มีบัญชี? สร้างบัญชีผู้ใช้";
  $("login-password").autocomplete = isRegister ? "new-password" : "current-password";
  errorElement.textContent = "";
}

$("login-toggle").addEventListener("click", () => setMode(!registerMode));

$("login-reset").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  if (!email) {
    errorElement.textContent = "กรอกอีเมลก่อน แล้วกด “ลืมรหัสผ่าน” อีกครั้ง";
    $("login-email").focus();
    return;
  }
  try {
    await resetPassword(email);
    errorElement.textContent = "";
    toastSuccess("ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว");
  } catch (error) {
    showError(error);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorElement.textContent = "";
  const button = $("login-submit");
  button.disabled = true;
  try {
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (registerMode) await register(email, password);
    else await signIn(email, password);
    location.replace(nextUrl());
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
});

// Already signed in (e.g. opened the login page directly): go straight in.
const user = await authReady;
if (user) location.replace(nextUrl());
else $("login-email").focus();

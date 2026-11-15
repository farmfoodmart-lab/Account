/**
 * @file เชื่อมต่อ Firebase (Firestore + Authentication)
 *
 * เป็นไฟล์เดียวที่ import SDK ของ Firebase จาก CDN
 * ไฟล์อื่นต้อง import ฟังก์ชันของ Firebase ผ่านไฟล์นี้เท่านั้น
 * ทำให้เปลี่ยนเวอร์ชัน SDK หรือสลับไปใช้ระบบจำลอง (สำหรับทดสอบ) ได้ในที่เดียว
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  deleteDoc,
  doc,
  getDoc,
  initializeFirestore,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

/**
 * ค่าการเชื่อมต่อโปรเจกต์ Firebase
 * (ค่าเหล่านี้เปิดเผยได้ตามปกติของเว็บแอป ความปลอดภัยของข้อมูลอยู่ที่ firestore.rules)
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAGZ92GWjcTGUt4m8RxX978iqVgrYbaafs",
  authDomain: "accountai-3e294.firebaseapp.com",
  projectId: "accountai-3e294",
  storageBucket: "accountai-3e294.firebasestorage.app",
  messagingSenderId: "170552461513",
  appId: "1:170552461513:web:a36a202aaae7694f836518",
  measurementId: "G-R2K48SX86X",
};

const firebaseApp = initializeApp(FIREBASE_CONFIG);

/**
 * ฐานข้อมูล Firestore
 * ignoreUndefinedProperties: ข้ามฟิลด์ที่เป็น undefined แทนการโยนข้อผิดพลาดตอนบันทึก
 */
export const firestore = initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true });

/** ระบบยืนยันตัวตน */
export const firebaseAuth = getAuth(firebaseApp);

/** ชื่อ collection ใน Firestore ที่เก็บข้อมูลบัญชีทั้งหมด */
const ACCOUNTING_COLLECTION = "accounting";

/**
 * อ้างอิงเอกสารใน collection "accounting"
 * @param {string} documentId เช่น "entries", "entries_0", "meta"
 */
export function accountingDocument(documentId) {
  return doc(firestore, ACCOUNTING_COLLECTION, documentId);
}

/**
 * ชุดการเขียนที่ส่งไปพร้อมกันครั้งเดียว และสำเร็จ/ล้มเหลวพร้อมกันทั้งหมด (atomic)
 * @returns {import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js").WriteBatch}
 */
export function createWriteBatch() {
  return writeBatch(firestore);
}

// ส่งต่อฟังก์ชันของ SDK ที่ไฟล์อื่นต้องใช้
export {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteDoc,
  getDoc,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setDoc,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
};

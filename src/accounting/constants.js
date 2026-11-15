/**
 * @file ค่าคงที่ทางบัญชีที่ใช้ร่วมกันทั้งระบบ
 */

/**
 * ยอดเงินที่น้อยกว่าค่านี้ถือว่าเป็นศูนย์
 * ใช้เปรียบเทียบเดบิต/เครดิต เพราะเลขทศนิยมของ JavaScript อาจคลาดเคลื่อนเล็กน้อย (เช่น 0.1 + 0.2)
 */
export const AMOUNT_EPSILON = 0.005;

/** ชื่อหมวดบัญชีภาษาไทย ตามประเภทที่เก็บในข้อมูล */
export const ACCOUNT_TYPE_LABELS = {
  asset: "สินทรัพย์",
  liability: "หนี้สิน",
  equity: "ทุน",
  revenue: "รายได้",
  expense: "ค่าใช้จ่าย",
};

/** ลำดับการแสดงหมวดบัญชี (ตามลำดับในงบการเงิน) */
export const ACCOUNT_TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];

/**
 * ประเภทของรายการในสมุดรายวัน
 * - general   รายการทั่วไป
 * - adjusting รายการปรับปรุง → แสดงในช่อง "ปรับปรุง" ของกระดาษทำการ
 * - closing   รายการปิดบัญชี → ไม่นำไปคำนวณในงบกำไรขาดทุน
 */
export const ENTRY_KIND_LABELS = {
  general: "ทั่วไป",
  adjusting: "ปรับปรุง",
  closing: "ปิดบัญชี",
};

/**
 * บทบาทของบัญชีที่ใช้ในการลงบัญชีอัตโนมัติ
 * ผู้ใช้กำหนดบัญชีเองได้ที่หน้าการตั้งค่า ถ้าไม่กำหนด ระบบจะหาจากรหัส (codes) แล้วจากชื่อ (names) ตามลำดับ
 */
export const ACCOUNT_ROLES = {
  cash: { label: "เงินสด / เงินฝาก (รับ-จ่ายเงิน)", type: "asset", codes: ["1101", "1102"], names: ["เงินสด", "เงินฝาก"] },
  receivable: { label: "ลูกหนี้การค้า", type: "asset", codes: ["1103"], names: ["ลูกหนี้"] },
  payable: { label: "เจ้าหนี้การค้า", type: "liability", codes: ["2101"], names: ["เจ้าหนี้"] },
  revenue: { label: "รายได้ (ค่าเริ่มต้นเมื่อตั้งลูกหนี้)", type: "revenue", codes: ["4101"], names: ["รายได้"] },
  expense: { label: "ค่าใช้จ่าย/ซื้อ (ค่าเริ่มต้นเมื่อตั้งเจ้าหนี้)", type: "expense", codes: ["5101", "5206"], names: ["ต้นทุน", "ค่าใช้จ่าย"] },
  costOfSales: { label: "ต้นทุนขาย", type: "expense", codes: ["5101"], names: ["ต้นทุนขาย"] },
  inventory: { label: "สินค้าคงเหลือ (มูลค่าสินค้า)", type: "asset", codes: ["1104"], names: ["สินค้าคงเหลือ", "มูลค่าสินค้า"] },
  vatOutput: { label: "ภาษีขาย", type: "liability", codes: ["2103"], names: ["ภาษีขาย"] },
  vatInput: { label: "ภาษีซื้อ", type: "asset", codes: ["1107"], names: ["ภาษีซื้อ"] },
  retained: { label: "กำไรสะสม (ใช้ตอนปิดบัญชี)", type: "equity", codes: ["3201"], names: ["กำไรสะสม"] },
};

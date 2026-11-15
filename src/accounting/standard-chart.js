/**
 * @file ผังบัญชีมาตรฐานสำหรับธุรกิจขนาดเล็ก (SME) ในประเทศไทย
 *
 * ใช้กับปุ่ม "เพิ่มผังบัญชีมาตรฐาน" ในหน้าผังบัญชี — ระบบจะเพิ่มเฉพาะรหัสที่ยังไม่มี
 * รหัสบางตัวถูกใช้เป็นค่าเริ่มต้นของการลงบัญชีอัตโนมัติ (ดู ACCOUNT_ROLES ใน constants.js)
 *
 * หลักการตั้งรหัส: หลักแรกบอกหมวด
 *   1 = สินทรัพย์  2 = หนี้สิน  3 = ส่วนของเจ้าของ  4 = รายได้  5 = ค่าใช้จ่าย
 */

/** @type {ReadonlyArray<{ code: string, name: string, type: string }>} */
export const STANDARD_CHART_OF_ACCOUNTS = Object.freeze([
  { code: "1101", name: "เงินสด", type: "asset" },
  { code: "1102", name: "เงินฝากธนาคาร", type: "asset" },
  { code: "1103", name: "ลูกหนี้การค้า", type: "asset" },
  { code: "1104", name: "สินค้าคงเหลือ", type: "asset" },
  { code: "1105", name: "วัสดุสิ้นเปลือง", type: "asset" },
  { code: "1106", name: "ค่าใช้จ่ายจ่ายล่วงหน้า", type: "asset" },
  { code: "1107", name: "ภาษีซื้อ", type: "asset" },
  { code: "1201", name: "อุปกรณ์สำนักงาน", type: "asset" },
  { code: "1202", name: "ค่าเสื่อมราคาสะสม - อุปกรณ์สำนักงาน", type: "asset" },
  { code: "2101", name: "เจ้าหนี้การค้า", type: "liability" },
  { code: "2102", name: "ค่าใช้จ่ายค้างจ่าย", type: "liability" },
  { code: "2103", name: "ภาษีขาย", type: "liability" },
  { code: "2104", name: "ภาษีหัก ณ ที่จ่ายค้างจ่าย", type: "liability" },
  { code: "2201", name: "เงินกู้ยืมระยะยาว", type: "liability" },
  { code: "3101", name: "ทุน", type: "equity" },
  { code: "3102", name: "ถอนใช้ส่วนตัว", type: "equity" },
  { code: "3201", name: "กำไรสะสม", type: "equity" },
  { code: "4101", name: "รายได้จากการขาย", type: "revenue" },
  { code: "4102", name: "รายได้ค่าบริการ", type: "revenue" },
  { code: "4201", name: "รายได้อื่น", type: "revenue" },
  { code: "5101", name: "ต้นทุนขาย", type: "expense" },
  { code: "5201", name: "เงินเดือนและค่าจ้าง", type: "expense" },
  { code: "5202", name: "ค่าเช่า", type: "expense" },
  { code: "5203", name: "ค่าสาธารณูปโภค", type: "expense" },
  { code: "5204", name: "ค่าเสื่อมราคา", type: "expense" },
  { code: "5205", name: "ค่าธรรมเนียมธนาคาร", type: "expense" },
  { code: "5206", name: "ค่าใช้จ่ายเบ็ดเตล็ด", type: "expense" },
]);

/** หลักแรกของรหัสบัญชีที่แนะนำ ตามหมวด */
export const ACCOUNT_CODE_PREFIX = Object.freeze({
  asset: "1",
  liability: "2",
  equity: "3",
  revenue: "4",
  expense: "5",
});

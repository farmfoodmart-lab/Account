/**
 * @file ช่องทางการชำระเงินให้ซัพพลายเออร์ และรายชื่อธนาคาร (ใช้ร่วมกันหน้ารายชื่อซัพพลายเออร์และหน้าตั้งค่า)
 */

/** ช่องทางการชำระเงิน (ค่า value เก็บในฐานข้อมูล ห้ามเปลี่ยน) */
export const PAYMENT_METHODS = [
  { value: "", label: "ไม่ระบุ" },
  { value: "transfer", label: "โอนเข้าบัญชีธนาคาร" },
  { value: "promptpay", label: "พร้อมเพย์" },
  { value: "cheque", label: "เช็ค" },
  { value: "cash", label: "เงินสด" },
];

export const PAYMENT_METHOD_LABELS = Object.fromEntries(PAYMENT_METHODS.map((method) => [method.value, method.label]));

/** ช่องทางที่ใช้เลขบัญชี */
export const ACCOUNT_PAYMENT_METHODS = new Set(["transfer", "promptpay"]);

/** รายชื่อธนาคารให้เลือก */
export const THAI_BANKS = ["กสิกรไทย", "ไทยพาณิชย์", "กรุงเทพ", "กรุงไทย", "กรุงศรีอยุธยา", "ทหารไทยธนชาต (ttb)", "ออมสิน",
  "ธ.ก.ส.", "ยูโอบี", "ซีไอเอ็มบี ไทย", "แลนด์ แอนด์ เฮ้าส์", "เกียรตินาคินภัทร", "ทิสโก้", "อาคารสงเคราะห์"];

/** ค่าเริ่มต้นเมื่อยังไม่เคยตั้งในหน้าตั้งค่า */
export const DEFAULT_SUPPLIER_PAYMENT = { paymentMethod: "transfer", bankName: "ออมสิน" };

/**
 * ช่องทางชำระเงินเริ่มต้นของซัพพลายเออร์ใหม่ ตามหน้าตั้งค่า
 * @param {{ supplierPaymentMethod?: string, supplierBankName?: string }} settings
 * @returns {{ paymentMethod: string, bankName: string }}
 */
export function getDefaultSupplierPayment(settings = {}) {
  const paymentMethod = settings.supplierPaymentMethod ?? DEFAULT_SUPPLIER_PAYMENT.paymentMethod;
  const bankName = paymentMethod === "transfer" ? (settings.supplierBankName ?? DEFAULT_SUPPLIER_PAYMENT.bankName) : "";
  return { paymentMethod, bankName };
}

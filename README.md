# ระบบบัญชีคู่ (Double-entry Accounting)

เว็บแอประบบบัญชีคู่สำหรับธุรกิจขนาดเล็ก เขียนด้วย HTML/CSS/JavaScript ล้วน (ES Modules) ไม่ต้อง build
ข้อมูลเก็บใน Firebase Firestore และเข้าสู่ระบบด้วย Firebase Authentication

## การเปิดใช้งาน

ต้องเปิดผ่าน web server (เปิดไฟล์ตรง ๆ แบบ `file://` ไม่ได้ เพราะใช้ ES Modules) เช่น
VS Code Live Server หรือ `npx serve .` แล้วเปิด `Accounting.html`

ก่อนใช้งานจริงครั้งแรก:
1. Firebase Console → Authentication → Sign-in method → เปิด **Email/Password** และ **Google**
2. แก้อีเมลใน [`firestore.rules`](firestore.rules) แล้ว Publish ที่ Firestore → Rules

## โครงสร้างโฟลเดอร์

```
Accounting.html             หน้าแรก (พาไปแดชบอร์ด)
firestore.rules             กฎความปลอดภัยของ Firestore
pages/                      หน้าเว็บ หนึ่งโฟลเดอร์ต่อหนึ่งหน้า: <ชื่อ>/<ชื่อ>.html + <ชื่อ>.js
src/
  core/                     โครงสร้างพื้นฐาน (ไม่มีความรู้เรื่องบัญชี)
    firebase.js             เชื่อมต่อ Firebase — ไฟล์เดียวที่ import SDK จาก CDN
    auth.js                 เข้าสู่ระบบ (อีเมล / ชื่อผู้ใช้ / Google / บัญชีกลาง admin)
    store.js                state กลาง, loadData / saveData / commitChanges, ซิงก์และแคช
    local-cache.js          แคชข้อมูลในเครื่อง (IndexedDB) เพื่อเปิดหน้าได้ทันที
  accounting/               กฎและการคำนวณทางบัญชี
    constants.js            ค่าคงที่: หมวดบัญชี ประเภทรายการ บทบาทบัญชี
    rules.js                กฎพื้นฐาน (ด้านปกติของบัญชี ประเภทรายการ)
    accounts.js             ผังบัญชี: ค้นหา เรียง แสดงผล ยอดคงเหลือ
    customers.js            ลูกค้าและช่องเลือกลูกค้า
    journal.js              เลขที่เอกสาร และการล็อกงวด
    statements.js           งบทดลอง งบกำไรขาดทุน งบดุล อายุหนี้ (ฟังก์ชันบริสุทธิ์)
    posting.js              สร้างรายการรับ/จ่ายชำระ และรายการในสมุดรายวันอัตโนมัติ
    subledger.js            ทะเบียนลูกหนี้/เจ้าหนี้ ที่สร้างจากสมุดรายวัน (จับคู่การชำระ)
    closing.js              รายการปิดบัญชีสิ้นงวด
    standard-chart.js       ผังบัญชีมาตรฐาน SME
  components/               ส่วนติดต่อผู้ใช้ที่ใช้ซ้ำหลายหน้า
    app-shell.js            เมนูด้านข้าง กล่องค้นหาคำสั่ง ตัวกรองตาราง (สคริปต์ธรรมดา)
    theme.js                ธีมสว่าง/มืด (สคริปต์ธรรมดา โหลดใน <head>)
    notifications.js   ป๊อปอัปแจ้งเตือน
    dialogs.js              กล่องยืนยัน และกล่องฟอร์ม
    imported-file-list.js   ตารางไฟล์ที่นำเข้า
    subledger-page.js       หน้าทะเบียนลูกหนี้/เจ้าหนี้ (ใช้ร่วมกัน)
  utils/                    ฟังก์ชันทั่วไป ไม่ขึ้นกับระบบบัญชี
    format.js  date.js  csv.js  download.js  dom.js  id.js  timing.js
  styles/
    main.css                สไตล์ทั้งระบบ (ไฟล์เดียว)
```

ทิศทางการ import: `pages → components → accounting → core → utils`
(ไฟล์ชั้นล่างห้าม import ไฟล์ชั้นบน เช่น `utils/` ห้าม import จาก `accounting/`)
ข้อยกเว้นเดียว: `core/store.js` ใช้ `components/notifications.js` เพื่อแจ้งสถานะการซิงก์ — ทำได้เพราะ `notifications.js` ไม่ import ไฟล์ใดเลย

## ข้อตกลงการเขียนโค้ด

| สิ่งที่ตั้งชื่อ | รูปแบบ | ตัวอย่าง |
| --- | --- | --- |
| ไฟล์และโฟลเดอร์ | kebab-case | `local-cache.js`, `subledger-page.js` |
| ฟังก์ชัน ตัวแปร พารามิเตอร์ | camelCase คำเต็ม ขึ้นต้นด้วยคำกริยาสำหรับฟังก์ชัน | `calculateNetBalance`, `renderEntryList`, `isDateLocked` |
| ค่าคงที่ | UPPER_SNAKE_CASE | `AMOUNT_EPSILON`, `ACCOUNT_TYPE_LABELS` |
| ค่า boolean | ขึ้นต้นด้วย `is` / `has` / `should` | `isBalanced`, `hasUnsavedChanges` |
| คลาส CSS และ id ใน HTML | kebab-case คำเต็ม | `.journal-line`, `#subledger-form` |

คำกริยาที่ใช้: `render…` = สร้าง HTML, `calculate…` / `build…` = คำนวณ (ไม่แตะ DOM),
`find…` = ค้นหา, `format…` = แปลงเป็นข้อความแสดงผล, `handle…` = รับอีเวนต์

- หลีกเลี่ยงคำย่อ (`fmt`, `esc`, `cfg`, `$`) และชื่อตัวแปรตัวเดียว (`a`, `b`)
- ทุกไฟล์มีคำอธิบาย `@file` และทุกฟังก์ชันที่ export มี JSDoc เป็นภาษาไทย
- ข้อมูลจากผู้ใช้ที่ใส่ใน `innerHTML` ต้องผ่าน `escapeHtml()` เสมอ
- แก้ไขข้อมูลด้วย `commitChanges({ ชุดข้อมูล: ค่าใหม่ })` (ถ้าบันทึกไม่สำเร็จ state จะคืนค่าเดิมให้เอง)
  ห้ามแก้ `state` โดยตรง (เช่น `state.entries.push(...)`)

### ชื่อที่ห้ามเปลี่ยน (บันทึกในฐานข้อมูลแล้ว)

ชื่อฟิลด์ใน Firestore เช่น `docNo`, `desc`, `autoDesc`, `customerNames`, `incomingDocs`,
`importFiles`, `tax`, ชื่อเอกสาร `revs` / `meta` / `main` และชื่อแคช IndexedDB (`accounting-cache` / `kv`)
ถ้าเปลี่ยนชื่อ ระบบจะอ่านข้อมูลเดิมไม่ได้ — ต้องเขียนโค้ดย้ายข้อมูล (migration) ก่อน

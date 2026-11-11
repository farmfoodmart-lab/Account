import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAGZ92GWjcTGUt4m8RxX978iqVgrYbaafs",
  authDomain: "accountai-3e294.firebaseapp.com",
  projectId: "accountai-3e294",
  storageBucket: "accountai-3e294.firebasestorage.app",
  messagingSenderId: "170552461513",
  appId: "1:170552461513:web:a36a202aaae7694f836518",
  measurementId: "G-R2K48SX86X"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const DOC_MAIN = doc(db, "accounting", "main");
const DATA_KEYS = ["accounts","entries","customers","receivables","autoDesc","customerNames","customerCosts","incomingDocs"];
const DATA_REFS = Object.fromEntries(DATA_KEYS.map(k => [k, doc(db, "accounting", k)]));
const META_REF = doc(db, "accounting", "meta");
const CHUNK_SIZE = 700000; // chars, keep under Firestore 1MB doc limit

const TYPES = {
  asset: 'สินทรัพย์', liability: 'หนี้สิน', equity: 'ทุน', revenue: 'รายได้', expense: 'ค่าใช้จ่าย'
};
const normalDebit = (t) => t === 'asset' || t === 'expense';

const defaultState = () => ({
  accounts: [], entries: [], customers: [], receivables: [], autoDesc: [],
  customerNames: [], customerCosts: [], incomingDocs: [], importFiles: [],
  settings: { company: '', periodStart: '', periodEnd: '', currency: 'THB', note: '' }
});
let state = defaultState();
let ready = false;
let chunkCounts = Object.fromEntries(DATA_KEYS.map(k => [k, 0]));

function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

function arr(v) { return Array.isArray(v) ? v : []; }
function normalizeState(d) {
  return {
    accounts: arr(d.accounts), entries: arr(d.entries), customers: arr(d.customers),
    receivables: arr(d.receivables), autoDesc: arr(d.autoDesc),
    customerNames: arr(d.customerNames), customerCosts: arr(d.customerCosts),
    incomingDocs: arr(d.incomingDocs), importFiles: arr(d.importFiles),
    settings: Object.assign(defaultState().settings, d.settings || {})
  };
}

function splitBySize(items) {
  const chunks = [];
  let cur = [];
  let size = 2; // []
  for (const item of items) {
    const s = JSON.stringify(item);
    const add = s.length + (cur.length ? 1 : 0);
    if (cur.length && size + add > CHUNK_SIZE) {
      chunks.push(cur);
      cur = [item];
      size = 2 + s.length;
    } else {
      cur.push(item);
      size += add;
    }
  }
  chunks.push(cur);
  return chunks.length ? chunks : [[]];
}

async function loadArray(key) {
  const snap = await getDoc(DATA_REFS[key]);
  if (!snap.exists()) return { items: [], chunks: 0, existed: false };
  const d = snap.data() || {};
  if (Array.isArray(d.items)) return { items: d.items, chunks: 0, existed: true };
  const n = Number(d.chunks) || 0;
  if (n > 0) {
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => getDoc(doc(db, "accounting", `${key}_${i}`))));
    const items = [];
    parts.forEach(p => { if (p.exists()) { const pd = p.data() || {}; if (Array.isArray(pd.items)) items.push(...pd.items); } });
    return { items, chunks: n, existed: true };
  }
  return { items: [], chunks: 0, existed: true };
}

async function saveArray(key, items) {
  const chunks = splitBySize(items);
  const old = chunkCounts[key] || 0;
  const ops = [];
  if (chunks.length <= 1) {
    ops.push(setDoc(DATA_REFS[key], { items: chunks[0] || [] }));
    for (let i = 0; i < old; i++) ops.push(deleteDoc(doc(db, "accounting", `${key}_${i}`)));
  } else {
    ops.push(setDoc(DATA_REFS[key], { chunks: chunks.length }));
    chunks.forEach((ch, i) => ops.push(setDoc(doc(db, "accounting", `${key}_${i}`), { items: ch })));
    for (let i = chunks.length; i < old; i++) ops.push(deleteDoc(doc(db, "accounting", `${key}_${i}`)));
  }
  await Promise.all(ops);
  chunkCounts[key] = chunks.length <= 1 ? 0 : chunks.length;
}

async function load() {
  try {
    setStatus('กำลังโหลดข้อมูลจาก Firebase...');
    const results = await Promise.all([...DATA_KEYS.map(k => loadArray(k)), getDoc(META_REF), getDoc(DOC_MAIN)]);
    const metaSnap = results[DATA_KEYS.length];
    const mainSnap = results[DATA_KEYS.length + 1];
    const hasSplit = results.slice(0, DATA_KEYS.length).some(r => r.existed) || metaSnap.exists();
    if (hasSplit) {
      const m = metaSnap.exists() ? (metaSnap.data() || {}) : {};
      const d = {};
      DATA_KEYS.forEach((k, i) => { d[k] = results[i].items; chunkCounts[k] = results[i].chunks; });
      d.importFiles = m.importFiles; d.settings = m.settings;
      state = normalizeState(d);
    } else if (mainSnap.exists()) {
      state = normalizeState(mainSnap.data() || {});
      try {
        await Promise.all([...DATA_KEYS.map(k => saveArray(k, state[k])), setDoc(META_REF, { importFiles: state.importFiles, settings: state.settings })]);
      } catch (migErr) { console.warn('migration to split/chunked docs failed', migErr); }
    } else {
      state = defaultState();
      chunkCounts = Object.fromEntries(DATA_KEYS.map(k => [k, 0]));
    }
    ready = true;
    setStatus('เชื่อมต่อ Firebase แล้ว');
  } catch (e) {
    console.error(e);
    setStatus('เชื่อมต่อ Firebase ไม่สำเร็จ: ' + (e.message || e), true);
  }
}

async function save() {
  if (!ready) { alert('ยังไม่พร้อมบันทึกข้อมูล'); return false; }
  try {
    setStatus('กำลังบันทึก...');
    await Promise.all([...DATA_KEYS.map(k => saveArray(k, state[k])), setDoc(META_REF, { importFiles: state.importFiles, settings: state.settings })]);
    setStatus('บันทึกแล้ว');
    return true;
  } catch (e) {
    console.error(e);
    setStatus('บันทึกไม่สำเร็จ: ' + (e.message || e), true);
    alert('บันทึกข้อมูลไม่สำเร็จ: ' + (e.message || e));
    return false;
  }
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function fmt(n) { return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtInt(n) { return Number(n || 0).toLocaleString('th-TH'); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDateDMY(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
    if (d) return `${String(d.d).padStart(2,'0')}/${String(d.m).padStart(2,'0')}/${d.y}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[3].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[1]}`;
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m2) return `${m2[1].padStart(2,'0')}/${m2[2].padStart(2,'0')}/${m2[3]}`;
  return s;
}
function getAccount(id) { return state.accounts.find(a => a.id === id); }
function getCustomer(id) { return state.customers.find(c => c.id === id); }

function accountBalance(acc) {
  let d = 0, c = 0;
  state.entries.forEach(e => e.lines.forEach(l => {
    if (l.accountId !== acc.id) return;
    d += Number(l.debit) || 0; c += Number(l.credit) || 0;
  }));
  if (normalDebit(acc.type)) return { d, c, balD: Math.max(0, d - c), balC: Math.max(0, c - d), net: d - c };
  return { d, c, balD: Math.max(0, d - c), balC: Math.max(0, c - d), net: c - d };
}

// Tabs
function activateTab(tabId) {
  const btn = document.querySelector(`#main-nav button[data-tab="${tabId}"]`);
  if (!btn) return;
  document.querySelectorAll('#main-nav button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const section = document.getElementById(tabId);
  if (section) section.classList.add('active');
  try { localStorage.setItem('active_tab', tabId); } catch {}
  if (tabId === 'ledger') renderLedgerSelect();
  if (tabId === 'trial') renderTrial();
  if (tabId === 'dashboard') renderDashboard();
  if (tabId === 'worksheet') renderWorksheet();
  if (tabId === 'customers') { renderCustomers(); renderCustomerNames(); renderImportFiles('customer_names'); }
  if (tabId === 'customer-costs') { renderCustomerCosts(); renderImportFiles('customer_costs'); }
  if (tabId === 'incoming-docs') { renderIncomingDocs(); renderImportFiles('incoming_docs'); }
  if (tabId === 'import') renderImportFiles();
  if (tabId === 'receivables') { renderCustomerOptions(); renderReceivables(); }
  if (tabId === 'autodesc') renderAutoDesc();
  if (tabId === 'settings') renderSettings();
}
document.querySelectorAll('#main-nav button').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// Accounts
const accForm = document.getElementById('account-form');
const accSubmit = document.getElementById('acc-submit');
const accCancel = document.getElementById('acc-cancel');
let editingAccountId = null;
function resetAccountForm() { editingAccountId = null; accForm.reset(); accSubmit.textContent = 'เพิ่มบัญชี'; accCancel.hidden = true; }
accCancel.addEventListener('click', () => { resetAccountForm(); alert('ยกเลิกการแก้ไขหมวดหมู่บัญชีแล้ว'); });
accForm.addEventListener('submit', async e => {
  e.preventDefault();
  const code = document.getElementById('acc-code').value.trim();
  const name = document.getElementById('acc-name').value.trim();
  const type = document.getElementById('acc-type').value;
  if (!code || !name || !type) return;
  if (state.accounts.some(a => a.code === code && a.id !== editingAccountId)) { alert('รหัสบัญชีซ้ำ'); return; }
  const isEdit = !!editingAccountId;
  if (isEdit && !confirm('ยืนยันการแก้ไขหมวดหมู่บัญชีนี้?')) return;
  const prev = JSON.stringify(state);
  if (isEdit) {
    const acc = state.accounts.find(a => a.id === editingAccountId);
    if (!acc) { resetAccountForm(); return; }
    acc.code = code; acc.name = name; acc.type = type;
  } else {
    state.accounts.push({ id: uid(), code, name, type });
  }
  state.accounts.sort((a,b) => a.code.localeCompare(b.code));
  if (await save()) { resetAccountForm(); renderAccounts(); refreshAccountSelects(); renderJournal(); renderTrial(); alert(isEdit ? 'แก้ไขหมวดหมู่บัญชีเรียบร้อย' : 'เพิ่มหมวดหมู่บัญชีเรียบร้อย'); }
  else { state = JSON.parse(prev); renderAccounts(); }
});
function renderAccounts() {
  const tbody = document.querySelector('#accounts-table tbody');
  if (!state.accounts.length) { tbody.innerHTML = '<tr><td colspan="4" class="muted">ยังไม่มีบัญชี</td></tr>'; return; }
  tbody.innerHTML = state.accounts.map(a => `
    <tr>
      <td>${esc(a.code)}</td><td>${esc(a.name)}</td><td>${TYPES[a.type] || a.type}</td>
      <td class="actions-cell">
        <button class="small secondary" data-edit-acc="${a.id}">แก้ไข</button>
        <button class="small danger" data-del-acc="${a.id}">ลบ</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit-acc]').forEach(btn => btn.addEventListener('click', () => {
    const acc = state.accounts.find(a => a.id === btn.dataset.editAcc); if (!acc) return;
    editingAccountId = acc.id;
    document.getElementById('acc-code').value = acc.code;
    document.getElementById('acc-name').value = acc.name;
    document.getElementById('acc-type').value = acc.type;
    accSubmit.textContent = 'บันทึกการแก้ไข'; accCancel.hidden = false;
    document.getElementById('acc-code').focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  tbody.querySelectorAll('[data-del-acc]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.delAcc;
    if (state.entries.some(e => e.lines.some(l => l.accountId === id))) { alert('บัญชีนี้ถูกใช้ในรายการแล้ว ลบไม่ได้'); return; }
    if (!confirm('ยืนยันการลบหมวดหมู่บัญชีนี้?')) return;
    const prev = JSON.stringify(state);
    state.accounts = state.accounts.filter(a => a.id !== id);
    if (editingAccountId === id) resetAccountForm();
    if (await save()) { renderAccounts(); refreshAccountSelects(); alert('ลบหมวดหมู่บัญชีเรียบร้อย'); } else { state = JSON.parse(prev); renderAccounts(); }
  }));
}
function accountOptions(selected) {
  return '<option value="">-- เลือกบัญชี --</option>' + state.accounts.map(a =>
    `<option value="${a.id}" ${a.id===selected?'selected':''}>${esc(a.code)} - ${esc(a.name)}</option>`).join('');
}

// Journal
const linesEl = document.getElementById('je-lines');
function addLine(data={}) {
  const div = document.createElement('div');
  div.className = 'je-line';
  div.innerHTML = `
    <select class="je-account" required>${accountOptions(data.accountId)}</select>
    <input type="number" class="je-debit" placeholder="เดบิต" min="0" step="0.01" value="${data.debit||''}">
    <input type="number" class="je-credit" placeholder="เครดิต" min="0" step="0.01" value="${data.credit||''}">
    <button type="button" class="small danger je-remove">x</button>`;
  div.querySelector('.je-remove').addEventListener('click', () => { if (linesEl.children.length > 2) { if (!confirm('ยืนยันการลบบรรทัดนี้?')) return; div.remove(); updateTotals(); alert('ลบบรรทัดแล้ว'); } else { alert('ต้องมีอย่างน้อย 2 บรรทัด'); } });
  div.querySelectorAll('input').forEach(i => i.addEventListener('input', updateTotals));
  linesEl.appendChild(div);
}
function resetJournalLines() { linesEl.innerHTML = ''; addLine(); addLine(); updateTotals(); }
function updateTotals() {
  let d=0,c=0;
  linesEl.querySelectorAll('.je-line').forEach(row => { d += parseFloat(row.querySelector('.je-debit').value)||0; c += parseFloat(row.querySelector('.je-credit').value)||0; });
  const td = document.getElementById('total-debit'); const tc = document.getElementById('total-credit');
  td.textContent = fmt(d); tc.textContent = fmt(c);
  const ok = Math.abs(d-c) < 0.005 && d > 0;
  td.className = tc.className = ok ? 'balanced' : 'unbalanced';
  return {d,c,ok};
}
document.getElementById('add-line').addEventListener('click', () => { addLine(); alert('เพิ่มบรรทัดรายการแล้ว'); });
function refreshAccountSelects() {
  linesEl.querySelectorAll('.je-account').forEach(sel => { const val = sel.value; sel.innerHTML = accountOptions(val); });
  renderLedgerSelect();
}
function renderAutoDescDatalist() {
  const dl = document.getElementById('auto-desc-list');
  if (!dl) return;
  const texts = [...new Set(state.autoDesc.map(r => r.text).filter(Boolean))];
  dl.innerHTML = texts.map(t => `<option value="${esc(t)}"></option>`).join('');
}
document.getElementById('je-desc').addEventListener('input', (e) => {
  const v = e.target.value.trim().toLowerCase();
  if (!v) return;
  const match = state.autoDesc.find(r => r.keyword && v.includes(r.keyword.toLowerCase()));
  if (match && match.text && e.target.value.trim().length <= (match.keyword || '').length + 2) {
    e.target.value = match.text;
  }
});
document.getElementById('journal-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('je-error'); err.textContent = '';
  const date = document.getElementById('je-date').value;
  const desc = document.getElementById('je-desc').value.trim();
  const {ok} = updateTotals();
  if (!ok) { err.textContent = 'ยอดเดบิตและเครดิตต้องเท่ากันและมากกว่า 0'; return; }
  const lines = [];
  for (const row of linesEl.querySelectorAll('.je-line')) {
    const accountId = row.querySelector('.je-account').value;
    const debit = parseFloat(row.querySelector('.je-debit').value) || 0;
    const credit = parseFloat(row.querySelector('.je-credit').value) || 0;
    if (!accountId || (debit === 0 && credit === 0)) continue;
    if (debit > 0 && credit > 0) { err.textContent = 'แต่ละบรรทัดใส่ได้เฉพาะเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง'; return; }
    lines.push({ accountId, debit, credit });
  }
  if (lines.length < 2) { err.textContent = 'ต้องมีอย่างน้อย 2 บรรทัด'; return; }
  const prev = JSON.stringify(state);
  state.entries.push({ id: uid(), date, desc, lines });
  state.entries.sort((a,b) => (a.date||'').localeCompare(b.date||'') || a.id.localeCompare(b.id));
  if (await save()) { document.getElementById('je-date').value = ''; document.getElementById('je-desc').value = ''; resetJournalLines(); renderJournal(); alert('บันทึกรายการเรียบร้อย'); }
  else { state = JSON.parse(prev); }
});
function renderJournal() {
  const list = document.getElementById('journal-list');
  if (!state.entries.length) { list.innerHTML = '<p class="muted">ยังไม่มีรายการ</p>'; return; }
  list.innerHTML = state.entries.slice().reverse().map(e => {
    const rows = e.lines.map(l => {
      const a = getAccount(l.accountId);
      const name = a ? `${esc(a.code)} - ${esc(a.name)}` : '(บัญชีถูกลบ)';
      return `<tr><td>${name}</td><td class="right">${l.debit?fmt(l.debit):''}</td><td class="right">${l.credit?fmt(l.credit):''}</td></tr>`;
    }).join('');
    return `<div class="entry"><div class="entry-header"><span>${esc(e.date)} — ${esc(e.desc)}</span>
      <button class="small danger" data-del-entry="${e.id}">ลบ</button></div>
      <table><thead><tr><th>บัญชี</th><th class="right">เดบิต</th><th class="right">เครดิต</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');
  list.querySelectorAll('[data-del-entry]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('ยืนยันการลบรายการบันทึกนี้?')) return;
    const prev = JSON.stringify(state);
    state.entries = state.entries.filter(e => e.id !== btn.dataset.delEntry);
    if (await save()) { renderJournal(); renderTrial(); alert('ลบรายการบันทึกเรียบร้อย'); } else { state = JSON.parse(prev); renderJournal(); }
  }));
}

// Ledger
function renderLedgerSelect() {
  const sel = document.getElementById('ledger-account'); const val = sel.value;
  sel.innerHTML = '<option value="">-- เลือกบัญชี --</option>' + state.accounts.map(a => `<option value="${a.id}">${esc(a.code)} - ${esc(a.name)}</option>`).join('');
  if (val) sel.value = val; renderLedger();
}
document.getElementById('ledger-account').addEventListener('change', renderLedger);
function renderLedger() {
  const accId = document.getElementById('ledger-account').value;
  const view = document.getElementById('ledger-view');
  if (!accId) { view.innerHTML = '<p class="muted">เลือกบัญชีเพื่อดูรายละเอียด</p>'; return; }
  const acc = getAccount(accId); if (!acc) { view.innerHTML = ''; return; }
  let balance = 0; const rows = [];
  state.entries.forEach(e => e.lines.forEach(l => {
    if (l.accountId !== accId) return;
    if (normalDebit(acc.type)) balance += (Number(l.debit)||0) - (Number(l.credit)||0); else balance += (Number(l.credit)||0) - (Number(l.debit)||0);
    rows.push(`<tr><td>${esc(e.date)}</td><td>${esc(e.desc)}</td><td class="right">${l.debit?fmt(l.debit):''}</td><td class="right">${l.credit?fmt(l.credit):''}</td><td class="right">${fmt(balance)}</td></tr>`);
  }));
  if (!rows.length) { view.innerHTML = '<p class="muted">ไม่มีการเคลื่อนไหว</p>'; return; }
  view.innerHTML = `<div class="card"><strong>${esc(acc.code)} - ${esc(acc.name)}</strong> (${TYPES[acc.type]})<table><thead><tr><th>วันที่</th><th>รายละเอียด</th><th class="right">เดบิต</th><th class="right">เครดิต</th><th class="right">คงเหลือ</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

// Trial balance
function renderTrial() {
  const view = document.getElementById('trial-view');
  if (!state.accounts.length) { view.innerHTML = '<p class="muted">ยังไม่มีบัญชี</p>'; return; }
  let totalD=0, totalC=0;
  const rows = state.accounts.map(acc => {
    const b = accountBalance(acc);
    const balD = normalDebit(acc.type) ? (b.net >= 0 ? b.net : 0) : (b.net < 0 ? -b.net : 0);
    const balC = normalDebit(acc.type) ? (b.net < 0 ? -b.net : 0) : (b.net >= 0 ? b.net : 0);
    if (balD === 0 && balC === 0) return '';
    totalD += balD; totalC += balC;
    return `<tr><td>${esc(acc.code)}</td><td>${esc(acc.name)}</td><td class="right">${balD?fmt(balD):''}</td><td class="right">${balC?fmt(balC):''}</td></tr>`;
  }).filter(Boolean).join('');
  const ok = Math.abs(totalD-totalC) < 0.005;
  view.innerHTML = `<table><thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th class="right">เดบิต</th><th class="right">เครดิต</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">ยังไม่มียอดคงเหลือ</td></tr>'}</tbody>
    <tfoot><tr><th colspan="2">รวม</th><th class="right ${ok?'balanced':'unbalanced'}">${fmt(totalD)}</th><th class="right ${ok?'balanced':'unbalanced'}">${fmt(totalC)}</th></tr></tfoot></table>
    <p style="margin-top:8px" class="${ok?'balanced':'unbalanced'}">${ok ? 'งบทดลองดุล' : 'งบทดลองไม่ดุล'}</p>`;
}

// Worksheet
function renderWorksheet() {
  const view = document.getElementById('worksheet-view');
  if (!state.accounts.length) { view.innerHTML = '<p class="muted">ยังไม่มีบัญชี</p>'; return; }
  let tTD=0,tTC=0,tID=0,tIC=0,tBD=0,tBC=0;
  const rows = state.accounts.map(acc => {
    const b = accountBalance(acc);
    const balD = normalDebit(acc.type) ? (b.net >= 0 ? b.net : 0) : (b.net < 0 ? -b.net : 0);
    const balC = normalDebit(acc.type) ? (b.net < 0 ? -b.net : 0) : (b.net >= 0 ? b.net : 0);
    if (balD === 0 && balC === 0 && b.d === 0 && b.c === 0) return '';
    tTD += balD; tTC += balC;
    let incD=0,incC=0,bsD=0,bsC=0;
    if (acc.type === 'revenue' || acc.type === 'expense') { incD = balD; incC = balC; tID += incD; tIC += incC; }
    else { bsD = balD; bsC = balC; tBD += bsD; tBC += bsC; }
    return `<tr><td>${esc(acc.code)}</td><td>${esc(acc.name)}</td>
      <td class="right">${balD?fmt(balD):''}</td><td class="right">${balC?fmt(balC):''}</td>
      <td class="right"></td><td class="right"></td>
      <td class="right">${balD?fmt(balD):''}</td><td class="right">${balC?fmt(balC):''}</td>
      <td class="right">${incD?fmt(incD):''}</td><td class="right">${incC?fmt(incC):''}</td>
      <td class="right">${bsD?fmt(bsD):''}</td><td class="right">${bsC?fmt(bsC):''}</td></tr>`;
  }).filter(Boolean).join('');
  const adjD = tTD, adjC = tTC;
  const profit = tIC - tID;
  const incDtot = tID + (profit>=0?profit:0);
  const incCtot = tIC + (profit<0?-profit:0);
  const bsDtot = tBD + (profit<0?-profit:0);
  const bsCtot = tBC + (profit>=0?profit:0);
  view.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th rowspan="2">รหัส</th><th rowspan="2">ชื่อบัญชี</th><th colspan="2">งบทดลอง</th><th colspan="2">ปรับปรุง</th><th colspan="2">หลังปรับปรุง</th><th colspan="2">งบกำไรขาดทุน</th><th colspan="2">งบดุล</th></tr>
    <tr><th class="right">Dr</th><th class="right">Cr</th><th class="right">Dr</th><th class="right">Cr</th><th class="right">Dr</th><th class="right">Cr</th><th class="right">Dr</th><th class="right">Cr</th><th class="right">Dr</th><th class="right">Cr</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="12" class="muted">ยังไม่มียอดคงเหลือ</td></tr>'}</tbody>
    <tfoot><tr><th colspan="2">รวม</th><th class="right">${fmt(tTD)}</th><th class="right">${fmt(tTC)}</th><th class="right">-</th><th class="right">-</th><th class="right">${fmt(adjD)}</th><th class="right">${fmt(adjC)}</th><th class="right">${fmt(tID)}</th><th class="right">${fmt(tIC)}</th><th class="right">${fmt(tBD)}</th><th class="right">${fmt(tBC)}</th></tr>
    <tr><th colspan="8">กำไร (ขาดทุน) สุทธิ</th><th class="right">${profit>=0?fmt(profit):''}</th><th class="right">${profit<0?fmt(-profit):''}</th><th class="right">${profit<0?fmt(-profit):''}</th><th class="right">${profit>=0?fmt(profit):''}</th></tr>
    <tr><th colspan="8">รวมหลังปิดบัญชี</th><th class="right">${fmt(incDtot)}</th><th class="right">${fmt(incCtot)}</th><th class="right">${fmt(bsDtot)}</th><th class="right">${fmt(bsCtot)}</th></tr></tfoot></table></div>`;
}

// Dashboard
function renderDashboard() {
  const view = document.getElementById('dashboard-view');
  let revenue=0, expense=0, asset=0, liability=0, equity=0;
  state.accounts.forEach(acc => {
    const net = accountBalance(acc).net;
    if (acc.type === 'revenue') revenue += net;
    if (acc.type === 'expense') expense += net;
    if (acc.type === 'asset') asset += net;
    if (acc.type === 'liability') liability += net;
    if (acc.type === 'equity') equity += net;
  });
  const profit = revenue - expense;
  const arOutstanding = state.receivables.reduce((s,r)=>s + Math.max(0,(Number(r.amount)||0)-(Number(r.paid)||0)),0);
  const arOverdue = state.receivables.filter(r => { const out = (Number(r.amount)||0)-(Number(r.paid)||0); return out>0 && r.due && r.due < new Date().toISOString().slice(0,10); }).length;
  const company = esc(state.settings.company || 'ยังไม่ได้ตั้งค่าชื่อกิจการ');
  view.innerHTML = `
    <div class="cards">
      <div class="stat"><div class="muted">รายได้รวม</div><div class="stat-value">${fmt(revenue)}</div></div>
      <div class="stat"><div class="muted">ค่าใช้จ่ายรวม</div><div class="stat-value">${fmt(expense)}</div></div>
      <div class="stat"><div class="muted">กำไร (ขาดทุน) สุทธิ</div><div class="stat-value ${profit>=0?'balanced':'unbalanced'}">${fmt(profit)}</div></div>
      <div class="stat"><div class="muted">ลูกหนี้คงค้าง</div><div class="stat-value">${fmt(arOutstanding)}</div></div>
    </div>
    <div class="cards" style="margin-top:12px">
      <div class="stat"><div class="muted">สินทรัพย์</div><div class="stat-value">${fmt(asset)}</div></div>
      <div class="stat"><div class="muted">หนี้สิน</div><div class="stat-value">${fmt(liability)}</div></div>
      <div class="stat"><div class="muted">ทุน</div><div class="stat-value">${fmt(equity)}</div></div>
      <div class="stat"><div class="muted">จำนวนรายการ/ลูกค้า</div><div class="stat-value">${fmtInt(state.entries.length)} / ${fmtInt(state.customers.length)}</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>ภาพรวม</h3>
      <p><strong>กิจการ:</strong> ${company}</p>
      <p class="muted">หมวดหมู่บัญชี ${fmtInt(state.accounts.length)} บัญชี · รายการบันทึก ${fmtInt(state.entries.length)} รายการ · ลูกหนี้ค้างชำระ ${fmtInt(state.receivables.filter(r=>(Number(r.amount)||0)-(Number(r.paid)||0)>0).length)} รายการ${arOverdue?` (เกินกำหนด ${fmtInt(arOverdue)})`:''}</p>
      <p class="muted">รายชื่อลูกค้า(ไฟล์) ${fmtInt(state.customerNames.length)} ราย · ต้นทุน/ขาย ${fmtInt(state.customerCosts.length)} รายการ · เอกสารรับเข้า ${fmtInt(state.incomingDocs.length)} รายการ</p>
    </div>`;
}

// Customers
const custForm = document.getElementById('customer-form');
const custSubmit = document.getElementById('cust-submit');
const custCancel = document.getElementById('cust-cancel');
let editingCustomerId = null;
function resetCustomerForm(){ editingCustomerId=null; custForm.reset(); custSubmit.textContent='เพิ่มลูกค้า'; custCancel.hidden=true; }
custCancel.addEventListener('click', () => { resetCustomerForm(); alert('ยกเลิกการแก้ไขข้อมูลลูกค้าแล้ว'); });
custForm.addEventListener('submit', async e => {
  e.preventDefault();
  const code = document.getElementById('cust-code').value.trim();
  const name = document.getElementById('cust-name').value.trim();
  const phone = document.getElementById('cust-phone').value.trim();
  const tax = document.getElementById('cust-tax').value.trim();
  const address = document.getElementById('cust-address').value.trim();
  if (!code || !name) return;
  if (state.customers.some(c => c.code === code && c.id !== editingCustomerId)) { alert('รหัสลูกค้าซ้ำ'); return; }
  const isEdit = !!editingCustomerId;
  if (isEdit && !confirm('ยืนยันการแก้ไขข้อมูลลูกค้า?')) return;
  const prev = JSON.stringify(state);
  if (isEdit) {
    const c = state.customers.find(x=>x.id===editingCustomerId); if(!c){resetCustomerForm();return;}
    Object.assign(c,{code,name,phone,tax,address});
  } else { state.customers.push({id:uid(),code,name,phone,tax,address}); }
  state.customers.sort((a,b)=>(a.code||'').localeCompare(b.code||''));
  if (await save()) { resetCustomerForm(); renderCustomers(); renderCustomerOptions(); alert(isEdit ? 'แก้ไขข้อมูลลูกค้าเรียบร้อย' : 'เพิ่มลูกค้าเรียบร้อย'); } else { state=JSON.parse(prev); renderCustomers(); }
});
function renderCustomers() {
  const tbody = document.querySelector('#customers-table tbody');
  if (!state.customers.length) { tbody.innerHTML='<tr><td colspan="6" class="muted">ยังไม่มีลูกค้า</td></tr>'; return; }
  tbody.innerHTML = state.customers.map(c=>`<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.tax)}</td><td>${esc(c.address)}</td>
    <td class="actions-cell"><button class="small secondary" data-edit-cust="${c.id}">แก้ไข</button><button class="small danger" data-del-cust="${c.id}">ลบ</button></td></tr>`).join('');
  tbody.querySelectorAll('[data-edit-cust]').forEach(btn=>btn.addEventListener('click',()=>{
    const c = state.customers.find(x=>x.id===btn.dataset.editCust); if(!c) return;
    editingCustomerId=c.id; document.getElementById('cust-code').value=c.code||''; document.getElementById('cust-name').value=c.name||'';
    document.getElementById('cust-phone').value=c.phone||''; document.getElementById('cust-tax').value=c.tax||''; document.getElementById('cust-address').value=c.address||'';
    custSubmit.textContent='บันทึกการแก้ไข'; custCancel.hidden=false; window.scrollTo({top:0,behavior:'smooth'});
  }));
  tbody.querySelectorAll('[data-del-cust]').forEach(btn=>btn.addEventListener('click', async ()=>{
    const id = btn.dataset.delCust;
    if (state.receivables.some(r=>r.customerId===id)) { alert('ลูกค้ามีรายการลูกหนี้อยู่ ลบไม่ได้'); return; }
    if (!confirm('ยืนยันการลบลูกค้านี้?')) return;
    const prev=JSON.stringify(state); state.customers = state.customers.filter(c=>c.id!==id);
    if (editingCustomerId===id) resetCustomerForm();
    if (await save()) { renderCustomers(); renderCustomerOptions(); alert('ลบลูกค้าเรียบร้อย'); } else { state=JSON.parse(prev); renderCustomers(); }
  }));
}
function renderCustomerOptions() {
  const sel = document.getElementById('ar-customer'); if(!sel) return;
  const val = sel.value;
  sel.innerHTML = '<option value="">-- เลือกลูกค้า --</option>' + state.customers.map(c=>`<option value="${c.id}" ${c.id===val?'selected':''}>${esc(c.code)} - ${esc(c.name)}</option>`).join('');
  if (val) sel.value = val;
}

function renderCustomerNames() {
  const tbody = document.querySelector('#customer-names-table tbody');
  if (!tbody) return;
  if (!state.customerNames.length) { tbody.innerHTML = '<tr><td colspan="2" class="muted">ยังไม่มีรายชื่อลูกค้า (นำเข้าจากไฟล์)</td></tr>'; return; }
  tbody.innerHTML = state.customerNames.map((c, i) => `<tr><td>${esc(c.name || c['ชื่อลูกค้า'] || '')}</td>
    <td class="actions-cell">
      <button class="small secondary" data-edit-cname="${i}">แก้ไข</button>
      <button class="small danger" data-del-cname="${i}">ลบ</button>
    </td></tr>`).join('');
  tbody.querySelectorAll('[data-edit-cname]').forEach(btn => btn.addEventListener('click', () => {
    editingCNameIndex = Number(btn.dataset.editCname);
    const c = state.customerNames[editingCNameIndex]; if (!c) return;
    document.getElementById('cname-input').value = c.name || '';
    document.getElementById('cname-submit').textContent = 'บันทึกการแก้ไข';
    document.getElementById('cname-cancel').hidden = false;
    document.getElementById('cname-input').focus();
  }));
  tbody.querySelectorAll('[data-del-cname]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('ยืนยันการลบรายชื่อลูกค้านี้?')) return;
    const prev = JSON.stringify(state);
    const idx = Number(btn.dataset.delCname);
    state.customerNames.splice(idx, 1);
    if (editingCNameIndex === idx) resetCNameForm();
    else if (editingCNameIndex > idx) editingCNameIndex--;
    if (await save()) { renderCustomerNames(); alert('ลบรายชื่อลูกค้าเรียบร้อย'); } else { state = JSON.parse(prev); renderCustomerNames(); }
  }));
}

function renderCustomerCosts() {
  const tbody = document.querySelector('#customer-costs-table tbody');
  if (!tbody) return;
  if (!state.customerCosts.length) { tbody.innerHTML = '<tr><td colspan="5" class="muted">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = state.customerCosts.map((r, i) => `<tr><td>${esc(fmtDateDMY(r.date||''))}</td><td>${esc(r.name||'')}</td>
    <td class="right">${fmt(r.cost)}</td><td class="right">${fmt(r.price)}</td>
    <td><button class="small danger" data-del-cc="${i}">ลบ</button></td></tr>`).join('');
  tbody.querySelectorAll('[data-del-cc]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('ยืนยันการลบรายการนี้?')) return;
    const prev = JSON.stringify(state);
    state.customerCosts.splice(Number(btn.dataset.delCc), 1);
    if (await save()) { renderCustomerCosts(); alert('ลบรายการเรียบร้อย'); } else { state = JSON.parse(prev); renderCustomerCosts(); }
  }));
}

function renderIncomingDocs() {
  const tbody = document.querySelector('#incoming-docs-table tbody');
  if (!tbody) return;
  if (!state.incomingDocs.length) { tbody.innerHTML = '<tr><td colspan="7" class="muted">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = state.incomingDocs.map((r, i) => `<tr><td>${esc(fmtDateDMY(r.date||''))}</td><td>${esc(r.docType||'')}</td><td>${esc(r.supplier||'')}</td>
    <td class="right">${fmt(r.total)}</td><td class="right">${fmt(r.discount)}</td><td>${esc(r.payment||'')}</td>
    <td><button class="small danger" data-del-idoc="${i}">ลบ</button></td></tr>`).join('');
  tbody.querySelectorAll('[data-del-idoc]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('ยืนยันการลบเอกสารนี้?')) return;
    const prev = JSON.stringify(state);
    state.incomingDocs.splice(Number(btn.dataset.delIdoc), 1);
    if (await save()) { renderIncomingDocs(); alert('ลบเอกสารเรียบร้อย'); } else { state = JSON.parse(prev); renderIncomingDocs(); }
  }));
}

// Receivables
const arForm = document.getElementById('receivable-form');
const arSubmit = document.getElementById('ar-submit');
const arCancel = document.getElementById('ar-cancel');
let editingArId = null;
function resetArForm(){ editingArId=null; arForm.reset(); arSubmit.textContent='เพิ่มลูกหนี้'; arCancel.hidden=true; document.getElementById('ar-paid').value='0'; }
arCancel.addEventListener('click', () => { resetArForm(); alert('ยกเลิกการแก้ไขรายการลูกหนี้แล้ว'); });
arForm.addEventListener('submit', async e => {
  e.preventDefault();
  const customerId = document.getElementById('ar-customer').value;
  const docNo = document.getElementById('ar-doc').value.trim();
  const date = document.getElementById('ar-date').value;
  const due = document.getElementById('ar-due').value;
  const amount = parseFloat(document.getElementById('ar-amount').value)||0;
  const paid = parseFloat(document.getElementById('ar-paid').value)||0;
  const note = document.getElementById('ar-note').value.trim();
  if (!customerId || !docNo || !date || amount <= 0) return;
  const isEdit = !!editingArId;
  if (isEdit && !confirm('ยืนยันการแก้ไขรายการลูกหนี้?')) return;
  const prev = JSON.stringify(state);
  if (isEdit) {
    const r = state.receivables.find(x=>x.id===editingArId); if(!r){resetArForm();return;}
    Object.assign(r,{customerId,docNo,date,due,amount,paid,note});
  } else { state.receivables.push({id:uid(),customerId,docNo,date,due,amount,paid,note}); }
  state.receivables.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  if (await save()) { resetArForm(); renderReceivables(); alert(isEdit ? 'แก้ไขรายการลูกหนี้เรียบร้อย' : 'เพิ่มรายการลูกหนี้เรียบร้อย'); } else { state=JSON.parse(prev); }
});
function renderReceivables() {
  const tbody = document.querySelector('#receivables-table tbody');
  const summary = document.getElementById('receivables-summary');
  const today = new Date().toISOString().slice(0,10);
  const total = state.receivables.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const paid = state.receivables.reduce((s,r)=>s+(Number(r.paid)||0),0);
  const out = Math.max(0,total-paid);
  summary.innerHTML = `<div class="stat"><div class="muted">ยอดลูกหนี้รวม</div><div class="stat-value">${fmt(total)}</div></div>
    <div class="stat"><div class="muted">รับชำระแล้ว</div><div class="stat-value">${fmt(paid)}</div></div>
    <div class="stat"><div class="muted">คงค้าง</div><div class="stat-value ${out>0?'unbalanced':'balanced'}">${fmt(out)}</div></div>`;
  if (!state.receivables.length) { tbody.innerHTML='<tr><td colspan="9" class="muted">ยังไม่มีรายการลูกหนี้</td></tr>'; return; }
  tbody.innerHTML = state.receivables.slice().reverse().map(r=>{
    const c = getCustomer(r.customerId);
    const amt=Number(r.amount)||0, pd=Number(r.paid)||0, remain=Math.max(0,amt-pd);
    let status='คงค้าง', cls='unbalanced';
    if (remain <= 0.005) { status='ชำระแล้ว'; cls='balanced'; }
    else if (r.due && r.due < today) { status='เกินกำหนด'; cls='unbalanced'; }
    return `<tr><td>${esc(c?`${c.code} - ${c.name}`:'-')}</td><td>${esc(r.docNo)}</td><td>${esc(r.date)}</td><td>${esc(r.due||'-')}</td>
      <td class="right">${fmt(amt)}</td><td class="right">${fmt(pd)}</td><td class="right">${fmt(remain)}</td><td class="${cls}">${status}</td>
      <td class="actions-cell"><button class="small secondary" data-edit-ar="${r.id}">แก้ไข</button><button class="small danger" data-del-ar="${r.id}">ลบ</button></td></tr>`;
  }).join('');
  tbody.querySelectorAll('[data-edit-ar]').forEach(btn=>btn.addEventListener('click',()=>{
    const r = state.receivables.find(x=>x.id===btn.dataset.editAr); if(!r) return;
    editingArId=r.id; renderCustomerOptions();
    document.getElementById('ar-customer').value=r.customerId||''; document.getElementById('ar-doc').value=r.docNo||'';
    document.getElementById('ar-date').value=r.date||''; document.getElementById('ar-due').value=r.due||'';
    document.getElementById('ar-amount').value=r.amount||0; document.getElementById('ar-paid').value=r.paid||0; document.getElementById('ar-note').value=r.note||'';
    arSubmit.textContent='บันทึกการแก้ไข'; arCancel.hidden=false; window.scrollTo({top:0,behavior:'smooth'});
  }));
  tbody.querySelectorAll('[data-del-ar]').forEach(btn=>btn.addEventListener('click', async ()=>{
    if (!confirm('ยืนยันการลบรายการลูกหนี้นี้?')) return;
    const prev=JSON.stringify(state); state.receivables = state.receivables.filter(r=>r.id!==btn.dataset.delAr);
    if (editingArId===btn.dataset.delAr) resetArForm();
    if (await save()) { renderReceivables(); alert('ลบรายการลูกหนี้เรียบร้อย'); } else { state=JSON.parse(prev); renderReceivables(); }
  }));
}

// Auto descriptions
const adForm = document.getElementById('autodesc-form');
const adSubmit = document.getElementById('ad-submit');
const adCancel = document.getElementById('ad-cancel');
let editingAdId = null;
function resetAdForm(){ editingAdId=null; adForm.reset(); adSubmit.textContent='เพิ่มกฎ'; adCancel.hidden=true; }
adCancel.addEventListener('click', () => { resetAdForm(); alert('ยกเลิกการแก้ไขกฎคำอธิบายอัตโนมัติแล้ว'); });
adForm.addEventListener('submit', async e => {
  e.preventDefault();
  const keyword = document.getElementById('ad-keyword').value.trim();
  const text = document.getElementById('ad-text').value.trim();
  if (!keyword || !text) return;
  const isEdit = !!editingAdId;
  if (isEdit && !confirm('ยืนยันการแก้ไขกฎคำอธิบายอัตโนมัติ?')) return;
  const prev = JSON.stringify(state);
  if (isEdit) { const r=state.autoDesc.find(x=>x.id===editingAdId); if(r){r.keyword=keyword;r.text=text;} else {resetAdForm();return;} }
  else { state.autoDesc.push({id:uid(),keyword,text}); }
  if (await save()) { resetAdForm(); renderAutoDesc(); renderAutoDescDatalist(); alert(isEdit ? 'แก้ไขกฎคำอธิบายอัตโนมัติเรียบร้อย' : 'เพิ่มกฎคำอธิบายอัตโนมัติเรียบร้อย'); } else { state=JSON.parse(prev); }
});
function renderAutoDesc() {
  const tbody = document.querySelector('#autodesc-table tbody');
  if (!state.autoDesc.length) { tbody.innerHTML='<tr><td colspan="3" class="muted">ยังไม่มีกฎคำอธิบายอัตโนมัติ</td></tr>'; return; }
  tbody.innerHTML = state.autoDesc.map(r=>`<tr><td>${esc(r.keyword)}</td><td>${esc(r.text)}</td>
    <td class="actions-cell"><button class="small secondary" data-edit-ad="${r.id}">แก้ไข</button><button class="small danger" data-del-ad="${r.id}">ลบ</button></td></tr>`).join('');
  tbody.querySelectorAll('[data-edit-ad]').forEach(btn=>btn.addEventListener('click',()=>{
    const r = state.autoDesc.find(x=>x.id===btn.dataset.editAd); if(!r) return;
    editingAdId=r.id; document.getElementById('ad-keyword').value=r.keyword||''; document.getElementById('ad-text').value=r.text||'';
    adSubmit.textContent='บันทึกการแก้ไข'; adCancel.hidden=false;
  }));
  tbody.querySelectorAll('[data-del-ad]').forEach(btn=>btn.addEventListener('click', async ()=>{
    if (!confirm('ยืนยันการลบกฎคำอธิบายอัตโนมัตินี้?')) return; const prev=JSON.stringify(state);
    state.autoDesc = state.autoDesc.filter(r=>r.id!==btn.dataset.delAd); if(editingAdId===btn.dataset.delAd) resetAdForm();
    if (await save()) { renderAutoDesc(); renderAutoDescDatalist(); alert('ลบกฎคำอธิบายอัตโนมัติเรียบร้อย'); } else { state=JSON.parse(prev); renderAutoDesc(); }
  }));
}

// Imported file tracking and deletion
const IMPORT_TYPE_LABELS = {
  customer_names: 'รายชื่อลูกค้า',
  customer_costs: 'รายชื่อลูกค้าพร้อมต้นทุน',
  incoming_docs: 'เอกสารรับเข้า'
};
function renderImportFiles(filterType) {
  const targets = filterType ? [document.getElementById(`import-files-${filterType}`)] : [document.getElementById('import-files-all')];
  targets.forEach(target => {
    if (!target) return;
    const files = state.importFiles.filter(f => !filterType || f.type === filterType);
    if (!files.length) { target.innerHTML = '<p class="muted">ยังไม่มีไฟล์ที่นำเข้า</p>'; return; }
    target.innerHTML = `<div class="card"><h3>ไฟล์ที่นำเข้า</h3><table><thead><tr><th>ชื่อไฟล์</th><th>ประเภท</th><th class="right">จำนวน</th><th>จัดการ</th></tr></thead><tbody>` +
      files.map(f => `<tr><td>${esc(f.name)}</td><td>${esc(IMPORT_TYPE_LABELS[f.type] || f.type)}</td><td class="right">${fmtInt(f.count||0)}</td>
        <td><button class="small danger" data-del-file="${f.id}">ลบไฟล์</button></td></tr>`).join('') + `</tbody></table></div>`;
    target.querySelectorAll('[data-del-file]').forEach(btn => btn.addEventListener('click', async () => {
      const file = state.importFiles.find(x => x.id === btn.dataset.delFile); if (!file) return;
      if (!confirm(`ยืนยันการลบไฟล์ "${file.name}" และข้อมูลที่นำเข้าจากไฟล์นี้ทั้งหมด?`)) return;
      const prev = JSON.stringify(state);
      if (file.type === 'customer_names') state.customerNames = state.customerNames.filter(r => r.fileId !== file.id);
      if (file.type === 'customer_costs') state.customerCosts = state.customerCosts.filter(r => r.fileId !== file.id);
      if (file.type === 'incoming_docs') state.incomingDocs = state.incomingDocs.filter(r => r.fileId !== file.id);
      state.importFiles = state.importFiles.filter(x => x.id !== file.id);
      if (await save()) {
        renderCustomerNames(); renderCustomerCosts(); renderIncomingDocs();
        renderImportFiles(filterType); renderImportFiles(); renderDashboard();
        alert('ลบไฟล์และข้อมูลที่เกี่ยวข้องเรียบร้อย');
      } else { state = JSON.parse(prev); renderImportFiles(filterType); }
    }));
  });
}

// Import
let importRows = [];
function readImportFile() {
  const file = document.getElementById('import-file').files[0];
  if (!file) { alert('เลือกไฟล์ก่อน'); return null; }
  return file;
}
function parseSheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { defval: '' }));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
function renderImportPreview(rows) {
  const view = document.getElementById('import-preview-view');
  if (!rows.length) { view.innerHTML='<p class="muted">ไม่มีข้อมูลในไฟล์</p>'; return; }
  const keys = Object.keys(rows[0]);
  const head = keys.map(k=>`<th>${esc(k)}</th>`).join('');
  const body = rows.slice(0,30).map(r=>`<tr>${keys.map(k=>`<td>${esc(r[k])}</td>`).join('')}</tr>`).join('');
  view.innerHTML = `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div><p class="muted">แสดงตัวอย่าง ${fmtInt(Math.min(30,rows.length))} จาก ${fmtInt(rows.length)} แถว</p>`;
}
document.getElementById('import-preview').addEventListener('click', async () => {
  const file = readImportFile(); if (!file) return;
  try { importRows = await parseSheet(file); renderImportPreview(importRows); document.getElementById('import-msg').textContent = `อ่านได้ ${importRows.length.toLocaleString('th-TH')} แถว`; }
  catch(e){ document.getElementById('import-msg').textContent = 'อ่านไฟล์ไม่สำเร็จ: '+e.message; }
});
document.getElementById('import-run').addEventListener('click', async () => {
  const type = document.getElementById('import-type').value;
  if (!importRows.length) { const file = readImportFile(); if(!file) return; try{ importRows = await parseSheet(file);}catch(e){alert('อ่านไฟล์ไม่สำเร็จ');return;} }
  if (!importRows.length) { alert('ไม่มีข้อมูลให้นำเข้า'); return; }
  const prev = JSON.stringify(state);
  let added = 0;
  try {
    if (type === 'accounts') {
      importRows.forEach(r => {
        const code = String(r.code||r.Code||r['รหัส']||'').trim();
        const name = String(r.name||r.Name||r['ชื่อบัญชี']||'').trim();
        const atype = String(r.type||r.Type||r['ประเภท']||'').trim().toLowerCase();
        if (!code || !name || !TYPES[atype]) return;
        if (state.accounts.some(a=>a.code===code)) return;
        state.accounts.push({id:uid(),code,name,type:atype}); added++;
      });
      state.accounts.sort((a,b)=>a.code.localeCompare(b.code));
    } else if (type === 'customers') {
      importRows.forEach(r => {
        const code = String(r.code||r.Code||r['รหัส']||'').trim();
        const name = String(r.name||r.Name||r['ชื่อ']||'').trim();
        if (!code || !name) return;
        if (state.customers.some(c=>c.code===code)) return;
        state.customers.push({id:uid(),code,name,phone:String(r.phone||r['โทรศัพท์']||'').trim(),tax:String(r.tax||r['เลขผู้เสียภาษี']||'').trim(),address:String(r.address||r['ที่อยู่']||'').trim()}); added++;
      });
    } else if (type === 'customer_names') {
      const fileId = uid();
      const fileName = (document.getElementById('import-file').files[0] || {}).name || 'ไฟล์นำเข้า';
      importRows.forEach(r => {
        const name = String(r['ชื่อลูกค้า'] || r.name || r.Name || r.customer || Object.values(r)[0] || '').trim();
        if (!name) return;
        if (state.customerNames.some(c => (c.name||'') === name && c.fileId === fileId)) return;
        state.customerNames.push({ name, fileId }); added++;
      });
      if (added > 0) state.importFiles.push({ id: fileId, name: fileName, type, count: added, at: new Date().toISOString() });
    } else if (type === 'customer_costs') {
      const fileId = uid();
      const fileName = (document.getElementById('import-file').files[0] || {}).name || 'ไฟล์นำเข้า';
      importRows.forEach(r => {
        const rawDate = r['วันที่'] || r.date || r.Date || '';
        const date = fmtDateDMY(rawDate) || String(rawDate).trim();
        const name = String(r['ชื่อลูกค้า'] || r.name || r.Name || r.customer || '').trim();
        const cost = parseFloat(r['ราคาทุน'] || r.cost || r.Cost || 0) || 0;
        const price = parseFloat(r['ราคาขาย'] || r.price || r.Price || r.sale || 0) || 0;
        if (!name && !date && !cost && !price) return;
        state.customerCosts.push({ date, name, cost, price, fileId }); added++;
      });
      if (added > 0) state.importFiles.push({ id: fileId, name: fileName, type, count: added, at: new Date().toISOString() });
    } else if (type === 'incoming_docs') {
      const fileId = uid();
      const fileName = (document.getElementById('import-file').files[0] || {}).name || 'ไฟล์นำเข้า';
      importRows.forEach(r => {
        const rawDate = r['วันที่'] || r.date || r.Date || '';
        const date = fmtDateDMY(rawDate) || String(rawDate).trim();
        const docType = String(r['ประเภทเอกสาร'] || r.docType || r.type || r.Type || '').trim();
        const supplier = String(r['ซัพพลายเออร์'] || r.supplier || r.Supplier || r.vendor || '').trim();
        const total = parseFloat(r['ยอดรวม'] || r.total || r.Total || r.amount || 0) || 0;
        const discount = parseFloat(r['ส่วนลด'] || r.discount || r.Discount || 0) || 0;
        const payment = String(r['รูปแบบการชำระเงิน'] || r.payment || r.Payment || r['การชำระเงิน'] || '').trim();
        if (!date && !docType && !supplier && !total && !discount && !payment) return;
        state.incomingDocs.push({ date, docType, supplier, total, discount, payment, fileId }); added++;
      });
      if (added > 0) state.importFiles.push({ id: fileId, name: fileName, type, count: added, at: new Date().toISOString() });
    } else if (type === 'receivables') {
      importRows.forEach(r => {
        const ccode = String(r.customerCode||r['รหัสลูกค้า']||'').trim();
        const cust = state.customers.find(c=>c.code===ccode);
        if (!cust) return;
        const amount = parseFloat(r.amount||r['จำนวนเงิน']||0)||0;
        if (amount <= 0) return;
        state.receivables.push({id:uid(),customerId:cust.id,docNo:String(r.doc||r.docNo||r['เลขที่']||'').trim()||('IMP-'+uid()),date:String(r.date||r['วันที่']||'').slice(0,10),due:String(r.due||r['ครบกำหนด']||'').slice(0,10),amount,paid:parseFloat(r.paid||r['ชำระแล้ว']||0)||0,note:String(r.note||r['หมายเหตุ']||'').trim()}); added++;
      });
    } else if (type === 'journal') {
      const groups = new Map();
      importRows.forEach((r,i) => {
        const date = String(r.date||r['วันที่']||'').slice(0,10);
        const desc = String(r.desc||r.description||r['คำอธิบาย']||'').trim();
        const acode = String(r.accountCode||r.code||r['รหัสบัญชี']||'').trim();
        const debit = parseFloat(r.debit||r['เดบิต']||0)||0;
        const credit = parseFloat(r.credit||r['เครดิต']||0)||0;
        const acc = state.accounts.find(a=>a.code===acode);
        if (!acc || (!debit && !credit)) return;
        const key = `${date}|${desc}|${r.group||r.ref||r['อ้างอิง']||i}`;
        if (!groups.has(key)) groups.set(key,{date,desc,lines:[]});
        groups.get(key).lines.push({accountId:acc.id,debit,credit});
      });
      groups.forEach(g => {
        if (g.lines.length < 1) return;
        const d=g.lines.reduce((s,l)=>s+l.debit,0), c=g.lines.reduce((s,l)=>s+l.credit,0);
        if (Math.abs(d-c) > 0.005 || d===0) return;
        state.entries.push({id:uid(),date:g.date,desc:g.desc,lines:g.lines}); added++;
      });
      state.entries.sort((a,b)=>(a.date||'').localeCompare(b.date||'')||a.id.localeCompare(b.id));
    }
    if (await save()) { document.getElementById('import-msg').textContent = `นำเข้าสำเร็จ ${fmtInt(added)} รายการ`; renderAccounts(); renderJournal(); renderCustomers(); renderCustomerNames(); renderCustomerCosts(); renderIncomingDocs(); renderImportFiles(); renderImportFiles('customer_names'); renderImportFiles('customer_costs'); renderImportFiles('incoming_docs'); renderCustomerOptions(); renderReceivables(); renderAutoDesc(); renderDashboard(); alert(`นำเข้าข้อมูลเรียบร้อย (${fmtInt(added)} รายการ)`); }
    else { state = JSON.parse(prev); }
  } catch(e) { state = JSON.parse(prev); document.getElementById('import-msg').textContent = 'นำเข้าไม่สำเร็จ: '+e.message; }
});

// Settings
document.getElementById('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!confirm('ยืนยันการบันทึกการตั้งค่า?')) return;
  const prev = JSON.stringify(state);
  state.settings = {
    company: document.getElementById('set-company').value.trim(),
    periodStart: document.getElementById('set-period-start').value,
    periodEnd: document.getElementById('set-period-end').value,
    currency: document.getElementById('set-currency').value.trim() || 'THB',
    note: document.getElementById('set-note').value.trim()
  };
  if (await save()) { alert('บันทึกการตั้งค่าเรียบร้อย'); renderDashboard(); } else state = JSON.parse(prev);
});
function renderSettings() {
  const s = state.settings || {};
  document.getElementById('set-company').value = s.company||'';
  document.getElementById('set-period-start').value = s.periodStart||'';
  document.getElementById('set-period-end').value = s.periodEnd||'';
  document.getElementById('set-currency').value = s.currency||'THB';
  document.getElementById('set-note').value = s.note||'';
}

// Customer names (simple list) edit
let editingCNameIndex = null;
function resetCNameForm() { editingCNameIndex = null; const f = document.getElementById('cname-form'); if(f) f.reset(); const s=document.getElementById('cname-submit'); if(s) s.textContent='เพิ่มชื่อ'; const c=document.getElementById('cname-cancel'); if(c) c.hidden=true; }
const cnameForm = document.getElementById('cname-form');
if (cnameForm) {
  document.getElementById('cname-cancel').addEventListener('click', () => { resetCNameForm(); alert('ยกเลิกการแก้ไขรายชื่อลูกค้าแล้ว'); });
  cnameForm.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('cname-input').value.trim(); if(!name) return;
    const isEdit = editingCNameIndex != null && !!state.customerNames[editingCNameIndex];
    if (isEdit && !confirm('ยืนยันการแก้ไขรายชื่อลูกค้า?')) return;
    const prev = JSON.stringify(state);
    if (isEdit) {
      state.customerNames[editingCNameIndex].name = name;
    } else {
      state.customerNames.push({ name, fileId: null });
    }
    if (await save()) { resetCNameForm(); renderCustomerNames(); alert(isEdit ? 'แก้ไขรายชื่อลูกค้าเรียบร้อย' : 'เพิ่มรายชื่อลูกค้าเรียบร้อย'); } else { state = JSON.parse(prev); renderCustomerNames(); }
  });
}

// Init
(async function init() {
  document.getElementById('je-date').valueAsDate = new Date();
  const arDate = document.getElementById('ar-date'); if (arDate) arDate.valueAsDate = new Date();
  await load();
  renderAccounts();
  resetJournalLines();
  renderJournal();
  renderLedgerSelect();
  renderCustomers();
  renderCustomerNames();
  renderCustomerCosts();
  renderIncomingDocs();
  renderImportFiles();
  renderImportFiles('customer_names');
  renderImportFiles('customer_costs');
  renderImportFiles('incoming_docs');
  renderCustomerOptions();
  renderReceivables();
  renderAutoDesc();
  renderAutoDescDatalist();
  renderDashboard();
  renderSettings();
  let startTab = 'dashboard';
  try { const saved = localStorage.getItem('active_tab'); if (saved && document.getElementById(saved)) startTab = saved; } catch {}
  activateTab(startTab);
})();

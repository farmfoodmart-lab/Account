/**
 * @file โครงหน้าแอปที่ใช้ร่วมกันทุกหน้า
 *
 * - เมนูด้านข้างแบ่งกลุ่ม (บนมือถือเป็นลิ้นชักเปิด/ปิด)
 * - สถานะการเชื่อมต่อ ปุ่มสลับธีม และปุ่มออกจากระบบ
 * - กระดิ่งแจ้งเตือนข้างชื่อระบบ: เก็บข้อผิดพลาด/สิ่งผิดปกติที่เคยแจ้ง (บันทึกโดย logAlert ใน notifications.js)
 * - กล่องค้นหาเมนูและคำสั่ง (Ctrl/⌘ + K)
 * - ตัวกรองตารางทั่วไป: ใส่ <input data-table-filter="#id-ตาราง"> ในหน้า HTML ก็ใช้ได้ทันที
 * - โหลดหน้าถัดไปล่วงหน้าเมื่อชี้เมาส์ที่เมนู เพื่อให้เปลี่ยนหน้าได้ทันที
 *
 * ไฟล์นี้เป็นสคริปต์ธรรมดา (ไม่ใช่ module) วางไว้ต้น <body>
 * จึงทำงานก่อนสคริปต์ของหน้า และเมนูแสดงผลพร้อมกับการวาดหน้าครั้งแรก (ไม่กะพริบ)
 */
(() => {
  /** โครงสร้างเมนู: id ตรงกับชื่อโฟลเดอร์ใน pages/ และ keywords ใช้ค้นหาในกล่องคำสั่ง */
  const NAVIGATION = [
    { group: "ภาพรวม", items: [
      { id: "dashboard", label: "แดชบอร์ด", icon: "home", keywords: "dashboard ภาพรวม" },
    ] },
    { group: "บันทึกบัญชี", items: [
      { id: "journal", label: "สมุดรายวันทั่วไป", icon: "book", keywords: "journal บันทึกรายการ รายวัน" },
      { id: "receivables", label: "ลูกหนี้", icon: "receipt", keywords: "receivable ลูกหนี้ ค้างชำระ ขายเชื่อ" },
      { id: "payables", label: "เจ้าหนี้", icon: "wallet", keywords: "payable เจ้าหนี้ ซื้อเชื่อ ค้างจ่าย" },
      { id: "autodesc", label: "คำอธิบายอัตโนมัติ", icon: "wand", keywords: "auto template แม่แบบ" },
    ] },
    { group: "สมุดบัญชีและงบการเงิน", items: [
      { id: "ledger", label: "บัญชีแยกประเภท", icon: "layers", keywords: "ledger แยกประเภท" },
      { id: "trial", label: "งบทดลอง", icon: "scale", keywords: "trial balance งบทดลอง" },
      { id: "worksheet", label: "กระดาษทำการ", icon: "grid", keywords: "worksheet กระดาษทำการ" },
      { id: "reports", label: "งบการเงิน", icon: "chart", keywords: "report งบกำไรขาดทุน งบดุล ฐานะการเงิน" },
      { id: "vat", label: "ภาษีซื้อ-ภาษีขาย", icon: "percent", keywords: "vat ภาษี ภพ30 ภาษีซื้อ ภาษีขาย" },
    ] },
    { group: "ข้อมูลหลัก", items: [
      { id: "accounts", label: "ผังบัญชี", icon: "list", keywords: "accounts chart หมวดหมู่บัญชี ผังบัญชี" },
      { id: "customers", label: "รายชื่อลูกค้า", icon: "users", keywords: "customers ลูกค้า" },
      // รวมหน้า "รายชื่อเจ้าหนี้" (suppliers) ไว้ในหน้านี้แล้ว
      { id: "vendors", label: "รายชื่อซัพพลายเออร์", icon: "truck", keywords: "vendors suppliers creditors ซัพพลายเออร์ ผู้ขาย เจ้าหนี้ รายชื่อเจ้าหนี้" },
    ] },
    { group: "ข้อมูลนำเข้า", items: [
      { id: "import", label: "นำเข้าไฟล์ Excel", icon: "upload", keywords: "import excel นำเข้า" },
      { id: "incoming-docs", label: "เอกสารรับเข้า", icon: "inbox", keywords: "incoming เอกสาร ซัพพลายเออร์" },
    ] },
    { group: "ระบบ", items: [
      { id: "settings", label: "การตั้งค่า", icon: "gear", keywords: "settings ตั้งค่า สำรอง backup ปิดงวด" },
    ] },
  ];

  /** ไอคอนเส้น (SVG path) ขนาด 24x24 */
  const ICON_PATHS = {
    contacts: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7.5 17a4.5 4.5 0 0 1 9 0"/><path d="M2 8h2M2 12h2M2 16h2"/>',
    truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/><path d="M9 7h7M9 11h5"/>',
    receipt: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V6a2 2 0 0 1 2-2h11v3"/><circle cx="16.5" cy="13.5" r="1.2"/>',
    wand: '<path d="m15 4 5 5L9 20H4v-5z"/><path d="m13 6 5 5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    scale: '<path d="M12 3v18M5 21h14"/><path d="M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0z"/><path d="m19 7-3 7a3 3 0 0 0 6 0z"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15v2M11 11v6M15 7v10M19 12v5"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    // ไอคอนนำเข้า: ลูกศรชี้ลงสู่ถาด (เหมือนกล่องลากไฟล์ในหน้านำเข้า)
    upload: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 16v4h16v-4"/>',
    tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };

  /**
   * HTML ของไอคอน (ใช้ได้จากหน้าอื่นผ่าน window.AppIcon)
   * @param {string} iconName
   */
  function renderIcon(iconName) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[iconName] || ""}</svg>`;
  }
  window.AppIcon = renderIcon;

  /** หน้าปัจจุบัน จาก URL /pages/<id>/<id>.html */
  function getCurrentPageId() {
    const match = location.pathname.match(/\/pages\/([^/]+)\//);
    return match ? decodeURIComponent(match[1]) : "dashboard";
  }

  const getPageUrl = (pageId) => `../${pageId}/${pageId}.html`;

  const currentPageId = getCurrentPageId();
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  const shortcutModifier = isMac ? "⌘" : "Ctrl";
  const byId = (elementId) => document.getElementById(elementId);

  /* ---------------------------------------------------------------- */
  /* เมนูด้านข้าง                                                       */
  /* ---------------------------------------------------------------- */

  const navigationHtml = NAVIGATION.map((section) => {
    const links = section.items.map((item) => {
      const activeAttributes = item.id === currentPageId ? ' class="active" aria-current="page"' : "";
      return `<a href="${getPageUrl(item.id)}"${activeAttributes}>${renderIcon(item.icon)}<span>${item.label}</span></a>`;
    }).join("");
    return `<div class="nav-section"><div class="nav-group">${section.group}</div>${links}</div>`;
  }).join("");

  const alertBellHtml = `<button type="button" class="icon-btn alert-bell" data-alert-bell title="การแจ้งเตือนที่ผิดปกติ" aria-label="การแจ้งเตือนที่ผิดปกติ" aria-haspopup="true" aria-expanded="false">${renderIcon("bell")}<span class="alert-badge" hidden></span></button>`;

  const shellHtml = `
    <div class="topbar">
      <button type="button" class="icon-btn" id="nav-open" aria-label="เปิดเมนู">${renderIcon("menu")}</button>
      <a class="brand brand-compact" href="${getPageUrl("dashboard")}"><img class="brand-mark" src="../../src/assets/app-icon.svg" alt=""><span>ระบบบัญชีคู่</span></a>
      <span class="topbar-actions">${alertBellHtml}<button type="button" class="icon-btn" data-open-palette aria-label="ค้นหาเมนู">${renderIcon("search")}</button></span>
    </div>
    <aside class="sidebar" id="sidebar" aria-label="เมนูหลัก">
      <div class="sidebar-head">
        <a class="brand" href="${getPageUrl("dashboard")}"><img class="brand-mark" src="../../src/assets/app-icon.svg" alt=""><span class="brand-text"><strong>ระบบบัญชีคู่</strong><small id="brand-company">Double-entry Accounting</small></span></a>
        ${alertBellHtml}
        <button type="button" class="icon-btn sidebar-close" id="nav-close" aria-label="ปิดเมนู">${renderIcon("close")}</button>
      </div>
      <button type="button" class="search-trigger" data-open-palette>${renderIcon("search")}<span>ค้นหาเมนู / คำสั่ง</span><kbd>${shortcutModifier} K</kbd></button>
      <a class="new-entry-button" href="${getPageUrl("journal")}#new">${renderIcon("plus")}<span>บันทึกรายการใหม่</span></a>
      <nav id="main-nav" aria-label="เมนูหลัก">${navigationHtml}</nav>
      <div class="sidebar-foot">
        <div class="sidebar-user">
          <span id="user-email" class="user-email"></span>
          <button type="button" id="logout-button" class="icon-btn" title="ออกจากระบบ" aria-label="ออกจากระบบ">${renderIcon("logout")}</button>
        </div>
        <div class="sidebar-status">
          <span id="status" class="status-pill" data-state="busy">กำลังเชื่อมต่อ...</span>
          <button type="button" id="theme-toggle" class="icon-btn" aria-pressed="false"></button>
        </div>
      </div>
    </aside>
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>`;

  document.body.classList.add("app");
  document.body.insertAdjacentHTML("afterbegin", shellHtml);
  if (!byId("toasts")) {
    document.body.insertAdjacentHTML("beforeend", '<div id="toasts" class="toasts" aria-live="polite"></div>');
  }

  // เปิดไฟล์ตรง ๆ (file://) เบราว์เซอร์จะบล็อก ES Modules ทำให้ระบบค้างที่ "กำลังเชื่อมต่อ..." — แจ้งให้ชัดเจนแทน
  if (location.protocol === "file:") {
    const message = "เปิดไฟล์โดยตรงไม่ได้ — กรุณาเปิดผ่านทางลัด \"Accounting\" บนเดสก์ท็อป (สร้างได้ด้วย ติดตั้งทางลัด.bat)";
    const statusElement = byId("status");
    statusElement.textContent = "เปิดผิดวิธี";
    statusElement.title = message;
    statusElement.dataset.state = "error";
    statusElement.classList.add("error");
    document.addEventListener("DOMContentLoaded", () => {
      const main = byId("main");
      if (main) main.insertAdjacentHTML("afterbegin", `<div class="card" role="alert" style="border-color:var(--danger);color:var(--danger);margin-bottom:16px">${message}</div>`);
    });
  }

  /* ---------------------------------------------------------------- */
  /* ปุ่มธีม และออกจากระบบ                                               */
  /* ---------------------------------------------------------------- */

  const themeButton = byId("theme-toggle");
  function updateThemeButton() {
    const isDark = window.AppTheme && window.AppTheme.get() === "dark";
    themeButton.innerHTML = renderIcon(isDark ? "sun" : "moon");
    themeButton.setAttribute("aria-pressed", String(isDark));
    themeButton.setAttribute("aria-label", isDark ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด");
    themeButton.title = isDark ? "โหมดสว่าง" : "โหมดมืด";
  }
  updateThemeButton();
  themeButton.addEventListener("click", () => window.AppTheme && window.AppTheme.toggle());
  document.addEventListener("app-theme-change", updateThemeButton);

  // window.AppAuth ถูกกำหนดโดย src/core/auth.js (module) ซึ่งโหลดหลังไฟล์นี้
  const logOut = () => window.AppAuth && window.AppAuth.logOut();
  byId("logout-button").addEventListener("click", logOut);

  /* ---------------------------------------------------------------- */
  /* เปลี่ยนหน้าได้ทันที                                                  */
  /* หน้าแสดงข้อมูลจากแคชในเครื่องได้ทันทีอยู่แล้ว ส่วนนี้ช่วยโหลดไฟล์ของหน้าถัดไปล่วงหน้า */
  /* ---------------------------------------------------------------- */

  function setupPagePreloading() {
    // Chromium (Chrome/Edge): prerender ทั้งหน้าเมื่อชี้เมาส์ค้างที่ลิงก์
    if (HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules")) {
      const speculationRules = document.createElement("script");
      speculationRules.type = "speculationrules";
      speculationRules.textContent = JSON.stringify({
        prerender: [{
          source: "document",
          where: { and: [{ selector_matches: "#main-nav a, .quick-action, a.btn" }, { not: { href_matches: "*/login/*" } }] },
          eagerness: "moderate",
        }],
        prefetch: [{ source: "document", where: { selector_matches: "#main-nav a" }, eagerness: "conservative" }],
      });
      document.head.appendChild(speculationRules);
      return;
    }
    // เบราว์เซอร์อื่น: prefetch ไฟล์ HTML ของหน้าที่ชี้เมาส์
    const prefetchedUrls = new Set();
    document.addEventListener("pointerover", (event) => {
      const link = event.target.closest && event.target.closest("#main-nav a, .quick-action");
      if (!link || prefetchedUrls.has(link.href)) return;
      prefetchedUrls.add(link.href);
      const prefetchHint = document.createElement("link");
      prefetchHint.rel = "prefetch";
      prefetchHint.href = link.href;
      document.head.appendChild(prefetchHint);
    });
  }
  setupPagePreloading();

  /* ---------------------------------------------------------------- */
  /* ลิ้นชักเมนูบนมือถือ                                                  */
  /* ---------------------------------------------------------------- */

  const setMenuDrawerOpen = (isOpen) => document.body.classList.toggle("nav-open", isOpen);
  byId("nav-open").addEventListener("click", () => setMenuDrawerOpen(true));
  byId("nav-close").addEventListener("click", () => setMenuDrawerOpen(false));
  byId("sidebar-backdrop").addEventListener("click", () => setMenuDrawerOpen(false));

  /* ---------------------------------------------------------------- */
  /* กล่องค้นหาเมนูและคำสั่ง (Command palette)                            */
  /* ---------------------------------------------------------------- */

  const QUICK_COMMANDS = [
    { label: "บันทึกรายการบัญชีใหม่", icon: "plus", keywords: "new entry เพิ่ม บันทึก", href: `${getPageUrl("journal")}#new` },
    { label: "บันทึกขายเชื่อ / ซื้อเชื่อ (สมุดรายวัน)", icon: "receipt", keywords: "new receivable payable ขายเชื่อ ซื้อเชื่อ ลูกหนี้ เจ้าหนี้", href: `${getPageUrl("journal")}#new` },
    { label: "ออกจากระบบ", icon: "logout", keywords: "logout sign out ออก", run: logOut },
    { label: "สลับโหมดสว่าง/มืด", icon: "moon", keywords: "theme dark light ธีม", run: () => window.AppTheme && window.AppTheme.toggle() },
  ].map((command) => ({ ...command, group: "คำสั่งด่วน" }));

  const NAVIGATION_COMMANDS = NAVIGATION.flatMap((section) => section.items.map((item) => ({
    label: item.label,
    group: section.group,
    icon: item.icon,
    keywords: item.keywords,
    href: getPageUrl(item.id),
  })));

  const ALL_COMMANDS = [...QUICK_COMMANDS, ...NAVIGATION_COMMANDS];

  /** @type {HTMLDialogElement | null} สร้างเมื่อเปิดครั้งแรก */
  let paletteDialog = null;
  let highlightedIndex = 0;
  let matchingCommands = [];

  function createPaletteDialog() {
    paletteDialog = document.createElement("dialog");
    paletteDialog.className = "command-palette";
    paletteDialog.setAttribute("aria-label", "ค้นหาเมนูและคำสั่ง");
    paletteDialog.innerHTML = `
      <div class="command-palette-search">${renderIcon("search")}<input type="text" placeholder="พิมพ์เพื่อค้นหาเมนูหรือคำสั่ง..." aria-label="ค้นหา" autocomplete="off"><kbd>Esc</kbd></div>
      <ul class="command-palette-list" role="listbox"></ul>
      <div class="command-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> เลือก</span><span><kbd>Enter</kbd> เปิด</span><span><kbd>${shortcutModifier} K</kbd> เปิด/ปิด</span></div>`;
    document.body.appendChild(paletteDialog);

    const searchInput = paletteDialog.querySelector("input");
    searchInput.addEventListener("input", () => {
      highlightedIndex = 0;
      renderCommandList(searchInput.value);
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        highlightedIndex = Math.min(matchingCommands.length - 1, highlightedIndex + 1);
        updateHighlight();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        highlightedIndex = Math.max(0, highlightedIndex - 1);
        updateHighlight();
      } else if (event.key === "Enter") {
        event.preventDefault();
        runCommand(matchingCommands[highlightedIndex]);
      }
    });
    paletteDialog.addEventListener("click", (event) => {
      if (event.target === paletteDialog) paletteDialog.close(); // คลิกพื้นหลัง = ปิด
      const commandItem = event.target.closest("[data-command-index]");
      if (commandItem) runCommand(matchingCommands[Number(commandItem.dataset.commandIndex)]);
    });
  }

  function renderCommandList(query) {
    const searchText = String(query || "").trim().toLowerCase();
    matchingCommands = ALL_COMMANDS.filter((command) =>
      !searchText || `${command.label} ${command.group} ${command.keywords || ""}`.toLowerCase().includes(searchText));

    const list = paletteDialog.querySelector(".command-palette-list");
    if (!matchingCommands.length) {
      list.innerHTML = '<li class="command-palette-empty">ไม่พบเมนูที่ค้นหา</li>';
      return;
    }
    let previousGroup = "";
    list.innerHTML = matchingCommands.map((command, index) => {
      const groupHeader = command.group !== previousGroup ? `<li class="command-palette-group">${command.group}</li>` : "";
      previousGroup = command.group;
      return `${groupHeader}<li role="option" data-command-index="${index}">${renderIcon(command.icon)}<span>${command.label}</span></li>`;
    }).join("");
    updateHighlight();
  }

  function updateHighlight() {
    paletteDialog.querySelectorAll("[data-command-index]").forEach((item) => {
      const isHighlighted = Number(item.dataset.commandIndex) === highlightedIndex;
      item.classList.toggle("is-active", isHighlighted);
      item.setAttribute("aria-selected", String(isHighlighted));
      if (isHighlighted) item.scrollIntoView({ block: "nearest" });
    });
  }

  function runCommand(command) {
    if (!command) return;
    paletteDialog.close();
    if (command.run) {
      command.run();
      return;
    }
    // ลิงก์ไปหน้าเดียวกันที่มี #hash (เช่น #new): แจ้งหน้าแทนการโหลดใหม่
    const targetUrl = new URL(command.href, location.href);
    if (targetUrl.pathname === location.pathname && targetUrl.hash) {
      location.hash = targetUrl.hash;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
      location.href = command.href;
    }
  }

  function togglePalette() {
    if (!paletteDialog) createPaletteDialog();
    if (paletteDialog.open) {
      paletteDialog.close();
      return;
    }
    highlightedIndex = 0;
    const searchInput = paletteDialog.querySelector("input");
    searchInput.value = "";
    renderCommandList("");
    paletteDialog.showModal();
    searchInput.focus();
  }

  document.querySelectorAll("[data-open-palette]").forEach((button) => button.addEventListener("click", togglePalette));
  document.addEventListener("keydown", (event) => {
    const key = (event.key || "").toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "k") {
      event.preventDefault();
      setMenuDrawerOpen(false);
      togglePalette();
    } else if (key === "escape" && document.body.classList.contains("nav-open")) {
      setMenuDrawerOpen(false);
    }
  });

  /* ---------------------------------------------------------------- */
  /* ตัวกรองตารางทั่วไป                                                   */
  /* <input data-table-filter="#customers-table" data-filter-count="#customers-count"> */
  /* ---------------------------------------------------------------- */

  function applyTableFilter(searchInput) {
    const table = document.querySelector(searchInput.dataset.tableFilter);
    if (!table || !table.tBodies[0]) return;
    const searchText = searchInput.value.trim().toLowerCase();
    let matchedCount = 0;
    let totalCount = 0;
    [...table.tBodies[0].rows].forEach((row) => {
      if (row.cells.length <= 1) return; // แถวข้อความ "ยังไม่มีข้อมูล"
      totalCount += 1;
      const isMatch = !searchText || row.textContent.toLowerCase().includes(searchText);
      row.hidden = !isMatch;
      if (isMatch) matchedCount += 1;
    });

    const counter = searchInput.dataset.filterCount ? document.querySelector(searchInput.dataset.filterCount) : null;
    if (counter) {
      counter.textContent = searchText
        ? `พบ ${matchedCount.toLocaleString("th-TH")} จาก ${totalCount.toLocaleString("th-TH")} รายการ`
        : `ทั้งหมด ${totalCount.toLocaleString("th-TH")} รายการ`;
    }
  }

  function setupTableFilters() {
    document.querySelectorAll("input[data-table-filter]").forEach((searchInput) => {
      const table = document.querySelector(searchInput.dataset.tableFilter);
      if (!table || !table.tBodies[0]) return;
      searchInput.addEventListener("input", () => applyTableFilter(searchInput));
      // หน้าวาดตารางใหม่เมื่อไร ให้กรองใหม่อัตโนมัติ
      new MutationObserver(() => applyTableFilter(searchInput)).observe(table.tBodies[0], { childList: true });
      applyTableFilter(searchInput);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupTableFilters);
  else setupTableFilters();

  /* ---------------------------------------------------------------- */
  /* กระดิ่งการแจ้งเตือนที่ผิดปกติ                                         */
  /* ข้อมูลเก็บใน localStorage "app_alerts" (เขียนโดย logAlert ใน notifications.js) */
  /* ---------------------------------------------------------------- */

  const ALERT_STORAGE_KEY = "app_alerts";
  const ALERT_CHANGED_EVENT = "app-alerts-changed";

  function readAlerts() {
    try {
      const alerts = JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY) || "[]");
      return Array.isArray(alerts) ? alerts : [];
    } catch {
      return [];
    }
  }

  function writeAlerts(alerts) {
    try {
      localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alerts));
    } catch {
      // เขียนไม่ได้ → ข้าม
    }
    renderAlertBadges();
  }

  const escapeText = (text) => String(text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  /** เวลาเป็น วว/ดด/ปปปป ชช:นน */
  function formatAlertTime(timestamp) {
    const date = new Date(timestamp);
    const pad = (number) => String(number).padStart(2, "0");
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /** ตัวเลขสีแดงบนกระดิ่ง = จำนวนที่ยังไม่ได้อ่าน */
  function renderAlertBadges() {
    const unreadCount = readAlerts().filter((alert) => !alert.read).length;
    document.querySelectorAll("[data-alert-bell]").forEach((bell) => {
      const badge = bell.querySelector(".alert-badge");
      badge.hidden = unreadCount === 0;
      badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      bell.classList.toggle("has-unread", unreadCount > 0);
      bell.title = unreadCount ? `การแจ้งเตือนที่ผิดปกติ (ยังไม่ได้อ่าน ${unreadCount})` : "การแจ้งเตือนที่ผิดปกติ";
    });
  }

  let alertPanel = null;
  let alertPanelAnchor = null;

  function renderAlertPanel() {
    const alerts = readAlerts();
    const itemsHtml = alerts.length
      ? alerts.map((alert) => `<li class="alert-item${alert.read ? "" : " is-unread"}">
          <div class="alert-item-head">
            <strong>${escapeText(alert.title || "แจ้งเตือน")}${alert.count > 1 ? ` <span class="alert-count">×${alert.count}</span>` : ""}</strong>
            <button type="button" class="alert-remove" data-remove-alert="${escapeText(alert.id)}" aria-label="ลบรายการนี้" title="ลบรายการนี้">×</button>
          </div>
          <p>${escapeText(alert.message)}</p>
          <small>${formatAlertTime(alert.time)}${alert.page ? ` · <a href="${escapeText(alert.page)}">${escapeText(alert.pageTitle || "เปิดหน้า")}</a>` : ""}</small>
        </li>`).join("")
      : '<li class="alert-empty">ไม่มีการแจ้งเตือนที่ผิดปกติ</li>';
    alertPanel.innerHTML = `
      <div class="alert-panel-head"><strong>การแจ้งเตือนที่ผิดปกติ</strong>
        ${alerts.length ? '<button type="button" class="ghost small" data-clear-alerts>ล้างทั้งหมด</button>' : ""}</div>
      <ul class="alert-list">${itemsHtml}</ul>`;
  }

  function positionAlertPanel() {
    if (!alertPanel || !alertPanelAnchor) return;
    const rect = alertPanelAnchor.getBoundingClientRect();
    const panelWidth = Math.min(360, window.innerWidth - 16);
    alertPanel.style.width = `${panelWidth}px`;
    alertPanel.style.top = `${Math.round(rect.bottom + 6)}px`;
    alertPanel.style.left = `${Math.round(Math.min(Math.max(8, rect.left), window.innerWidth - panelWidth - 8))}px`;
  }

  function closeAlertPanel() {
    if (!alertPanel) return;
    alertPanel.remove();
    alertPanel = null;
    document.querySelectorAll("[data-alert-bell]").forEach((bell) => bell.setAttribute("aria-expanded", "false"));
    alertPanelAnchor = null;
  }

  function openAlertPanel(bell) {
    closeAlertPanel();
    alertPanelAnchor = bell;
    alertPanel = document.createElement("div");
    alertPanel.className = "alert-panel";
    alertPanel.setAttribute("role", "dialog");
    alertPanel.setAttribute("aria-label", "การแจ้งเตือนที่ผิดปกติ");
    renderAlertPanel();
    document.body.appendChild(alertPanel);
    positionAlertPanel();
    bell.setAttribute("aria-expanded", "true");
    // เปิดดูแล้ว = อ่านแล้ว (รายการยังอยู่จนกว่าจะลบ)
    writeAlerts(readAlerts().map((alert) => ({ ...alert, read: true })));

    alertPanel.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-alert]");
      if (removeButton) {
        writeAlerts(readAlerts().filter((alert) => alert.id !== removeButton.dataset.removeAlert));
        renderAlertPanel();
      } else if (event.target.closest("[data-clear-alerts]")) {
        writeAlerts([]);
        renderAlertPanel();
      }
    });
  }

  document.addEventListener("click", (event) => {
    const bell = event.target.closest("[data-alert-bell]");
    if (bell) {
      event.preventDefault();
      if (alertPanel && alertPanelAnchor === bell) closeAlertPanel();
      else openAlertPanel(bell);
      return;
    }
    // ใช้ composedPath เพราะปุ่มในแผงอาจถูกวาดใหม่ (หลุดจาก DOM) ก่อนอีเวนต์มาถึงตรงนี้
    if (alertPanel && !event.composedPath().includes(alertPanel)) closeAlertPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAlertPanel();
  });
  window.addEventListener("resize", positionAlertPanel);
  window.addEventListener(ALERT_CHANGED_EVENT, () => {
    renderAlertBadges();
    if (alertPanel) renderAlertPanel();
  });
  // แท็บอื่นเพิ่ม/ลบการแจ้งเตือน → อัปเดตตาม
  window.addEventListener("storage", (event) => {
    if (event.key === ALERT_STORAGE_KEY) renderAlertBadges();
  });
  renderAlertBadges();
})();

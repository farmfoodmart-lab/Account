/**
 * App shell shared by every page: grouped sidebar navigation, mobile drawer,
 * connection status, theme toggle, command palette (Ctrl+K) and a generic
 * client-side table filter (<input data-table-filter="#table-id">).
 *
 * Loaded as a classic script at the top of <body> so the shell renders before
 * the page module runs and before the first paint.
 */
(function () {
  var NAV = [
    { group: "ภาพรวม", items: [
      { id: "dashboard", label: "แดชบอร์ด", icon: "home", keys: "dashboard ภาพรวม" },
    ] },
    { group: "บันทึกบัญชี", items: [
      { id: "journal", label: "สมุดรายวันทั่วไป", icon: "book", keys: "journal บันทึกรายการ รายวัน" },
      { id: "receivables", label: "ลูกหนี้", icon: "receipt", keys: "receivable ลูกหนี้ ค้างชำระ ขายเชื่อ" },
      { id: "payables", label: "เจ้าหนี้", icon: "wallet", keys: "payable เจ้าหนี้ ซื้อเชื่อ ค้างจ่าย" },
      { id: "autodesc", label: "คำอธิบายอัตโนมัติ", icon: "wand", keys: "auto template แม่แบบ" },
    ] },
    { group: "สมุดบัญชีและงบการเงิน", items: [
      { id: "ledger", label: "บัญชีแยกประเภท", icon: "layers", keys: "ledger แยกประเภท" },
      { id: "trial", label: "งบทดลอง", icon: "scale", keys: "trial balance งบทดลอง" },
      { id: "worksheet", label: "กระดาษทำการ", icon: "grid", keys: "worksheet กระดาษทำการ" },
      { id: "reports", label: "งบการเงิน", icon: "chart", keys: "report งบกำไรขาดทุน งบดุล ฐานะการเงิน" },
      { id: "vat", label: "ภาษีซื้อ-ภาษีขาย", icon: "percent", keys: "vat ภาษี ภพ30 ภาษีซื้อ ภาษีขาย" },
    ] },
    { group: "ข้อมูลหลัก", items: [
      { id: "accounts", label: "ผังบัญชี", icon: "list", keys: "accounts chart หมวดหมู่บัญชี ผังบัญชี" },
      { id: "customers", label: "รายชื่อลูกค้า", icon: "users", keys: "customers ลูกค้า" },
    ] },
    { group: "ข้อมูลนำเข้า", items: [
      { id: "import", label: "นำเข้าไฟล์ Excel", icon: "upload", keys: "import excel นำเข้า" },
      { id: "customer-costs", label: "ต้นทุน/ขายลูกค้า", icon: "tag", keys: "cost ต้นทุน ราคาขาย" },
      { id: "incoming-docs", label: "เอกสารรับเข้า", icon: "inbox", keys: "incoming เอกสาร ซัพพลายเออร์" },
    ] },
    { group: "ระบบ", items: [
      { id: "settings", label: "การตั้งค่า", icon: "gear", keys: "settings ตั้งค่า สำรอง backup" },
    ] },
  ];

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/><path d="M9 7h7M9 11h5"/>',
    receipt: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    wand: '<path d="m15 4 5 5L9 20H4v-5z"/><path d="m13 6 5 5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    scale: '<path d="M12 3v18M5 21h14"/><path d="M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0z"/><path d="m19 7-3 7a3 3 0 0 0 6 0z"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15v2M11 11v6M15 7v10M19 12v5"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V6a2 2 0 0 1 2-2h11v3"/><circle cx="16.5" cy="13.5" r="1.2"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };

  function icon(name) {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }
  window.AppIcon = icon;

  function currentPageId() {
    var match = location.pathname.match(/\/pages\/([^/]+)\//);
    return match ? decodeURIComponent(match[1]) : "dashboard";
  }

  function hrefFor(id) {
    return "../" + id + "/" + id + ".html";
  }

  var pageId = currentPageId();
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  var modKey = isMac ? "⌘" : "Ctrl";

  /* ---------- sidebar ---------- */
  var navHtml = NAV.map(function (section) {
    return '<div class="nav-section"><div class="nav-group">' + section.group + "</div>" +
      section.items.map(function (item) {
        var active = item.id === pageId;
        return '<a href="' + hrefFor(item.id) + '"' + (active ? ' class="active" aria-current="page"' : "") + ">" +
          icon(item.icon) + "<span>" + item.label + "</span></a>";
      }).join("") + "</div>";
  }).join("");

  var shellHtml =
    '<div class="topbar">' +
      '<button type="button" class="icon-btn" id="nav-open" aria-label="เปิดเมนู">' + icon("menu") + "</button>" +
      '<a class="brand brand-compact" href="' + hrefFor("dashboard") + '"><span class="brand-mark">฿</span><span>ระบบบัญชีคู่</span></a>' +
      '<button type="button" class="icon-btn" data-open-palette aria-label="ค้นหาเมนู">' + icon("search") + "</button>" +
    "</div>" +
    '<aside class="sidebar" id="sidebar" aria-label="เมนูหลัก">' +
      '<div class="sidebar-head">' +
        '<a class="brand" href="' + hrefFor("dashboard") + '"><span class="brand-mark">฿</span><span class="brand-text"><strong>ระบบบัญชีคู่</strong><small id="brand-company">Double-entry Accounting</small></span></a>' +
        '<button type="button" class="icon-btn sidebar-close" id="nav-close" aria-label="ปิดเมนู">' + icon("close") + "</button>" +
      "</div>" +
      '<button type="button" class="search-trigger" data-open-palette>' + icon("search") + "<span>ค้นหาเมนู / คำสั่ง</span><kbd>" + modKey + " K</kbd></button>" +
      '<a class="new-entry-btn" href="' + hrefFor("journal") + '#new">' + icon("plus") + "<span>บันทึกรายการใหม่</span></a>" +
      '<nav id="main-nav" aria-label="เมนูหลัก">' + navHtml + "</nav>" +
      '<div class="sidebar-foot">' +
        '<div class="sidebar-user"><span id="user-email" class="user-email"></span>' +
          '<button type="button" id="logout-btn" class="icon-btn" title="ออกจากระบบ" aria-label="ออกจากระบบ">' + icon("logout") + "</button></div>" +
        '<div class="sidebar-status"><span id="status" class="status-pill" data-state="busy">กำลังเชื่อมต่อ...</span>' +
        '<button type="button" id="theme-toggle" class="icon-btn" aria-pressed="false"></button></div>' +
      "</div>" +
    "</aside>" +
    '<div class="sidebar-backdrop" id="sidebar-backdrop"></div>';

  document.body.classList.add("app");
  document.body.insertAdjacentHTML("afterbegin", shellHtml);

  /* legacy markup cleanup: pages may still ship their own header/footer/status */
  Array.prototype.forEach.call(document.querySelectorAll("body > header, body > footer"), function (el) { el.remove(); });
  if (!document.getElementById("toasts")) {
    document.body.insertAdjacentHTML("beforeend", '<div id="toasts" class="toasts" aria-live="polite"></div>');
  }

  /* ---------- theme toggle ---------- */
  var themeButton = document.getElementById("theme-toggle");
  function syncThemeButton() {
    var dark = window.AppTheme && window.AppTheme.get() === "dark";
    themeButton.innerHTML = icon(dark ? "sun" : "moon");
    themeButton.setAttribute("aria-pressed", String(dark));
    themeButton.setAttribute("aria-label", dark ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด");
    themeButton.title = dark ? "โหมดสว่าง" : "โหมดมืด";
  }
  syncThemeButton();
  themeButton.addEventListener("click", function () {
    if (window.AppTheme) window.AppTheme.toggle();
  });
  document.addEventListener("app-theme-change", syncThemeButton);

  document.getElementById("logout-btn").addEventListener("click", function () {
    if (window.AppAuth) window.AppAuth.logout();
  });

  /* ---------- instant navigation ----------
   * Pages render from the local data cache, and the next page is prerendered
   * (Chromium speculation rules) or at least prefetched when the pointer rests
   * on a menu link, so switching menus feels immediate. */
  (function setupPreloading() {
    if (HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules")) {
      var rules = document.createElement("script");
      rules.type = "speculationrules";
      rules.textContent = JSON.stringify({
        prerender: [{ source: "document", where: { and: [{ selector_matches: "#main-nav a, .quick-action, .cmdk a, a.btn" }, { not: { href_matches: "*/login/*" } }] }, eagerness: "moderate" }],
        prefetch: [{ source: "document", where: { selector_matches: "#main-nav a" }, eagerness: "conservative" }],
      });
      document.head.appendChild(rules);
      return;
    }
    var done = {};
    document.addEventListener("pointerover", function (event) {
      var link = event.target.closest && event.target.closest("#main-nav a, .quick-action");
      if (!link || done[link.href]) return;
      done[link.href] = true;
      var hint = document.createElement("link");
      hint.rel = "prefetch";
      hint.href = link.href;
      document.head.appendChild(hint);
    });
  })();

  /* ---------- mobile drawer ---------- */
  function setDrawer(open) {
    document.body.classList.toggle("nav-open", open);
  }
  document.getElementById("nav-open").addEventListener("click", function () { setDrawer(true); });
  document.getElementById("nav-close").addEventListener("click", function () { setDrawer(false); });
  document.getElementById("sidebar-backdrop").addEventListener("click", function () { setDrawer(false); });

  /* ---------- command palette ---------- */
  var COMMANDS = [];
  NAV.forEach(function (section) {
    section.items.forEach(function (item) {
      COMMANDS.push({ label: item.label, group: section.group, icon: item.icon, keys: item.keys, href: hrefFor(item.id) });
    });
  });
  COMMANDS.unshift(
    { label: "บันทึกรายการบัญชีใหม่", group: "คำสั่งด่วน", icon: "plus", keys: "new entry เพิ่ม บันทึก", href: hrefFor("journal") + "#new" },
    { label: "เพิ่มลูกหนี้ใหม่ (ขายเชื่อ)", group: "คำสั่งด่วน", icon: "receipt", keys: "new receivable ใบแจ้งหนี้", href: hrefFor("receivables") + "#new" },
    { label: "เพิ่มเจ้าหนี้ใหม่ (ซื้อเชื่อ)", group: "คำสั่งด่วน", icon: "wallet", keys: "new payable ซื้อ", href: hrefFor("payables") + "#new" },
    { label: "ออกจากระบบ", group: "คำสั่งด่วน", icon: "logout", keys: "logout sign out ออก", run: function () { if (window.AppAuth) window.AppAuth.logout(); } },
    { label: "สลับโหมดสว่าง/มืด", group: "คำสั่งด่วน", icon: "moon", keys: "theme dark light ธีม", run: function () { if (window.AppTheme) window.AppTheme.toggle(); } }
  );

  var palette = null;
  var paletteIndex = 0;
  var paletteResults = [];

  function buildPalette() {
    palette = document.createElement("dialog");
    palette.className = "cmdk";
    palette.setAttribute("aria-label", "ค้นหาเมนูและคำสั่ง");
    palette.innerHTML =
      '<div class="cmdk-search">' + icon("search") + '<input type="text" placeholder="พิมพ์เพื่อค้นหาเมนูหรือคำสั่ง..." aria-label="ค้นหา" autocomplete="off"><kbd>Esc</kbd></div>' +
      '<ul class="cmdk-list" role="listbox"></ul>' +
      '<div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> เลือก</span><span><kbd>Enter</kbd> เปิด</span><span><kbd>' + modKey + " K</kbd> เปิด/ปิด</span></div>";
    document.body.appendChild(palette);
    var input = palette.querySelector("input");
    input.addEventListener("input", function () { paletteIndex = 0; renderPalette(input.value); });
    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") { event.preventDefault(); paletteIndex = Math.min(paletteResults.length - 1, paletteIndex + 1); highlight(); }
      else if (event.key === "ArrowUp") { event.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); highlight(); }
      else if (event.key === "Enter") { event.preventDefault(); runCommand(paletteResults[paletteIndex]); }
    });
    palette.addEventListener("click", function (event) {
      if (event.target === palette) palette.close();
      var item = event.target.closest("[data-cmd]");
      if (item) runCommand(paletteResults[Number(item.dataset.cmd)]);
    });
  }

  function renderPalette(query) {
    var needle = String(query || "").trim().toLowerCase();
    paletteResults = COMMANDS.filter(function (cmd) {
      return !needle || (cmd.label + " " + cmd.group + " " + (cmd.keys || "")).toLowerCase().indexOf(needle) !== -1;
    });
    var list = palette.querySelector(".cmdk-list");
    if (!paletteResults.length) {
      list.innerHTML = '<li class="cmdk-empty">ไม่พบเมนูที่ค้นหา</li>';
      return;
    }
    var lastGroup = "";
    list.innerHTML = paletteResults.map(function (cmd, index) {
      var head = cmd.group !== lastGroup ? '<li class="cmdk-group">' + cmd.group + "</li>" : "";
      lastGroup = cmd.group;
      return head + '<li role="option" data-cmd="' + index + '">' + icon(cmd.icon) + "<span>" + cmd.label + "</span></li>";
    }).join("");
    highlight();
  }

  function highlight() {
    Array.prototype.forEach.call(palette.querySelectorAll("[data-cmd]"), function (el) {
      var on = Number(el.dataset.cmd) === paletteIndex;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-selected", String(on));
      if (on) el.scrollIntoView({ block: "nearest" });
    });
  }

  function runCommand(cmd) {
    if (!cmd) return;
    palette.close();
    if (cmd.run) return cmd.run();
    var target = new URL(cmd.href, location.href);
    if (target.pathname === location.pathname && target.hash) {
      location.hash = target.hash;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
      location.href = cmd.href;
    }
  }

  function openPalette() {
    if (!palette) buildPalette();
    if (palette.open) { palette.close(); return; }
    paletteIndex = 0;
    var input = palette.querySelector("input");
    input.value = "";
    renderPalette("");
    palette.showModal();
    input.focus();
  }
  window.AppPalette = { open: openPalette };

  Array.prototype.forEach.call(document.querySelectorAll("[data-open-palette]"), function (el) {
    el.addEventListener("click", openPalette);
  });

  document.addEventListener("keydown", function (event) {
    var key = (event.key || "").toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "k") {
      event.preventDefault();
      setDrawer(false);
      openPalette();
    } else if (key === "escape" && document.body.classList.contains("nav-open")) {
      setDrawer(false);
    }
  });

  /* ---------- generic table filter ---------- */
  function applyTableFilter(input) {
    var table = document.querySelector(input.dataset.tableFilter);
    if (!table || !table.tBodies[0]) return;
    var needle = input.value.trim().toLowerCase();
    var shown = 0;
    var total = 0;
    Array.prototype.forEach.call(table.tBodies[0].rows, function (row) {
      if (row.cells.length <= 1) return; /* empty-state rows */
      total += 1;
      var match = !needle || row.textContent.toLowerCase().indexOf(needle) !== -1;
      row.hidden = !match;
      if (match) shown += 1;
    });
    var counter = input.dataset.filterCount ? document.querySelector(input.dataset.filterCount) : null;
    if (counter) {
      counter.textContent = needle ? "พบ " + shown.toLocaleString("th-TH") + " จาก " + total.toLocaleString("th-TH") + " รายการ" : "ทั้งหมด " + total.toLocaleString("th-TH") + " รายการ";
    }
  }

  function wireTableFilters() {
    Array.prototype.forEach.call(document.querySelectorAll("input[data-table-filter]"), function (input) {
      var table = document.querySelector(input.dataset.tableFilter);
      if (!table || !table.tBodies[0]) return;
      input.addEventListener("input", function () { applyTableFilter(input); });
      new MutationObserver(function () { applyTableFilter(input); }).observe(table.tBodies[0], { childList: true });
      applyTableFilter(input);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireTableFilters);
  else wireTableFilters();
})();

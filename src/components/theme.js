/**
 * Theme bootstrap. Loaded in <head> so the correct theme is applied before
 * the first paint (no light/dark flash). The toggle button is wired up by
 * js/shell.js through window.AppTheme.
 */
(function () {
  var STORAGE_KEY = "accounting_theme";
  var root = document.documentElement;

  function readSaved() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (error) {
      /* storage blocked: fall back to the system preference */
    }
    return null;
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function apply(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.dispatchEvent(new CustomEvent("app-theme-change", { detail: theme }));
  }

  apply(readSaved() || systemTheme());

  window.AppTheme = {
    get: function () {
      return root.dataset.theme === "dark" ? "dark" : "light";
    },
    toggle: function () {
      var next = this.get() === "dark" ? "light" : "dark";
      apply(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (error) {
        /* ignore */
      }
      return next;
    },
  };
})();

const THEME_STORAGE_KEY = "accounting_theme";
const themeToggle = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-toggle-icon");
const themeLabel = document.getElementById("theme-toggle-label");

if (themeToggle && themeIcon && themeLabel) {
  let theme = "light";

  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") theme = savedTheme;
  } catch (error) {
    console.warn("cannot read theme preference", error);
  }

  const applyTheme = (nextTheme) => {
    const isDark = nextTheme === "dark";
    document.body.dataset.theme = nextTheme;
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute(
      "aria-label",
      isDark ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด",
    );
    themeIcon.textContent = isDark ? "☀" : "☾";
    themeLabel.textContent = isDark ? "โหมดสว่าง" : "โหมดมืด";
  };

  applyTheme(theme);

  themeToggle.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    applyTheme(theme);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.warn("cannot persist theme preference", error);
    }
  });
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./pages/**/*.html", "./pages/**/*.js"],
  theme: {
    extend: {
      animation: {
        "page-enter": "page-enter 420ms ease-out both",
        "fade-up": "fade-up 480ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
      keyframes: {
        "page-enter": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SF Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // Claude-inspired warm dark palette
        canvas: {
          DEFAULT: "#1a1916",
          raised: "#211f1c",
          inset: "#161512",
        },
        line: {
          DEFAULT: "#332f29",
          soft: "#2a2723",
        },
        clay: {
          DEFAULT: "#d97757",
          soft: "#e08a6e",
          deep: "#c2603f",
        },
        ink: {
          DEFAULT: "#ece9e3",
          muted: "#a39e94",
          faint: "#6f6a60",
        },
        ok: "#7faa6f",
        warn: "#d9a441",
        bad: "#d96d5e",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./grip.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Site accent. Defined as CSS variables in styles/globals.css so the Finding
        // Grip site can swap RaceTrace blue for its own orange on shared pages.
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
          950: "rgb(var(--brand-950) / <alpha-value>)",
        },
        // Finding Grip accent
        grip: {
          50: "#fff4eb",
          100: "#ffe4cc",
          200: "#ffc999",
          300: "#ffa666",
          400: "#ff8533",
          500: "#ff6a00",
          600: "#e05a00",
          700: "#b84700",
          800: "#933a05",
          900: "#782f07",
          950: "#431602",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "monospace",
        ],
      },
      keyframes: {
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "slide-in-left": "slide-in-left 200ms ease-out",
      },
    },
  },
  plugins: [],
};

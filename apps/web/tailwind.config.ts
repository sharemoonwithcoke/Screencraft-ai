import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(214.3 31.8% 91.4%)",
        brand: {
          50: "#f0f4ff",
          100: "#e0e9ff",
          200: "#c7d7fe",
          300: "#a5b9fd",
          400: "#8194fb",
          500: "#6370f6",
          600: "#4f51eb",
          700: "#4240d0",
          800: "#3636a8",
          900: "#313285",
          950: "#1d1c4e",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      animation: {
        "pulse-orange": "pulse-orange 1.5s ease-in-out infinite",
        "pulse-blue": "pulse-blue 2s ease-in-out infinite",
        "fade-in": "fade-in 0.2s ease-in-out",
        "slide-up": "slide-up 0.3s ease-out",
        ripple: "ripple 0.6s ease-out forwards",
      },
      keyframes: {
        "pulse-orange": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(249, 115, 22, 0.4)" },
          "50%": { boxShadow: "0 0 0 12px rgba(249, 115, 22, 0)" },
        },
        "pulse-blue": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(59, 130, 246, 0.4)" },
          "50%": { boxShadow: "0 0 0 12px rgba(59, 130, 246, 0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        ripple: {
          "0%": { transform: "scale(0)", opacity: "1" },
          "100%": { transform: "scale(4)", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

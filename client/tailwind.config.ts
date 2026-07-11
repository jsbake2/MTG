import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Cinzel"', "Georgia", "serif"],
        ui: ['"Inter"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        // Parchment / dark-slate table theme.
        table: {
          bg: "#12161d",
          panel: "#1b212b",
          panel2: "#232b38",
          border: "#323c4d",
          ink: "#e8e6df",
          muted: "#9aa3b2",
          accent: "#c9a227",
          accentSoft: "#e5c866",
        },
        mana: {
          W: "#f8f6d8",
          U: "#3b7dd8",
          B: "#4b4b52",
          R: "#d3452b",
          G: "#2f9e58",
          C: "#c9c6be",
        },
      },
      boxShadow: {
        card: "0 2px 8px rgba(0,0,0,0.45)",
        panel: "0 4px 24px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
} satisfies Config;

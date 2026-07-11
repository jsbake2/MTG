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
        // Theme-driven via CSS variables (see index.css). Swapping [data-theme]
        // on <html> recolors the whole app.
        table: {
          bg: "rgb(var(--c-bg) / <alpha-value>)",
          panel: "rgb(var(--c-panel) / <alpha-value>)",
          panel2: "rgb(var(--c-panel2) / <alpha-value>)",
          border: "rgb(var(--c-border) / <alpha-value>)",
          ink: "rgb(var(--c-ink) / <alpha-value>)",
          muted: "rgb(var(--c-muted) / <alpha-value>)",
          accent: "rgb(var(--c-accent) / <alpha-value>)",
          accentSoft: "rgb(var(--c-accent-soft) / <alpha-value>)",
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

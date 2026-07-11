import { create } from "zustand";

export const THEMES = [
  { id: "midnight", name: "Midnight" },
  { id: "ravnica", name: "Ravnica Night" },
  { id: "forest", name: "Forest" },
  { id: "parchment", name: "Parchment" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

function apply(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
}

const stored = (typeof localStorage !== "undefined" && (localStorage.getItem("mtg-theme") as ThemeId)) || "midnight";
apply(stored);

interface ThemeState {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: stored,
  setTheme: (t) => {
    apply(t);
    localStorage.setItem("mtg-theme", t);
    set({ theme: t });
  },
}));

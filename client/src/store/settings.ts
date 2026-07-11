import { create } from "zustand";

interface SettingsState {
  sound: boolean;
  turnLimitSeconds: number; // 0 = no limit
  handCardWidth: number; // px width of a card in your hand (scalable)
  setSound: (v: boolean) => void;
  setTurnLimit: (s: number) => void;
  setHandCardWidth: (w: number) => void;
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export const useSettings = create<SettingsState>((set) => ({
  sound: load("mtg-sound", true),
  turnLimitSeconds: load("mtg-turnlimit", 0),
  handCardWidth: load("mtg-handwidth", 104),
  setSound: (v) => {
    localStorage.setItem("mtg-sound", JSON.stringify(v));
    set({ sound: v });
  },
  setTurnLimit: (s) => {
    localStorage.setItem("mtg-turnlimit", JSON.stringify(s));
    set({ turnLimitSeconds: s });
  },
  setHandCardWidth: (w) => {
    localStorage.setItem("mtg-handwidth", JSON.stringify(w));
    set({ handCardWidth: w });
  },
}));

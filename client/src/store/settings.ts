import { create } from "zustand";

interface SettingsState {
  sound: boolean;
  turnLimitSeconds: number; // 0 = no limit
  setSound: (v: boolean) => void;
  setTurnLimit: (s: number) => void;
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
  setSound: (v) => {
    localStorage.setItem("mtg-sound", JSON.stringify(v));
    set({ sound: v });
  },
  setTurnLimit: (s) => {
    localStorage.setItem("mtg-turnlimit", JSON.stringify(s));
    set({ turnLimitSeconds: s });
  },
}));

// Canonical Magic color palette (WUBRG + colorless), used everywhere so mana
// pips, deck dots, filters, and stats all match.
export const MANA_HEX: Record<string, string> = {
  W: "#f7f0d4", // white — warm cream
  U: "#2a72d4", // blue
  B: "#2b2730", // black — near-black gem (use a light ring for contrast)
  R: "#d8342b", // red
  G: "#2e9d4e", // green
  C: "#b7b1a6", // colorless — tan grey
};

export const MANA_FG: Record<string, string> = {
  W: "#3a3417",
  U: "#ffffff",
  B: "#e6e2ec",
  R: "#ffffff",
  G: "#ffffff",
  C: "#2a2822",
};

export const WUBRG = ["W", "U", "B", "R", "G"] as const;
export const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };

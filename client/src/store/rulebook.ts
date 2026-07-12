import { create } from "zustand";

interface RulebookState {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export const useRulebook = create<RulebookState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
}));

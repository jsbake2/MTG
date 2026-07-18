import { create } from "zustand";

// Global "card details" modal target, so any surface (battlefield right-click,
// etc.) can open the CardDetailModal without threading state through the tree.
interface CardDetailState {
  cardId: string | null;
  open: (cardId: string) => void;
  close: () => void;
}

export const useCardDetail = create<CardDetailState>((set) => ({
  cardId: null,
  open: (cardId) => set({ cardId }),
  close: () => set({ cardId: null }),
}));

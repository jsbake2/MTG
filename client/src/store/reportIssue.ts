import { create } from "zustand";

export interface ReportPrefill {
  cardId?: string | null;
  oracleId?: string | null;
  cardName?: string;
}

interface ReportState {
  open: boolean;
  prefill: ReportPrefill;
  openReport: (prefill?: ReportPrefill) => void;
  close: () => void;
}

export const useReportIssue = create<ReportState>((set) => ({
  open: false,
  prefill: {},
  openReport: (prefill = {}) => set({ open: true, prefill }),
  close: () => set({ open: false, prefill: {} }),
}));

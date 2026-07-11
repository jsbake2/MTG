import { useEffect, useRef, useState } from "react";
import type { Deck, DeckValidation } from "@mtg/shared";
import { api } from "@/api/client";

// A deck's `formatId` is only a *label* — a deck saved as "standard" can still be
// illegal (banned cards, wrong size, rotated cards…). The deck-picker must show
// only decks that are ACTUALLY legal for the table's format, not just label-matched.
//
// Pass in the decks already label-matched to `formatId` (or a "house" format, where
// anything goes). This validates each one's real legality via /api/decks/:id (whose
// validation runs against the deck's own format = the table format here) and returns
// the set of deck ids that genuinely pass. Results are cached per deck id.
export function useLegalDeckIds(decks: Deck[], formatId: string): { legalIds: Set<string>; loading: boolean } {
  const [legalIds, setLegalIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, boolean>>(new Map()); // deckId -> legal for its format

  const ids = decks.map((d) => d.id).join(",");
  useEffect(() => {
    // House / kitchen-table: no legality filtering, everything is playable.
    if (formatId === "house") {
      setLegalIds(new Set(decks.map((d) => d.id)));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const legal = new Set<string>();
      await Promise.all(
        decks.map(async (d) => {
          if (cache.current.has(d.id)) {
            if (cache.current.get(d.id)) legal.add(d.id);
            return;
          }
          try {
            const r = await api.get<{ validation: DeckValidation }>(`/api/decks/${d.id}`);
            const ok = !!r.validation?.valid;
            cache.current.set(d.id, ok);
            if (ok) legal.add(d.id);
          } catch {
            cache.current.set(d.id, false); // can't verify → don't offer it
          }
        }),
      );
      if (!cancelled) {
        setLegalIds(legal);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids, formatId]);

  return { legalIds, loading };
}

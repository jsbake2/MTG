import { useEffect, useRef, useState } from "react";
import type { Deck } from "@mtg/shared";
import { api } from "@/api/client";

// Construction compatibility: which decks even fit a game type's build rules,
// judged by DECK SIZE (not the format label — a "house"-labeled 60-card deck is a
// valid Standard-construction deck). The ruleset then decides card legality.
export function constructionMatches(gameType: string, deck: { formatId: string; cardCount: number }): boolean {
  if (gameType === "house") return true;
  if (gameType === "commander") return deck.formatId === "commander" || deck.cardCount >= 98;
  // Standard-type game: a full 60+ card deck that isn't a Commander deck.
  return deck.formatId !== "commander" && deck.cardCount >= 60;
}

// A deck's formatId is only a label. This verifies each construction-compatible
// deck is ACTUALLY legal for the table's game type + ruleset (card legality + ban
// toggle) via one round-trip per deck. Returns the set of legal deck ids.
export function useLegalDeckIds(
  decks: Deck[],
  gameType: string,
  ruleset: string,
  enforceBans: boolean,
): { legalIds: Set<string>; loading: boolean } {
  const [legalIds, setLegalIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, boolean>>(new Map());

  const ids = decks.map((d) => d.id).join(",");
  useEffect(() => {
    if (gameType === "house") {
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
          const key = `${d.id}:${gameType}:${ruleset}:${enforceBans}`;
          if (cache.current.has(key)) {
            if (cache.current.get(key)) legal.add(d.id);
            return;
          }
          try {
            const r = await api.post<{ valid: boolean }>(`/api/decks/${d.id}/check`, { formatId: gameType, ruleset, enforceBans });
            cache.current.set(key, !!r.valid);
            if (r.valid) legal.add(d.id);
          } catch {
            cache.current.set(key, false);
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
  }, [ids, gameType, ruleset, enforceBans]);

  return { legalIds, loading };
}

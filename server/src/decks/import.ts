// Parse a pasted decklist (MTG Arena / MTGGoldfish / plain text) into card
// entries, then resolve card names against the catalog. Handles:
//   "4 Lightning Bolt"        "4x Lightning Bolt"
//   "2 Mountain (M21) 275"    (set/collector suffix ignored)
//   section headers: Deck / Commander / Sideboard / Companion / Maybeboard
//   double-faced cards by front name.
import type { DeckCardEntry } from "@mtg/shared";
import { query } from "../db/pool.js";

interface ParsedLine {
  quantity: number;
  name: string;
  board: DeckCardEntry["board"];
}

const LINE_RE = /^\s*(\d+)\s*[xX]?\s+(.+?)\s*$/;

export function parseDecklist(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let board: DeckCardEntry["board"] = "main";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    // Section headers.
    if (/^(deck|mainboard|main deck)$/.test(lower)) {
      board = "main";
      continue;
    }
    if (/^(commander|commanders)$/.test(lower)) {
      board = "commander";
      continue;
    }
    if (/^(sideboard|companion|maybeboard)/.test(lower)) {
      board = "sideboard";
      continue;
    }
    if (line.startsWith("//") || line.startsWith("#")) continue;
    const m = line.match(LINE_RE);
    if (!m) continue;
    let name = m[2]!;
    // Strip a trailing set/collector suffix like "(M21) 275" or "(2X2)".
    name = name.replace(/\s*\([A-Za-z0-9]{2,6}\)\s*[0-9A-Za-z-]*\s*\*?F?\*?\s*$/, "").trim();
    // Keep only the front face name for DFCs written as "Front // Back".
    const front = name.split("//")[0]!.trim();
    out.push({ quantity: Number(m[1]), name: front, board });
  }
  return out;
}

// Resolve a set of card names to card ids (prefer paper, newest, real cards).
export async function resolveCardNames(names: string[]): Promise<Map<string, string>> {
  const lower = [...new Set(names.map((n) => n.toLowerCase()))];
  const resolved = new Map<string, string>();
  if (lower.length === 0) return resolved;

  const EXCL =
    "coalesce(layout,'') NOT IN ('art_series','token','double_faced_token','emblem') AND coalesce(set_type,'') NOT IN ('funny','memorabilia') AND coalesce(border_color,'') <> 'silver'";

  // Exact name match (front of the stored "Front // Back" also handled below).
  const exact = (
    await query<{ key: string; id: string }>(
      `SELECT DISTINCT ON (lower(name)) lower(name) AS key, id FROM cards
       WHERE lower(name) = ANY($1) AND ${EXCL}
       ORDER BY lower(name), digital ASC, released_at DESC NULLS LAST`,
      [lower],
    )
  ).rows;
  for (const r of exact) resolved.set(r.key, r.id);

  // For anything unresolved, try matching the front face of a DFC.
  const missing = lower.filter((n) => !resolved.has(n));
  for (const n of missing) {
    const r = (
      await query<{ id: string }>(
        `SELECT id FROM cards WHERE lower(name) LIKE $1 AND ${EXCL}
         ORDER BY digital ASC, released_at DESC NULLS LAST LIMIT 1`,
        [n + " // %"],
      )
    ).rows[0];
    if (r) resolved.set(n, r.id);
  }
  return resolved;
}

export interface ParsedImport {
  entries: DeckCardEntry[];
  unresolved: string[];
}

export async function resolveDecklist(text: string): Promise<ParsedImport> {
  const lines = parseDecklist(text);
  const names = lines.map((l) => l.name);
  const map = await resolveCardNames(names);
  const entries: DeckCardEntry[] = [];
  const unresolved: string[] = [];
  for (const l of lines) {
    const id = map.get(l.name.toLowerCase());
    if (id) entries.push({ cardId: id, quantity: l.quantity, board: l.board });
    else unresolved.push(`${l.quantity} ${l.name}`);
  }
  return { entries, unresolved };
}

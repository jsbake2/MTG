// Forge deck-export + support validation. Given a deck, generates a Forge .dck
// file, checks every card against Forge's supported-card set (imported from its
// cardsfolder into forge_cards), compares our Forge version to the latest
// release, and logs any unsupported cards under forge_unsupported so we can
// later write our own Forge card script for them.
import { query } from "../db/pool.js";
import type { DeckDetail } from "@mtg/shared";

export interface ForgeSupport {
  supported: string[];
  unsupported: string[];
}

// Which of these card names Forge has a script for (case-insensitive).
export async function checkForgeSupport(names: string[]): Promise<ForgeSupport> {
  const uniq = [...new Set(names)];
  if (uniq.length === 0) return { supported: [], unsupported: [] };
  const keys = uniq.map((n) => n.toLowerCase());
  const rows = (await query<{ name_key: string }>(`SELECT name_key FROM forge_cards WHERE name_key = ANY($1)`, [keys])).rows;
  const have = new Set(rows.map((r) => r.name_key));
  const supported: string[] = [];
  const unsupported: string[] = [];
  for (const n of uniq) (have.has(n.toLowerCase()) ? supported : unsupported).push(n);
  return { supported, unsupported };
}

let versionCache: { at: number; latest: string | null } = { at: 0, latest: null };

export interface ForgeVersionInfo {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
}

// Our imported Forge version vs the latest GitHub release (cached 1h).
export async function forgeVersionInfo(): Promise<ForgeVersionInfo> {
  const meta = (await query<{ version: string }>(`SELECT version FROM forge_meta WHERE id = 1`)).rows[0];
  const installed = meta?.version ?? null;
  const now = Date.now();
  if (now - versionCache.at > 3600_000) {
    try {
      const r = await fetch("https://api.github.com/repos/Card-Forge/forge/releases/latest", { headers: { "User-Agent": "mtg-pvp" } });
      const j = (await r.json()) as { tag_name?: string };
      versionCache = { at: now, latest: j.tag_name ?? null };
    } catch {
      versionCache = { at: now, latest: versionCache.latest };
    }
  }
  const latest = versionCache.latest;
  return { installed, latest, updateAvailable: !!(installed && latest && installed !== latest) };
}

// Record unsupported cards for later scripting (bumps hit count on repeats).
export async function logUnsupported(names: string[], forgeVersion: string | null): Promise<void> {
  for (const name of names) {
    await query(
      `INSERT INTO forge_unsupported (name, forge_version) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET hits = forge_unsupported.hits + 1, last_seen = now(), forge_version = EXCLUDED.forge_version`,
      [name, forgeVersion],
    );
  }
}

// Build a Forge .dck (name-only lines so Forge picks a printing — avoids
// Scryfall↔Forge set-code mismatches). Optionally drops unsupported cards.
export function buildDck(deck: DeckDetail, opts: { omit?: Set<string> } = {}): string {
  const omit = opts.omit ?? new Set<string>();
  const section = (board: string) =>
    deck.cards
      .filter((c) => c.board === board && !omit.has(c.card.name))
      .map((c) => `${c.quantity} ${c.card.name}`)
      .join("\n");
  let out = `[metadata]\nName=${deck.name}\n`;
  const main = section("main");
  const side = section("sideboard");
  const cmd = section("commander");
  if (cmd) out += `[Commander]\n${cmd}\n`;
  out += `[Main]\n${main}\n`;
  if (side) out += `[Sideboard]\n${side}\n`;
  return out;
}

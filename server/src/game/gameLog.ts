// Persistent per-game audit log. Every action, its result, and the resulting
// state summary are appended as JSONL to /data/game-logs/<tableId>.jsonl so a
// full game can be reconstructed after the fact when a problem is reported.
import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { env } from "../env.js";

const LOG_DIR = resolve(dirname(env.imageCacheDir), "game-logs");

export interface GameLogEntry {
  ts: number;
  kind: "game_start" | "action" | "undo" | "note";
  tableId: string;
  // For actions:
  seat?: number | null; // who acted
  actor?: string; // actor display name
  action?: unknown; // the full GameAction
  card?: string | null; // primary card affected (resolved name)
  ok?: boolean;
  error?: string;
  // Resulting snapshot (so a bug can be pinpointed to a game state):
  turn?: number;
  phase?: string;
  step?: string;
  activeSeat?: number;
  revision?: number;
  life?: Record<number, number>;
  stack?: string[]; // card names on the stack, bottom→top
  // Human-readable log lines produced by this action (combat, deaths, auto-effects).
  events?: string[];
  // For game_start:
  format?: string;
  players?: Array<{ seat: number; name: string; deckId: string | null }>;
  // Tamper-evident seal of each seat's starting decklist (sha256 of sorted cardIds).
  sealedDecks?: Array<{ seat: number; name: string; cards: number; hash: string }>;
}

function fileFor(tableId: string): string {
  // tableId is a uuid; safe as a filename.
  return join(LOG_DIR, `${tableId.replace(/[^a-zA-Z0-9-]/g, "_")}.jsonl`);
}

// Fire-and-forget append; never throws into the game loop.
export function appendGameLog(entry: GameLogEntry): void {
  void (async () => {
    try {
      await mkdir(LOG_DIR, { recursive: true });
      await appendFile(fileFor(entry.tableId), JSON.stringify(entry) + "\n");
    } catch (e) {
      console.error("[gamelog] append failed:", e instanceof Error ? e.message : e);
    }
  })();
}

export async function listGameLogs(): Promise<Array<{ tableId: string; bytes: number; modified: string }>> {
  try {
    const files = (await readdir(LOG_DIR)).filter((f) => f.endsWith(".jsonl"));
    const out = [];
    for (const f of files) {
      const s = await stat(join(LOG_DIR, f));
      out.push({ tableId: f.replace(/\.jsonl$/, ""), bytes: s.size, modified: s.mtime.toISOString() });
    }
    return out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  } catch {
    return [];
  }
}

export async function readGameLog(tableId: string, tail = 2000): Promise<GameLogEntry[]> {
  try {
    const text = await readFile(fileFor(tableId), "utf8");
    const lines = text.split("\n").filter(Boolean);
    return lines.slice(-tail).map((l) => {
      try {
        return JSON.parse(l) as GameLogEntry;
      } catch {
        return { ts: 0, kind: "note", tableId, error: "unparseable line" } as GameLogEntry;
      }
    });
  } catch {
    return [];
  }
}

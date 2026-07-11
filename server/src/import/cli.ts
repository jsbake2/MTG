// CLI entry for importing the card catalog. Run migrations first, then import.
import { runMigrations } from "../db/migrate.js";
import { importCards } from "./scryfall.js";
import { pool } from "../db/pool.js";

function parseArgs(argv: string[]): { file?: string; type?: string } {
  const out: { file?: string; type?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") out.file = argv[++i];
    else if (argv[i] === "--type") out.type = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await runMigrations();
  console.log("[import] starting card import", args.file ? `from ${args.file}` : `(scryfall ${args.type ?? "default_cards"})`);
  const t0 = Date.now();
  const { count, source } = await importCards(args);
  console.log(`[import] imported ${count} cards from ${source} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pool.end();
}

main().catch((e) => {
  console.error("[import] failed:", e);
  process.exit(1);
});

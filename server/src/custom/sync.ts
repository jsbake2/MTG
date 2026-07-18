// Build a "Forge bundle" — the custom editions, card scripts, and art — as JSON.
// A tiny host-side script (tools/forge-sync.sh) fetches this and writes the files
// into ~/.forge/custom/ + the pics cache on each machine (server, laptop,
// friends). Container-agnostic: the bash side does the file writing where tar/
// base64 exist. This is the hub → machines sync path.
import { query } from "../db/pool.js";
import { customSetToEditionFile, forgeCardFilename, forgeCardLetter } from "@mtg/shared";
import { getCard, listCards, listSets } from "./repo.js";
import { renderCard } from "./frame.js";
import { getDeckDetail } from "../decks/repo.js";
import { buildDck, checkForgeSupport } from "../decks/forge.js";

export interface ForgeBundle {
  editions: Array<{ filename: string; content: string }>;
  cards: Array<{ letter: string; filename: string; content: string }>;
  art: Array<{ setCode: string; filename: string; mime: string; dataBase64: string }>;
  // Decks are written to ~/.forge/decks/<folder>/<filename> on each machine.
  decks: Array<{ folder: string; filename: string; content: string }>;
  // Custom creature subtypes to register (appended to Forge's TypeLists.txt) so
  // Valid filters like `.AesSedai` work — required by Anathema/Channeler cards.
  subtypes: string[];
  // Custom token scripts → ~/.forge/custom/tokenscripts/<slug>.txt on each machine.
  tokenscripts: Array<{ slug: string; content: string }>;
  // Token images → ~/.cache/forge/pics/tokens/<setCode>/<filename> (filename is
  // <index>_<slug>.jpg keyed to the edition [tokens] section).
  tokenart: Array<{ setCode: string; filename: string; dataBase64: string }>;
}

// A .dck filename that's safe on disk (Forge matches on the [metadata] Name, not
// the filename, so we only need something unique + filesystem-legal).
function deckFilename(name: string): string {
  return `${name.replace(/[^\w '’.,()&-]/g, "").trim() || "deck"}.dck`;
}

export async function buildForgeBundle(): Promise<ForgeBundle> {
  const bundle: ForgeBundle = { editions: [], cards: [], art: [], decks: [], subtypes: [], tokenscripts: [], tokenart: [] };
  const sets = await listSets();

  // Token index: a stable, sorted [tokens] list so image filenames (<i>_<slug>.jpg)
  // line up with the edition section on every machine.
  const tokRows = (await query<{ slug: string; card_id: string | null }>(`SELECT slug, card_id FROM custom_tokenscripts ORDER BY slug`)).rows;
  const tokenLines = tokRows.map((t, i) => `${i + 1} ${t.slug}`);

  for (const set of sets) {
    // Token cards are web-tool/print-only — Forge makes tokens from tokenscripts,
    // so they're excluded from the edition, card scripts, and art faces.
    const cards = (await listCards(set.id)).filter((c) => !c.isToken);
    // Reprints: real cards pulled into this set (Forge already has their scripts).
    const reprints = (await query<{ name: string; rarity: string; collector_number: number | null; artist: string | null }>(
      `SELECT c.name, sc.rarity, sc.collector_number, c.artist
         FROM custom_set_cards sc JOIN cards c ON c.id = sc.card_id WHERE sc.set_id = $1`,
      [set.id],
    )).rows;
    if (cards.length === 0 && reprints.length === 0) continue;
    const editionCards = [
      ...cards.map((c, i) => ({ collectorNumber: c.collectorNumber ?? i + 1, rarity: c.rarity, name: c.name, artist: c.artist })),
      ...reprints.map((r, i) => ({ collectorNumber: r.collector_number ?? cards.length + i + 1, rarity: r.rarity, name: r.name, artist: r.artist })),
    ];
    let editionContent = customSetToEditionFile({ code: set.code, name: set.name, date: set.releaseDate, cards: editionCards });
    if (tokenLines.length) editionContent += `\n[tokens]\n${tokenLines.join("\n")}\n`;
    bundle.editions.push({ filename: `${set.name}.txt`, content: editionContent });
    for (const c of cards) {
      bundle.cards.push({ letter: forgeCardLetter(c.name), filename: forgeCardFilename(c.name), content: c.forgeScript });
    }
    // Art: Forge shows `<name>.full.jpg` as the WHOLE card face, so we ship our
    // composited card (frame + text + art), not the bare art. Only cards that
    // have art get a face; the rest fall back to Forge's own frame rendering.
    const artRows = (
      await query<{ card_id: string; data: Buffer; tx_scale: number; tx_dx: number; tx_dy: number }>(
        `SELECT a.card_id, a.data, a.tx_scale, a.tx_dx, a.tx_dy FROM custom_art a JOIN custom_cards c ON c.id = a.card_id WHERE c.set_id = $1`,
        [set.id],
      )
    ).rows;
    const byId = new Map(cards.map((c) => [c.id, c]));
    for (const a of artRows) {
      const card = byId.get(a.card_id);
      if (!card) continue;
      const face = await renderCard(card, Buffer.from(a.data), { scale: a.tx_scale, dx: a.tx_dx, dy: a.tx_dy });
      bundle.art.push({ setCode: set.code, filename: `${card.name}.full.jpg`, mime: "image/jpeg", dataBase64: face.toString("base64") });
    }
  }

  // ---- decks: every deck → a .dck in the right Forge folder ----------------
  // Custom cards live in our DB, not Forge's card list, so we must NOT drop them
  // as "unsupported" — they're supplied by this same bundle. Build the set of
  // custom names to keep.
  const customNames = new Set<string>();
  for (const s of sets) for (const c of await listCards(s.id)) customNames.add(c.name.toLowerCase());
  // Only sync decks that actually contain a custom card by IDENTITY (is_custom) —
  // matching by name would catch real decks using cards that merely share a name
  // with a custom card (Cultivate, Balefire, …). This is exact.
  const wotDeckIds = (await query<{ deck_id: string }>(
    `SELECT DISTINCT deck_id FROM deck_cards dc JOIN cards c ON c.id = dc.card_id WHERE c.is_custom = true`,
  )).rows.map((r) => r.deck_id);

  for (const id of wotDeckIds) {
    const deck = await getDeckDetail(id);
    if (!deck || deck.cards.length === 0) continue;
    const names = deck.cards.map((c) => c.card.name);
    const { unsupported } = await checkForgeSupport(names);
    // Only omit cards Forge genuinely can't script AND that we aren't shipping.
    const omit = new Set(unsupported.filter((n) => !customNames.has(n.toLowerCase())));
    const isCommander = deck.cards.some((c) => c.board === "commander");
    bundle.decks.push({
      folder: isCommander ? "commander" : "constructed",
      filename: deckFilename(deck.name),
      content: buildDck(deck, { omit }),
    });
  }

  // Custom creature subtypes (from app_settings, curated) → TypeLists.txt.
  const subRow = (await query<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'custom_subtypes'`)).rows[0];
  if (subRow?.value) { try { bundle.subtypes = JSON.parse(subRow.value); } catch { /* ignore */ } }

  // Custom token scripts → ~/.forge/custom/tokenscripts/.
  bundle.tokenscripts = tokRows.map((t) => ({ slug: t.slug, content: "" })); // content filled below
  const contentBySlug = new Map((await query<{ slug: string; content: string }>(`SELECT slug, content FROM custom_tokenscripts`)).rows.map((r) => [r.slug, r.content]));
  for (const t of bundle.tokenscripts) t.content = contentBySlug.get(t.slug) ?? "";

  // Token images: render the linked token card's face → pics/tokens/<code>/<i>_<slug>.jpg.
  const tokSetCode = sets[0]?.code ?? "CUST";
  for (let i = 0; i < tokRows.length; i++) {
    const { slug, card_id } = tokRows[i]!;
    if (!card_id) continue;
    const card = await getCard(card_id);
    if (!card) continue;
    const artRow = (await query<{ data: Buffer; tx_scale: number; tx_dx: number; tx_dy: number }>(
      `SELECT data, tx_scale, tx_dx, tx_dy FROM custom_art WHERE card_id = $1`, [card_id],
    )).rows[0];
    if (!artRow) continue;
    const face = await renderCard(card, Buffer.from(artRow.data), { scale: artRow.tx_scale, dx: artRow.tx_dx, dy: artRow.tx_dy });
    bundle.tokenart.push({ setCode: tokSetCode, filename: `${i + 1}_${slug}.jpg`, dataBase64: face.toString("base64") });
  }

  return bundle;
}

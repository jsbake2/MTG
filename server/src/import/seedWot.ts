import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapCard, upsertBatch, type CardRow } from "./scryfall.js";
import { pool, query } from "../db/pool.js";
import { createDeck } from "../decks/repo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ReskinDef {
  originalName: string;
  newName: string;
  id: string;
  oracle_id: string;
  collectorNumber: string;
  rarity: string;
}

const RESKINS: ReskinDef[] = [
  { originalName: "Sol Ring", newName: "Angreal", id: "00000000-0000-0000-0000-000000000101", oracle_id: "00000000-0000-0000-0000-000000000101", collectorNumber: "16", rarity: "uncommon" },
  { originalName: "Arcane Signet", newName: "Aes Sedai Signet", id: "00000000-0000-0000-0000-000000000102", oracle_id: "00000000-0000-0000-0000-000000000102", collectorNumber: "17", rarity: "uncommon" },
  { originalName: "Swiftfoot Boots", newName: "Boots of the Warder", id: "00000000-0000-0000-0000-000000000103", oracle_id: "00000000-0000-0000-0000-000000000103", collectorNumber: "18", rarity: "uncommon" },
  { originalName: "Commander's Sphere", newName: "Portal Stone", id: "00000000-0000-0000-0000-000000000104", oracle_id: "00000000-0000-0000-0000-000000000104", collectorNumber: "19", rarity: "uncommon" },
  { originalName: "Lightning Bolt", newName: "Channel Saidar", id: "00000000-0000-0000-0000-000000000105", oracle_id: "00000000-0000-0000-0000-000000000105", collectorNumber: "20", rarity: "common" },
  { originalName: "Swords to Plowshares", newName: "Gentling", id: "00000000-0000-0000-0000-000000000106", oracle_id: "00000000-0000-0000-0000-000000000106", collectorNumber: "21", rarity: "uncommon" },
  { originalName: "Path to Exile", newName: "Banish to the Ways", id: "00000000-0000-0000-0000-000000000107", oracle_id: "00000000-0000-0000-0000-000000000107", collectorNumber: "22", rarity: "uncommon" },
  { originalName: "Counterspell", newName: "Shielding", id: "00000000-0000-0000-0000-000000000108", oracle_id: "00000000-0000-0000-0000-000000000108", collectorNumber: "23", rarity: "common" },
  { originalName: "Brainstorm", newName: "Foretelling", id: "00000000-0000-0000-0000-000000000109", oracle_id: "00000000-0000-0000-0000-000000000109", collectorNumber: "24", rarity: "common" },
  { originalName: "Dark Ritual", newName: "True Power Draw", id: "00000000-0000-0000-0000-000000000110", oracle_id: "00000000-0000-0000-0000-000000000110", collectorNumber: "25", rarity: "common" },
  { originalName: "Terminate", newName: "Severing the Thread", id: "00000000-0000-0000-0000-000000000111", oracle_id: "00000000-0000-0000-0000-000000000111", collectorNumber: "26", rarity: "uncommon" },
  { originalName: "Wrath of God", newName: "Breaking of the World", id: "00000000-0000-0000-0000-000000000112", oracle_id: "00000000-0000-0000-0000-000000000112", collectorNumber: "27", rarity: "rare" },
  { originalName: "Giant Growth", newName: "Wolfbrother Strength", id: "00000000-0000-0000-0000-000000000113", oracle_id: "00000000-0000-0000-0000-000000000113", collectorNumber: "28", rarity: "common" },
  { originalName: "Cultivate", newName: "Song of Growing", id: "00000000-0000-0000-0000-000000000114", oracle_id: "00000000-0000-0000-0000-000000000114", collectorNumber: "29", rarity: "common" },
  { originalName: "Llanowar Elves", newName: "Ogier Builder", id: "00000000-0000-0000-0000-000000000115", oracle_id: "00000000-0000-0000-0000-000000000115", collectorNumber: "30", rarity: "common" },
  { originalName: "Forest", newName: "Forest of the Two Rivers", id: "00000000-0000-0000-0000-000000000116", oracle_id: "00000000-0000-0000-0000-000000000116", collectorNumber: "31", rarity: "common" },
  { originalName: "Plains", newName: "Plains of Caralain", id: "00000000-0000-0000-0000-000000000117", oracle_id: "00000000-0000-0000-0000-000000000117", collectorNumber: "32", rarity: "common" },
  { originalName: "Island", newName: "Isle of Tremalking", id: "00000000-0000-0000-0000-000000000118", oracle_id: "00000000-0000-0000-0000-000000000118", collectorNumber: "33", rarity: "common" },
  { originalName: "Swamp", newName: "Ruins of Shadar Logoth", id: "00000000-0000-0000-0000-000000000119", oracle_id: "00000000-0000-0000-0000-000000000119", collectorNumber: "34", rarity: "common" },
  { originalName: "Mountain", newName: "Mountains of Mist", id: "00000000-0000-0000-0000-000000000120", oracle_id: "00000000-0000-0000-0000-000000000120", collectorNumber: "35", rarity: "common" },
  { originalName: "Command Tower", newName: "White Tower", id: "00000000-0000-0000-0000-000000000121", oracle_id: "00000000-0000-0000-0000-000000000121", collectorNumber: "36", rarity: "common" },
  { originalName: "Evolving Wilds", newName: "Portal Stone Pathways", id: "00000000-0000-0000-0000-000000000122", oracle_id: "00000000-0000-0000-0000-000000000122", collectorNumber: "37", rarity: "common" },
  { originalName: "Kodama's Reach", newName: "Ogier Song of Safehaven", id: "00000000-0000-0000-0000-000000000123", oracle_id: "00000000-0000-0000-0000-000000000123", collectorNumber: "38", rarity: "common" },
  { originalName: "Elvish Mystic", newName: "Ogier Gardener", id: "00000000-0000-0000-0000-000000000124", oracle_id: "00000000-0000-0000-0000-000000000124", collectorNumber: "39", rarity: "common" },
  { originalName: "Savannah Lions", newName: "Aiel Spear-Maiden", id: "00000000-0000-0000-0000-000000000125", oracle_id: "00000000-0000-0000-0000-000000000125", collectorNumber: "40", rarity: "common" },
  { originalName: "Grizzly Bears", newName: "Two Rivers Hunter", id: "00000000-0000-0000-0000-000000000126", oracle_id: "00000000-0000-0000-0000-000000000126", collectorNumber: "41", rarity: "common" },
  { originalName: "Youthful Knight", newName: "Borderland Cavalry", id: "00000000-0000-0000-0000-000000000127", oracle_id: "00000000-0000-0000-0000-000000000127", collectorNumber: "42", rarity: "common" },
  { originalName: "Gravedigger", newName: "Dragkar", id: "00000000-0000-0000-0000-000000000128", oracle_id: "00000000-0000-0000-0000-000000000128", collectorNumber: "43", rarity: "common" },
  { originalName: "Vampire Nighthawk", newName: "Gholam", id: "00000000-0000-0000-0000-000000000129", oracle_id: "00000000-0000-0000-0000-000000000129", collectorNumber: "44", rarity: "uncommon" },
  { originalName: "Doom Blade", newName: "Strike of the Shadow", id: "00000000-0000-0000-0000-000000000130", oracle_id: "00000000-0000-0000-0000-000000000130", collectorNumber: "45", rarity: "common" },
  { originalName: "Read the Bones", newName: "Reading the Dragon Bones", id: "00000000-0000-0000-0000-000000000131", oracle_id: "00000000-0000-0000-0000-000000000131", collectorNumber: "46", rarity: "common" },
  { originalName: "Sign in Blood", newName: "Oath Rod Pact", id: "00000000-0000-0000-0000-000000000132", oracle_id: "00000000-0000-0000-0000-000000000132", collectorNumber: "47", rarity: "common" },
  { originalName: "Feed the Swarm", newName: "Trolloc Feast", id: "00000000-0000-0000-0000-000000000133", oracle_id: "00000000-0000-0000-0000-000000000133", collectorNumber: "48", rarity: "common" },
  { originalName: "Chaos Warp", newName: "Ta'veren Weave", id: "00000000-0000-0000-0000-000000000134", oracle_id: "00000000-0000-0000-0000-000000000134", collectorNumber: "49", rarity: "rare" },
  { originalName: "Ponder", newName: "Weaving the Flows", id: "00000000-0000-0000-0000-000000000150", oracle_id: "00000000-0000-0000-0000-000000000150", collectorNumber: "50", rarity: "common" },
  { originalName: "Preordain", newName: "Reading the Pattern", id: "00000000-0000-0000-0000-000000000151", oracle_id: "00000000-0000-0000-0000-000000000151", collectorNumber: "51", rarity: "common" },
  { originalName: "Opt", newName: "Whisper of the Wind", id: "00000000-0000-0000-0000-000000000152", oracle_id: "00000000-0000-0000-0000-000000000152", collectorNumber: "52", rarity: "common" }
];

export async function seedWheelOfTime() {
  console.log("[import:wot] Seeding Wheel of Time custom MTG expansion set...");
  try {
    const jsonPath = join(__dirname, "wot-cards.json");
    const raw = readFileSync(jsonPath, "utf8");
    const cards = JSON.parse(raw);
    const mapped: CardRow[] = [];
    for (const c of cards) {
      const row = mapCard(c);
      if (c.art_source_card) {
        const q = await query<any>(`SELECT image_normal, image_small, image_art_crop FROM cards WHERE name = $1 LIMIT 1`, [c.art_source_card]);
        const art = q.rows[0];
        if (art) {
          row.image_normal = art.image_normal;
          row.image_small = art.image_small;
          row.image_art_crop = art.image_art_crop;
        }
      }
      mapped.push(row);
    }
    await upsertBatch(mapped);
    console.log(`[import:wot] Seeded ${mapped.length} unique Wheel of Time cards.`);

    // 2. Clone and seed reskins
    console.log("[import:wot] Cloned reskin engine executing...");
    const reskinnedRows: CardRow[] = [];
    for (const r of RESKINS) {
      const q = await query<any>(`SELECT * FROM cards WHERE name = $1 LIMIT 1`, [r.originalName]);
      const base = q.rows[0];
      if (!base) {
        // Fallback placeholder card if standard database is not imported
        reskinnedRows.push({
          id: r.id,
          oracle_id: r.oracle_id,
          name: r.newName,
          mana_cost: r.originalName.includes("Forest") || r.originalName.includes("Plains") || r.originalName.includes("Island") || r.originalName.includes("Swamp") || r.originalName.includes("Mountain") ? "" : "{2}",
          cmc: r.originalName.includes("Forest") || r.originalName.includes("Plains") || r.originalName.includes("Island") || r.originalName.includes("Swamp") || r.originalName.includes("Mountain") ? 0 : 2,
          type_line: r.originalName.includes("Forest") || r.originalName.includes("Plains") || r.originalName.includes("Island") || r.originalName.includes("Swamp") || r.originalName.includes("Mountain") ? "Basic Land" : "Artifact",
          oracle_text: `Rules identical to ${r.originalName}.`,
          flavor_text: `Reskinned from ${r.originalName} (Wheel of Time Expansion)`,
          power: null,
          toughness: null,
          loyalty: null,
          colors: [],
          color_identity: [],
          keywords: [],
          supertypes: r.originalName.includes("Forest") || r.originalName.includes("Plains") || r.originalName.includes("Island") || r.originalName.includes("Swamp") || r.originalName.includes("Mountain") ? ["basic"] : [],
          card_types: r.originalName.includes("Forest") || r.originalName.includes("Plains") || r.originalName.includes("Island") || r.originalName.includes("Swamp") || r.originalName.includes("Mountain") ? ["land"] : ["artifact"],
          subtypes: [],
          set_code: "wot",
          set_name: "The Wheel of Time",
          collector_number: r.collectorNumber,
          rarity: r.rarity,
          released_at: "2026-07-12",
          year: 2026,
          artist: "AI Re-theme",
          reserved: false,
          legalities: {},
          faces: [],
          image_normal: null,
          image_small: null,
          image_art_crop: null,
          layout: "normal",
          digital: true,
          set_type: "expansion",
          border_color: "black"
        });
        continue;
      }

      reskinnedRows.push({
        id: r.id,
        oracle_id: r.oracle_id,
        name: r.newName,
        mana_cost: base.mana_cost,
        cmc: base.cmc,
        type_line: base.type_line,
        oracle_text: base.oracle_text,
        flavor_text: `Reskinned from ${base.name} (Wheel of Time Expansion)`,
        power: base.power,
        toughness: base.toughness,
        loyalty: base.loyalty,
        colors: base.colors,
        color_identity: base.color_identity,
        keywords: base.keywords,
        supertypes: base.supertypes,
        card_types: base.card_types,
        subtypes: base.subtypes,
        set_code: "wot",
        set_name: "The Wheel of Time",
        collector_number: r.collectorNumber,
        rarity: r.rarity,
        released_at: "2026-07-12",
        year: 2026,
        artist: base.artist,
        reserved: false,
        legalities: base.legalities,
        faces: base.faces,
        image_normal: base.image_normal,
        image_small: base.image_small,
        image_art_crop: base.image_art_crop,
        layout: base.layout,
        digital: true,
        set_type: "expansion",
        border_color: base.border_color
      });
    }
    await upsertBatch(reskinnedRows);
    console.log(`[import:wot] Successfully reskinned and seeded ${reskinnedRows.length} WoT cards!`);

    // 3. Register Pre-constructed Decks
    console.log("[import:wot] Seeding pre-constructed themed decks...");
    const admin = (await query<{ id: string }>(`SELECT id FROM users WHERE is_admin = true ORDER BY created_at ASC LIMIT 1`)).rows[0];
    if (!admin) {
      console.warn("[import:wot] No admin account found. Skipping precon deck creation.");
      return;
    }

    const preconPath = join(__dirname, "wot-precons.json");
    const preconRaw = readFileSync(preconPath, "utf8");
    const precons = JSON.parse(preconRaw);

    for (const deck of precons) {
      // Clean up previous precon versions to allow updates
      const exists = (await query<{ id: string }>(`SELECT id FROM decks WHERE name = $1 AND is_precon = true`, [deck.name])).rows[0];
      if (exists) {
        await query(`DELETE FROM decks WHERE id = $1`, [exists.id]);
      }

      const resolvedCards: any[] = [];
      for (const cardEntry of deck.cards) {
        const cRow = (await query<{ id: string }>(`SELECT id FROM cards WHERE name = $1 LIMIT 1`, [cardEntry.name])).rows[0];
        if (cRow) {
          resolvedCards.push({
            cardId: cRow.id,
            quantity: cardEntry.quantity,
            board: cardEntry.board
          });
        } else {
          console.warn(`[import:wot] Warning: Card "${cardEntry.name}" not found in database. Skipping.`);
        }
      }

      if (resolvedCards.length > 0) {
        await createDeck(
          admin.id,
          {
            name: deck.name,
            formatId: deck.formatId,
            description: deck.description,
            cards: resolvedCards
          },
          true // is_precon = true
        );
        console.log(`[import:wot] Registered precon deck: "${deck.name}" with ${resolvedCards.length} cards.`);
      } else {
        console.warn(`[import:wot] Warning: Deck "${deck.name}" has zero cards. Skipping.`);
      }
    }
    console.log("[import:wot] All WoT custom set precons successfully seeded!");
  } catch (e) {
    console.error("[import:wot] Seeding failed:", e);
    throw e;
  }
}

// Generate Forge card scripts (.txt) and edition (set) files from structured
// custom-card data. This is what lets a non-scripter fill in a form (name, cost,
// P/T, keywords, text) and get a valid Forge card — with an "advanced" escape
// hatch to hand-write the raw script. Pure so the UI can live-preview it.

export interface CustomCardInput {
  name: string;
  manaCost?: string | null; // Forge form: "1 R" (colorless first). Empty = no cost.
  types: string; // "Creature Goblin"
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  keywords?: string[]; // ["Flying","Trample"] or "Enchant:Creature"
  oracle?: string; // rules text
  flavor?: string | null;
  advanced?: boolean; // if true, forgeScript is authoritative (don't regenerate)
  forgeScript?: string | null; // hand-written raw script
}

// Forge card filename: lowercase, spaces→_, drop commas/apostrophes/specials.
export function forgeCardFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/['’.,!?:"()]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") + ".txt"
  );
}

export function forgeCardLetter(name: string): string {
  const c = name.trim().toLowerCase()[0] ?? "_";
  return /[a-z]/.test(c) ? c : "0";
}

// Build the Forge card script from structured fields (or return the advanced
// hand-written script verbatim).
export function customCardToForgeScript(card: CustomCardInput): string {
  if (card.advanced && card.forgeScript && card.forgeScript.trim()) {
    return card.forgeScript.trim() + "\n";
  }
  const lines: string[] = [];
  lines.push(`Name:${card.name}`);
  lines.push(`ManaCost:${card.manaCost && card.manaCost.trim() ? card.manaCost.trim() : "no cost"}`);
  lines.push(`Types:${card.types.trim()}`);
  const isCreature = /\bcreature\b/i.test(card.types) || /\bvehicle\b/i.test(card.types);
  if (isCreature && card.power != null && card.toughness != null && card.power !== "" && card.toughness !== "") {
    lines.push(`PT:${card.power}/${card.toughness}`);
  }
  if (/\bplaneswalker\b/i.test(card.types) && card.loyalty) lines.push(`Loyalty:${card.loyalty}`);
  for (const k of card.keywords ?? []) if (k.trim()) lines.push(`K:${k.trim()}`);
  // Oracle text last (Forge convention). Fall back to the keyword list.
  const oracle = (card.oracle && card.oracle.trim()) || (card.keywords ?? []).join(", ");
  lines.push(`Oracle:${oracle.replace(/\r?\n/g, "\\n")}`);
  return lines.join("\n") + "\n";
}

// A single [cards] line for an edition file: "<num> <rarity> <Name> @<artist>".
export function editionCardLine(collectorNumber: number, rarity: string, name: string, artist?: string | null): string {
  return `${collectorNumber} ${rarity} ${name}${artist ? ` @${artist}` : ""}`;
}

export interface CustomSetInput {
  code: string;
  name: string;
  date: string; // YYYY-MM-DD
  cards: Array<{ collectorNumber: number; rarity: string; name: string; artist?: string | null }>;
}

// The full edition (.txt) file for a custom set.
export function customSetToEditionFile(set: CustomSetInput): string {
  const meta = `[metadata]\nCode=${set.code}\nName=${set.name}\nDate=${set.date}\nType=Custom\n`;
  const cards = set.cards
    .slice()
    .sort((a, b) => a.collectorNumber - b.collectorNumber)
    .map((c) => editionCardLine(c.collectorNumber, c.rarity, c.name, c.artist))
    .join("\n");
  return `${meta}\n[cards]\n${cards}\n`;
}

// Where Forge expects the art for a custom card (relative to the pics cache).
export function forgeArtPath(setCode: string, name: string): string {
  return `cards/${setCode}/${name}.full.jpg`;
}

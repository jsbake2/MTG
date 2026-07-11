import {
  getFormat,
  isCopyLimitExempt,
  type Card,
  type Color,
  type DeckStats,
  type DeckTag,
  type DeckValidation,
  type DeckValidationIssue,
} from "@mtg/shared";

export interface DeckEntryWithCard {
  card: Card;
  quantity: number;
  board: "main" | "sideboard" | "commander";
}

const PIP_RE = /\{([^}]+)\}/g;

function countPips(manaCost: string | null, out: Record<string, number>): void {
  if (!manaCost) return;
  for (const m of manaCost.matchAll(PIP_RE)) {
    const sym = m[1]!;
    for (const c of ["W", "U", "B", "R", "G", "C"]) {
      if (sym.includes(c)) out[c] = (out[c] ?? 0) + 1;
    }
  }
}

export function computeStats(entries: DeckEntryWithCard[]): DeckStats {
  const stats: DeckStats = {
    total: 0,
    lands: 0,
    creatures: 0,
    instants: 0,
    sorceries: 0,
    artifacts: 0,
    enchantments: 0,
    planeswalkers: 0,
    other: 0,
    manaCurve: {},
    colorCounts: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    averageCmc: 0,
  };
  let cmcSum = 0;
  let nonLandCount = 0;
  for (const e of entries) {
    if (e.board === "sideboard") continue;
    const q = e.quantity;
    const t = e.card.cardTypes;
    stats.total += q;
    const isLand = t.includes("Land");
    if (isLand) stats.lands += q;
    else {
      if (t.includes("Creature")) stats.creatures += q;
      else if (t.includes("Instant")) stats.instants += q;
      else if (t.includes("Sorcery")) stats.sorceries += q;
      else if (t.includes("Planeswalker")) stats.planeswalkers += q;
      else if (t.includes("Artifact")) stats.artifacts += q;
      else if (t.includes("Enchantment")) stats.enchantments += q;
      else stats.other += q;
      const bucket = Math.min(7, Math.floor(e.card.cmc));
      stats.manaCurve[bucket] = (stats.manaCurve[bucket] ?? 0) + q;
      cmcSum += e.card.cmc * q;
      nonLandCount += q;
    }
    for (let i = 0; i < q; i++) countPips(e.card.manaCost, stats.colorCounts);
  }
  stats.averageCmc = nonLandCount > 0 ? Math.round((cmcSum / nonLandCount) * 100) / 100 : 0;
  return stats;
}

function strengthFor(count: number): DeckTag["strength"] {
  if (count >= 8) return "strong";
  if (count >= 4) return "medium";
  return "weak";
}

// Theme detectors over oracle text (archetype hints like MTGA shows).
const THEMES: Array<{ tag: string; re: RegExp }> = [
  { tag: "Lifegain", re: /gain(s)? [0-9]+ life|gain(s)? life|lifelink/i },
  { tag: "+1/+1 Counters", re: /\+1\/\+1 counter/i },
  { tag: "Sacrifice", re: /sacrifice (a|an|another|two|that)/i },
  { tag: "Mill", re: /mill(s)? [0-9]+|into (their|your) graveyard from the top/i },
  { tag: "Tokens", re: /create(s)? .*token/i },
  { tag: "Card Draw", re: /draw(s)? (a|two|three|that many) card/i },
  { tag: "Burn", re: /deals? [0-9]+ damage to any target|to target player/i },
  { tag: "Artifacts Matter", re: /artifact(s)? you control|whenever an artifact/i },
  { tag: "Graveyard", re: /from your graveyard|return .* from (a|your|their) graveyard/i },
];

// Dynamically derive tags with a strength based on how much support the deck has:
// tribal (creature subtypes) + a few archetype themes. e.g. one Goblin -> "weak
// Goblin", ten Elves -> "strong Elf".
export function analyzeDeckTags(entries: DeckEntryWithCard[]): DeckTag[] {
  const main = entries.filter((e) => e.board !== "sideboard");
  const tribe = new Map<string, number>();
  const theme = new Map<string, number>();
  for (const e of main) {
    const q = e.quantity;
    if (e.card.cardTypes.includes("Creature")) {
      for (const sub of e.card.subtypes) tribe.set(sub, (tribe.get(sub) ?? 0) + q);
    }
    const text = e.card.oracleText ?? "";
    for (const t of THEMES) if (t.re.test(text)) theme.set(t.tag, (theme.get(t.tag) ?? 0) + q);
  }
  const tribeTags: DeckTag[] = [...tribe.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count, strength: strengthFor(count) }));
  const themeTags: DeckTag[] = [...theme.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag, count]) => ({ tag, count, strength: strengthFor(count) }));
  return [...tribeTags, ...themeTags];
}

export function validateDeck(formatId: string, entries: DeckEntryWithCard[]): DeckValidation {
  const format = getFormat(formatId);
  const issues: DeckValidationIssue[] = [];
  const stats = computeStats(entries);
  if (!format) {
    return { valid: false, issues: [{ severity: "error", message: `Unknown format "${formatId}"` }], stats };
  }

  const main = entries.filter((e) => e.board === "main");
  const commanders = entries.filter((e) => e.board === "commander");
  const mainCount = main.reduce((n, e) => n + e.quantity, 0);
  const commanderCount = commanders.reduce((n, e) => n + e.quantity, 0);
  const totalForSize = mainCount + commanderCount;

  // Deck size.
  if (totalForSize < format.minDeckSize) {
    issues.push({
      severity: "error",
      message: `Deck has ${totalForSize} cards; ${format.name} needs at least ${format.minDeckSize}.`,
    });
  }
  if (format.maxDeckSize !== null && totalForSize > format.maxDeckSize) {
    issues.push({
      severity: "error",
      message: `Deck has ${totalForSize} cards; ${format.name} allows at most ${format.maxDeckSize}.`,
    });
  }

  // Copy limits / singleton.
  const byName = new Map<string, number>();
  for (const e of [...main, ...commanders]) {
    byName.set(e.card.name, (byName.get(e.card.name) ?? 0) + e.quantity);
  }
  for (const e of [...main, ...commanders]) {
    const total = byName.get(e.card.name)!;
    if (isCopyLimitExempt(e.card)) continue;
    const limit = format.singleton ? 1 : format.maxCopiesPerCard;
    if (total > limit) {
      issues.push({
        severity: "error",
        cardName: e.card.name,
        message: `${e.card.name}: ${total} copies, but ${format.name} allows ${limit}.`,
      });
      byName.set(e.card.name, -1); // avoid duplicate messages
    }
  }

  // Legality per card.
  if (format.legalityKey) {
    for (const e of [...main, ...commanders]) {
      const legality = e.card.legalities[format.legalityKey];
      if (legality === "banned") {
        issues.push({ severity: "error", cardName: e.card.name, message: `${e.card.name} is banned in ${format.name}.` });
      } else if (legality === "not_legal" || legality === undefined) {
        issues.push({ severity: "error", cardName: e.card.name, message: `${e.card.name} is not legal in ${format.name}.` });
      } else if (legality === "restricted") {
        const total = byName.get(e.card.name) ?? 0;
        if (total > 1) {
          issues.push({ severity: "error", cardName: e.card.name, message: `${e.card.name} is restricted (max 1) in ${format.name}.` });
        }
      }
    }
  }

  // Commander rules.
  if (format.requiresCommander) {
    if (commanderCount < 1) {
      issues.push({ severity: "error", message: "You need to choose a commander." });
    }
    for (const e of commanders) {
      const t = e.card.typeLine.toLowerCase();
      const canBeCommander =
        (t.includes("legendary") && t.includes("creature")) ||
        (e.card.oracleText ?? "").toLowerCase().includes("can be your commander");
      if (!canBeCommander) {
        issues.push({ severity: "error", cardName: e.card.name, message: `${e.card.name} can't be a commander (needs to be a legendary creature).` });
      }
    }
    // Color identity.
    if (format.enforcesColorIdentity && commanders.length > 0) {
      const allowed = new Set<Color>();
      for (const c of commanders) c.card.colorIdentity.forEach((x) => allowed.add(x));
      for (const e of main) {
        const outside = e.card.colorIdentity.filter((x) => !allowed.has(x));
        if (outside.length > 0) {
          issues.push({
            severity: "error",
            cardName: e.card.name,
            message: `${e.card.name} has colors (${outside.join("")}) outside your commander's identity.`,
          });
        }
      }
    }
  }

  return { valid: issues.filter((i) => i.severity === "error").length === 0, issues, stats };
}

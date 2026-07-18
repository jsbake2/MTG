import { test } from "node:test";
import assert from "node:assert/strict";
import { customCardToForgeScript, forgeCardFilename, forgeCardLetter, customSetToEditionFile } from "./forgeScript.js";

test("matches Forge's own Goblin Card Guide example", () => {
  const script = customCardToForgeScript({
    name: "Goblin Card Guide",
    manaCost: "1 R",
    types: "Creature Goblin",
    power: "2",
    toughness: "2",
    keywords: ["Haste"],
    oracle: "Haste",
  });
  assert.equal(script, "Name:Goblin Card Guide\nManaCost:1 R\nTypes:Creature Goblin\nPT:2/2\nK:Haste\nOracle:Haste\n");
});

test("non-creature omits PT; empty cost → 'no cost'; oracle newlines escaped", () => {
  const s = customCardToForgeScript({ name: "Big Spell", types: "Sorcery", oracle: "Draw two cards.\nGain 2 life." });
  assert.ok(s.includes("Types:Sorcery"));
  assert.ok(!s.includes("PT:"));
  assert.ok(s.includes("Oracle:Draw two cards.\\nGain 2 life."));
  assert.ok(customCardToForgeScript({ name: "Token", types: "Creature Elf" }).includes("ManaCost:no cost"));
});

test("advanced script is used verbatim", () => {
  const raw = "Name:Weird One\nManaCost:U\nTypes:Instant\nA:SP$ Draw | NumCards$ 2";
  const s = customCardToForgeScript({ name: "Weird One", types: "Instant", advanced: true, forgeScript: raw });
  assert.equal(s, raw + "\n");
});

test("filenames + letter folder", () => {
  assert.equal(forgeCardFilename("Ragavan, Nimble Pilferer"), "ragavan_nimble_pilferer.txt");
  assert.equal(forgeCardFilename("Ali from Cairo"), "ali_from_cairo.txt");
  assert.equal(forgeCardLetter("Goblin Card Guide"), "g");
  assert.equal(forgeCardLetter("7th Edition Thing"), "0");
});

test("edition file", () => {
  const f = customSetToEditionFile({
    code: "WOT", name: "Wheel of Time", date: "2026-07-14",
    cards: [{ collectorNumber: 2, rarity: "R", name: "Rand al'Thor", artist: "Jbaker" }, { collectorNumber: 1, rarity: "M", name: "Moiraine" }],
  });
  assert.ok(f.includes("Code=WOT"));
  assert.ok(f.includes("Type=Custom"));
  // sorted by collector number, artist appended with @
  assert.ok(f.indexOf("1 M Moiraine") < f.indexOf("2 R Rand al'Thor @Jbaker"));
});

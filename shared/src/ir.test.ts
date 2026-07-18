import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbilityClause, parseCardScript } from "./ir.js";

test("parse a spell ability clause", () => {
  const n = parseAbilityClause("SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3")!;
  assert.equal(n.kind, "spell");
  assert.equal(n.api, "DealDamage");
  assert.equal(n.params.NumDmg, "3");
  assert.equal(n.params.ValidTgts, "Any");
});

test("Lightning Bolt", () => {
  const ir = parseCardScript(`Name:Lightning Bolt
ManaCost:R
Types:Instant
A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3
Oracle:Lightning Bolt deals 3 damage to any target.`);
  assert.equal(ir.name, "Lightning Bolt");
  assert.equal(ir.manaCost, "R");
  assert.deepEqual(ir.types, ["Instant"]);
  assert.equal(ir.spells.length, 1);
  assert.equal(ir.spells[0]!.api, "DealDamage");
  assert.equal(ir.spells[0]!.params.NumDmg, "3");
});

test("keywords + PT + activated ability + cost (Lotleth Troll)", () => {
  const ir = parseCardScript(`Name:Lotleth Troll
ManaCost:B G
Types:Creature Zombie Troll
PT:2/1
A:AB$ Regenerate | Cost$ B
K:Trample
A:AB$ PutCounter | Cost$ Discard<1/Creature> | CounterType$ P1P1 | CounterNum$ 1`);
  assert.deepEqual(ir.pt, { power: "2", toughness: "1" });
  assert.deepEqual(ir.keywords, ["Trample"]);
  assert.equal(ir.activated.length, 2);
  const put = ir.activated.find((a) => a.api === "PutCounter")!;
  assert.equal(put.params.Cost, "Discard<1/Creature>");
  assert.equal(put.params.CounterType, "P1P1");
});

test("trigger resolves Execute$ into a sub-ability (Luminarch Aspirant)", () => {
  const ir = parseCardScript(`Name:Luminarch Aspirant
ManaCost:1 W
Types:Creature Human Cleric
PT:1/1
T:Mode$ Phase | Phase$ BeginCombat | ValidPlayer$ You | Execute$ TrigPutCounter
SVar:TrigPutCounter:DB$ PutCounter | ValidTgts$ Creature.YouCtrl | CounterType$ P1P1 | CounterNum$ 1`);
  assert.equal(ir.triggers.length, 1);
  const t = ir.triggers[0]!;
  assert.equal(t.mode, "Phase");
  assert.equal(t.params.Phase, "BeginCombat");
  assert.ok(t.execute, "Execute resolved");
  assert.equal(t.execute!.api, "PutCounter");
  assert.equal(t.execute!.params.CounterType, "P1P1");
});

test("SubAbility chaining (damage then gain life)", () => {
  const ir = parseCardScript(`Name:Test Helix
ManaCost:R W
Types:Instant
A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | SubAbility$ DBGain
SVar:DBGain:DB$ GainLife | LifeAmount$ 3`);
  const s = ir.spells[0]!;
  assert.equal(s.api, "DealDamage");
  assert.ok(s.sub, "sub resolved");
  assert.equal(s.sub!.api, "GainLife");
  assert.equal(s.sub!.params.LifeAmount, "3");
});

test("static continuous + replacement", () => {
  const ir = parseCardScript(`Name:Lignify
ManaCost:1 G
Types:Enchantment Aura
K:Enchant:Creature
S:Mode$ Continuous | Affected$ Card.EnchantedBy | SetPower$ 0 | SetToughness$ 4 | RemoveAllAbilities$ True
R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ Tapped
SVar:Tapped:DB$ Tap | Defined$ Self`);
  assert.equal(ir.statics.length, 1);
  assert.equal(ir.statics[0]!.params.SetPower, "0");
  assert.equal(ir.replacements.length, 1);
  assert.equal(ir.replacements[0]!.params.Event, "Moved");
  assert.ok(ir.replacements[0]!.sub);
  assert.equal(ir.replacements[0]!.sub!.api, "Tap");
});

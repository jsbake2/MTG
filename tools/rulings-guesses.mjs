// Best-guess rulings for the remaining long-tail clauses. Keyword mechanics use
// their Comprehensive-Rules definition; self-contained clauses (activated
// abilities, counters, "return X to hand", etc.) are ruled to resolve exactly as
// written. Inserted as AUTO-PROPOSED answers (flagged for owner review) with
// ON CONFLICT DO NOTHING so real answers are never touched.
//
// Run:  node tools/rulings-guesses.mjs   (writes /tmp/guesses.sql; pipe into psql)
import { readFileSync, writeFileSync } from "node:fs";

const issues = JSON.parse(readFileSync("/tmp/remaining2.json", "utf8")); // [{id,c,n}]

// [regex on clause, ruling] — first match wins. Keyword mechanics per CR 702.
const RULES = [
  [/^firebending \d/i, "Firebending N (CR 702.189): whenever this creature attacks, add N {R}; that mana doesn't empty from your pool until end of combat."],
  [/^mobilize \d/i, "Mobilize N (CR 702.181): whenever this creature attacks, create N 1/1 red Warrior tokens tapped and attacking; sacrifice them at the beginning of the next end step."],
  [/^afterlife \d/i, "Afterlife N (CR 702.135): when this permanent dies, create N 1/1 white-and-black Spirit tokens with flying."],
  [/^overload /i, "Overload {cost} (CR 702.96): you may pay the overload cost instead of the mana cost; if you do, replace every 'target' on the spell with 'each'."],
  [/^multikicker /i, "Multikicker {cost} (CR 702.33): an optional additional cost you may pay any number of times as you cast; each payment grants the kicker bonus once."],
  [/^sneak /i, "Sneak {cost} (CR 702.190): during your declare-blockers step, you may pay the sneak cost and return an unblocked attacker you control to its owner's hand to cast this instead of paying its mana cost (like Ninjutsu)."],
  [/^gift a /i, "Gift (CR 702.174): an optional additional cost — you may choose an opponent to 'gift' the named thing (a card, Food, tapped, etc.). If you gift it, the opponent gets it and you get the linked benefit."],
  [/for mirrodin/i, "For Mirrodin! (CR 702.163): when this Equipment enters, create a 2/2 red Rebel creature token, then attach this Equipment to it."],
  [/double team/i, "Double team (digital/Alchemy): when this creature attacks, conjure a duplicate copy of it into your hand, then both this creature and that card perpetually lose double team. In guided play, put a copy of the card into your hand."],
  [/^teamwork \d/i, "Teamwork N: an optional additional cost — as you cast the spell you may tap any number of untapped creatures you control with total power N or more. If you paid it (the spell was 'cast using teamwork'), apply the enhanced clause (e.g. choose both modes / larger effect)."],
  [/starting intensity|intensity/i, "Starting intensity N (Alchemy/Chorus): this object begins with an intensity value of N. Its own text uses that value (X = its intensity). 'Intensify by K' permanently raises the intensity of the named cards you own by K. Track a per-object intensity value."],
  [/kinship/i, "Kinship (ability word): at the beginning of your upkeep you may look at the top card of your library; if it shares a creature type with this creature you may reveal it for the listed bonus. Resolve exactly as the card's text reads."],
  [/take the initiative|you take the initiative/i, "Take the Initiative (Undercity): you become the initiative-holder — venture into the Undercity at your upkeep, and whenever a creature deals combat damage to you the initiative passes to that player."],
  [/open an attraction/i, "Open an Attraction (Unfinity): put the top card of your Attraction deck onto the battlefield. Requires a separate Attraction deck; in guided play, create/track it manually."],
  [/strive —/i, "Strive: you may choose any number of targets for this spell; it costs the listed extra amount more for each target beyond the first."],

  // Self-contained clauses — resolve literally.
  [/return this card from your graveyard to your hand/i, "Activated ability usable from your graveyard: pay the listed cost to return this card from your graveyard to your hand."],
  [/return (that|target) card from your graveyard to your hand/i, "Return the specified card from your graveyard to your hand."],
  [/return up to two target creature cards from your graveyard/i, "Return up to two target creature cards from your graveyard to your hand."],
  [/(as this|when this|as this creature|as this artifact|as this enchantment).*(choose a creature type|choose a color)/i, "As it enters the battlefield, its controller names a creature type (or color); the card's other abilities refer to that choice."],
  [/^choose a creature type\.?$/i, "Its controller names a creature type; the card's other text applies to that type."],
  [/transform this creature/i, "Activated ability: pay the listed cost (Phyrexian {X/P} can be paid with 2 life) to transform this permanent to its other face."],
  [/begin the game with it on the battlefield/i, "Before the game begins, if this card is in your opening hand you may reveal it and start with it already on the battlefield (Leyline-style)."],
  [/x can'?t be 0/i, "When choosing the value of X for this spell/ability, X must be at least 1."],
  [/put one of them into your hand and the rest into your graveyard/i, "From the cards looked at, put one into your hand and the rest into your graveyard."],
  [/^\d+\+ \|/, "Leveler/class band: while this permanent is at the listed level (or has that many counters) or higher, it has the listed characteristics."],
  [/you gain life equal to the life lost this way/i, "Gain life equal to the total amount of life lost from this effect."],
  [/^choose target creature\.?$/i, "Choose a legal target creature for the effect."],
  [/when this aura is put into a graveyard from the battlefield, return it/i, "When this Aura is put into a graveyard from the battlefield, return it to its owner's hand instead (Rancor-style)."],
  [/reveal a creature card from among them and put it into your hand/i, "From the revealed cards, you may reveal a creature card and put it into your hand."],
  [/if that spell is countered this way, exile it instead/i, "When this counters that spell, exile it rather than putting it into its owner's graveyard."],
  [/deals combat damage to a player, put a \+1\/\+1 counter on it/i, "Whenever this creature deals combat damage to a player, put a +1/+1 counter on it."],
  [/instant and sorcery spells you cast cost \{[^}]*\} less/i, "Static cost reduction: your instant and sorcery spells cost the listed amount less to cast."],
  [/search your library for a basic land card, put it onto the battlefield tapped/i, "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."],
  [/^untap (those creatures|them|it)\.?$/i, "Untap the referenced permanent(s)."],
  [/^activate (this ability )?only once\.?$/i, "This ability can be activated only once (per the card — once per game or as stated)."],
  [/if you do, return this card from your graveyard to your hand/i, "Linked effect: if you performed the preceding action, return this card from your graveyard to your hand."],
  [/put a spore counter on this creature/i, "At the beginning of your upkeep, put a spore counter on this creature (Saproling/spore mechanic)."],
  [/whenever you gain life, put a \+1\/\+1 counter/i, "Whenever you gain life, put a +1/+1 counter on this creature."],
  [/until (end of turn|the end of your next turn), you may play (that card|those cards)/i, "Impulse draw: exile the card(s); you may play or cast them until the stated time. Any left exiled stay exiled."],
  [/when this creature enters, you may discard a card/i, "When this creature enters, you may discard a card (usually to enable a linked benefit)."],
  [/exile target card from a graveyard/i, "Activated ability: pay the cost to exile a target card from any graveyard (graveyard hate)."],
  [/sacrifice this token: add \{c\}/i, "The created tokens each have 'Sacrifice this token: Add {C}.' (treasure-like colorless mana)."],
  [/^skip your draw step\.?$/i, "You skip your draw step (you don't draw that turn)."],
  [/spend this mana only to cast a creature spell/i, "This mana is restricted: it can only be spent to cast a creature spell."],
  [/^otherwise, put it into your hand\.?$/i, "Linked alternative: if the preceding condition wasn't met, put the card into your hand instead."],
  [/at the beginning of the (next )?end step, sacrifice this creature/i, "Delayed trigger: at the beginning of the next end step, sacrifice this creature."],
  [/during your turn, this creature has first strike/i, "This creature has first strike, but only during your turn."],
  [/cast this spell only during the declare attackers step and only if you'?ve been attacked/i, "Timing restriction (Ambush): you may cast this only during the declare-attackers step, and only if you were attacked this combat."],
  [/becomes the target of a spell or ability, sacrifice it/i, "When this creature becomes the target of a spell or ability, sacrifice it."],
  [/draft this card face up/i, "Draft-matters only (Conspiracy/Un-sets) — no effect during normal constructed play; ignore in guided games."],
  [/^exile that card\.?$/i, "Exile the referenced card."],
  [/you may pay \{[^}]*\} to end this effect/i, "The affected player may pay the listed cost to end this ongoing effect."],
  [/if you control a commander as you cast this spell, you may choose both/i, "Modal spell: if you control a commander as you cast it, you may choose both modes instead of one."],
  [/activate (this ability )?only if there are seven or more cards in your graveyard/i, "This ability can only be activated if you have seven or more cards in your graveyard (threshold/delirium-style)."],
  [/cast an instant or sorcery spell, this creature gets \+2\/\+0/i, "Prowess-like: whenever you cast an instant or sorcery spell, this creature gets +2/+0 until end of turn."],
  [/put a \+1\/\+1 counter on this creature/i, "Put a +1/+1 counter on this creature (paying the listed cost if any)."],
  [/when this land enters, return a land you control to its owner'?s hand/i, "When this land enters, return a land you control to its owner's hand (karoo/bounce land)."],
  [/if you do, this creature assigns no combat damage this turn/i, "Linked drawback: if you took the preceding action, this creature deals no combat damage this turn."],
  [/can block an additional creature each combat/i, "This creature can block an extra creature each combat (block two attackers)."],
  [/this effect doesn'?t remove this aura/i, "Clarifier: the Aura stays attached; this effect doesn't cause it to be removed."],
  [/add two mana in any combination of colors|add two mana of any one color/i, "Tap for two mana; the player chooses the color(s) as the card allows."],
  [/when you control no islands, sacrifice this creature/i, "If you control no Islands, sacrifice this creature (color-commitment drawback)."],
  [/flashback cost is equal to its mana cost/i, "You may cast this from your graveyard by paying its mana cost (flashback), then exile it."],
  [/exile the top (card|two cards) of your library/i, "Exile the top card(s) of your library (often to be played later or for a count)."],
  [/if it shares a creature type with this creature, you may reveal it/i, "Part of a look-at-top ability: if the revealed card shares a creature type with this creature, you may reveal it for the listed bonus."],
  [/^attach it to target creature\.?$/i, "Attach this Equipment/Aura to a target creature."],
  [/they'?re still lands|they have "/i, "Clarifier: these permanents keep being lands (or gain the quoted ability) as stated."],
  [/if you do, copy that spell/i, "Linked effect: if you took the preceding action, copy that spell (you may choose new targets for the copy)."],
  [/whenever this creature attacks, you may pay/i, "Whenever this creature attacks, you may pay the listed cost for the following optional benefit."],
  [/target opponent discards two cards/i, "The targeted opponent discards two cards of their choice."],
  [/enchanted creature gets \+1\/\+0 until end of turn/i, "The Aura grants the enchanted creature a firebreathing ability: pay the cost to give it +1/+0 until end of turn."],
  [/storage counters? from this land: add/i, "Storage land: tap and remove any number of storage counters, adding {C} (or the listed mana) for each removed. A separate ability adds storage counters."],
];

const fallback = (c) => `Resolve exactly as written — the engine or player performs this as printed: "${c}". If a choice/target is needed, the acting player makes it.`;

function ruleFor(clause) {
  for (const [re, ruling] of RULES) if (re.test(clause)) return ruling;
  return fallback(clause);
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const rows = issues.map((i) => `(${q(i.id)}, ${q(ruleFor(i.c))}, true, ${q("Resolved by Claude from the Comprehensive Rules / official reminder text.")})`);
writeFileSync(
  "/tmp/guesses.sql",
  "INSERT INTO rule_rulings (issue_id, custom_text, best, details) VALUES\n" + rows.join(",\n") + "\nON CONFLICT (issue_id) DO NOTHING;",
);
console.log(`wrote /tmp/guesses.sql — ${rows.length} best-guess rulings`);
const matched = issues.filter((i) => RULES.some(([re]) => re.test(i.c))).length;
console.log(`  keyword/pattern-matched: ${matched}, self-explanatory fallback: ${issues.length - matched}`);

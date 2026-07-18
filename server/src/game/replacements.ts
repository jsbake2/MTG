// ---------------------------------------------------------------------------
// REPLACEMENT EFFECTS (CR 614) — events intercepted "as" they happen.
// Starting with the most common one by far: permanents that enter the
// battlefield tapped (CR 614.1c "enters ... tapped" self-replacement). Only the
// UNCONDITIONAL form is auto-applied; conditional ("...tapped unless you control
// two or more other lands") and optional ("you may have ~ enter tapped") forms
// are left to the player so the engine is never silently wrong.
// ---------------------------------------------------------------------------

// Does this permanent unconditionally enter the battlefield tapped?
export function entersTappedUnconditional(oracleText: string | null): boolean {
  if (!oracleText) return false;
  for (const clause of oracleText.toLowerCase().split(/\n|(?<=\.)\s+/)) {
    if (!/enters? (?:the battlefield )?tapped/.test(clause)) continue;
    // Optional or conditional variants are the player's choice / depend on board.
    if (/\bunless\b|\byou may\b|\bmay have\b|choose/.test(clause)) return false;
    return true;
  }
  return false;
}

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// "This creature enters with N +1/+1 (or -1/-1) counters on it" (CR 614.1c).
// Returns null for variable amounts (X / "a number of"), which need the cast
// context and fall back to the player setting counters manually.
export function entersWithCounters(
  oracleText: string | null,
): { kind: "+1/+1" | "-1/-1"; count: number; xScaled?: boolean } | null {
  if (!oracleText) return null;
  const m = oracleText.toLowerCase().match(/enters (?:the battlefield )?with (\w+) (\+1\/\+1|-1\/-1) counters?/);
  if (!m) return null;
  const w = m[1]!;
  const kind = m[2] === "+1/+1" ? "+1/+1" : "-1/-1";
  // "enters with X +1/+1 counters" — the count is the X chosen as the spell was
  // cast; the caller resolves it from the object's xValue.
  if (w === "x") return { kind, count: 0, xScaled: true };
  const count = /^\d+$/.test(w) ? parseInt(w, 10) : (WORD_NUM[w] ?? 0);
  if (count <= 0) return null; // unknown → player sets it
  return { kind, count };
}

// Is there a conditional/optional "enters tapped" the player should decide?
export function entersTappedConditional(oracleText: string | null): boolean {
  if (!oracleText) return false;
  for (const clause of oracleText.toLowerCase().split(/\n|(?<=\.)\s+/)) {
    if (!/enters? (?:the battlefield )?tapped/.test(clause)) continue;
    if (/\bunless\b|\byou may\b|\bmay have\b|choose/.test(clause)) return true;
  }
  return false;
}

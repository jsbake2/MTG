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

// Is there a conditional/optional "enters tapped" the player should decide?
export function entersTappedConditional(oracleText: string | null): boolean {
  if (!oracleText) return false;
  for (const clause of oracleText.toLowerCase().split(/\n|(?<=\.)\s+/)) {
    if (!/enters? (?:the battlefield )?tapped/.test(clause)) continue;
    if (/\bunless\b|\byou may\b|\bmay have\b|choose/.test(clause)) return true;
  }
  return false;
}

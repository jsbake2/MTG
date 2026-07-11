// Renders a mana cost string like "{2}{R}{R}" as colored pips.
const COLOR_BG: Record<string, string> = {
  W: "#f8f6d8",
  U: "#3b7dd8",
  B: "#4b4b52",
  R: "#d3452b",
  G: "#2f9e58",
  C: "#c9c6be",
};

function pipStyle(sym: string): { bg: string; fg: string } {
  if (/^\d+$/.test(sym) || sym === "X" || sym === "C") return { bg: "#c9c6be", fg: "#1a1a1a" };
  const letters = sym.split("").filter((c) => "WUBRG".includes(c));
  if (letters.length === 1) return { bg: COLOR_BG[letters[0]!]!, fg: letters[0] === "W" ? "#3a3a1a" : "#111" };
  if (letters.length > 1) return { bg: "#caa94a", fg: "#111" };
  return { bg: "#8a8f99", fg: "#111" };
}

export function ManaCost({ cost, size = 16 }: { cost: string | null; size?: number }) {
  if (!cost) return null;
  const syms = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  return (
    <span className="inline-flex items-center gap-0.5 align-middle">
      {syms.map((s, i) => {
        const { bg, fg } = pipStyle(s);
        const label = s.replace("/", "");
        return (
          <span
            key={i}
            className="inline-flex items-center justify-center rounded-full font-bold"
            style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.6 }}
            title={s}
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}

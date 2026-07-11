// Renders a mana cost string like "{2}{R}{R}" as colored pips.
import { MANA_FG, MANA_HEX } from "@/lib/mana";

function pipStyle(sym: string): { bg: string; fg: string } {
  if (/^\d+$/.test(sym) || sym === "X" || sym === "C") return { bg: MANA_HEX.C!, fg: MANA_FG.C! };
  const letters = sym.split("").filter((c) => "WUBRG".includes(c));
  if (letters.length === 1) return { bg: MANA_HEX[letters[0]!]!, fg: MANA_FG[letters[0]!]! };
  if (letters.length > 1) return { bg: "#caa94a", fg: "#111" }; // hybrid
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
            style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.6, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18), 0 0 0 1px rgba(0,0,0,0.3)" }}
            title={s}
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}

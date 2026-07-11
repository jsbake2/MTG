import { useEffect, useMemo, useRef, useState } from "react";
import type { SetInfo } from "@mtg/shared";
import { api } from "@/api/client";

// Friendly labels + ordering for set-type groups (the "subset" categories).
const TYPE_LABELS: Record<string, string> = {
  expansion: "Expansions",
  core: "Core Sets",
  commander: "Commander",
  masters: "Masters / Reprint",
  draft_innovation: "Draft Innovation",
  arsenal: "Arsenal",
  starter: "Starter",
  duel_deck: "Duel Decks",
  from_the_vault: "From the Vault",
  premium_deck: "Premium Decks",
  spellbook: "Spellbook",
  box: "Box Sets",
  promo: "Promos",
  token: "Tokens",
};
const TYPE_ORDER = ["expansion", "core", "commander", "masters", "draft_innovation", "arsenal", "starter"];

export function SetFilter({ selected, onChange }: { selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const [sets, setSets] = useState<SetInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ sets: SetInfo[] }>("/api/cards/sets").then((r) => setSets(r.sets)).catch(() => setSets([]));
  }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.toLowerCase();
    const list = term ? sets.filter((s) => s.name.toLowerCase().includes(term) || s.code.toLowerCase().includes(term)) : sets;
    const groups = new Map<string, SetInfo[]>();
    for (const s of list) {
      const key = s.setType || "other";
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a);
      const ib = TYPE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return keys.map((k) => ({ key: k, label: TYPE_LABELS[k] ?? k.replace(/_/g, " "), sets: groups.get(k)! }));
  }, [sets, q]);

  function toggle(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  }

  return (
    <div className="relative" ref={ref}>
      <button className={`chip ${selected.size > 0 ? "border-table-accent text-table-accentSoft" : ""}`} onClick={() => setOpen((o) => !o)}>
        Sets{selected.size > 0 ? ` (${selected.size})` : ""} ▾
      </button>
      {open && (
        <div className="panel absolute z-30 mt-1 flex max-h-[70vh] w-80 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-table-border p-2">
            <input className="input flex-1 !py-1" placeholder="Filter sets…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {selected.size > 0 && (
              <button className="text-xs text-table-muted hover:text-red-300" onClick={() => onChange(new Set())}>
                Clear
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filtered.map((g) => (
              <div key={g.key} className="mb-2">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-table-muted">{g.label}</div>
                {g.sets.map((s) => (
                  <label key={s.code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-table-panel2">
                    <input type="checkbox" checked={selected.has(s.code)} onChange={() => toggle(s.code)} />
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-[10px] text-table-muted">
                      {s.code.toUpperCase()} · {s.count}
                    </span>
                  </label>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <div className="p-3 text-center text-xs text-table-muted">No sets match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CreateTableRequest, Deck, FormatDef, TableSummary } from "@mtg/shared";
import { RULESETS } from "@mtg/shared";
import { api } from "@/api/client";
import { useAuth } from "@/store/auth";
import { constructionMatches, useLegalDeckIds } from "@/lib/deckLegality";

// e.g. "Friday 7AM Standard game, ruleset Legacy" — day, hour, game type, ruleset.
function generatedTableName(gameTypeName: string, rulesetName: string, formatId: string, mode: "guided" | "freeform"): string {
  const d = new Date();
  const day = d.toLocaleDateString(undefined, { weekday: "long" });
  let h = d.getHours();
  const ampm = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  const type = mode === "freeform" ? "Tabletop" : gameTypeName;
  const suffix = formatId === "standard" ? `, ruleset ${rulesetName}` : "";
  return `${day} ${h}${ampm} ${type} game${suffix}`;
}

export function Play() {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [formats, setFormats] = useState<FormatDef[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [precons, setPrecons] = useState<Deck[]>([]);
  const [deckId, setDeckId] = useState<string>("");
  const [form, setForm] = useState<CreateTableRequest>({ name: "", formatId: "standard", ruleset: "standard", enforceBans: true, maxPlayers: 2, enforcement: "relaxed", mode: "guided" });
  const nameEdited = useRef(false);
  const nav = useNavigate();
  const { user } = useAuth();

  async function load() {
    const [t, f] = await Promise.all([
      api.get<{ tables: TableSummary[] }>("/api/tables"),
      api.get<{ formats: FormatDef[] }>("/api/formats"),
    ]);
    setTables(t.tables);
    setFormats(f.formats);
  }
  useEffect(() => {
    load();
    Promise.all([
      api.get<{ decks: Deck[] }>("/api/decks"),
      api.get<{ decks: Deck[] }>("/api/decks/public"),
    ]).then(([mine, pub]) => {
      setDecks(mine.decks);
      setPrecons(pub.decks);
    });
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);

  // Construction-compatible decks, then real legality for the chosen ruleset.
  const myMatched = useMemo(() => decks.filter((d) => constructionMatches(form.formatId, d)), [decks, form.formatId]);
  const preconMatched = useMemo(() => precons.filter((d) => constructionMatches(form.formatId, d)), [precons, form.formatId]);
  const { legalIds, loading: checkingLegality } = useLegalDeckIds([...myMatched, ...preconMatched], form.formatId, form.ruleset, form.enforceBans);
  const isLegal = (d: Deck) => form.formatId === "house" || legalIds.has(d.id);
  const myDecks = myMatched.filter(isLegal);
  const preconDecks = preconMatched.filter(isLegal);
  // Keep the selected deck valid when the format/ruleset changes or legality resolves.
  useEffect(() => {
    if (deckId && ![...myDecks, ...preconDecks].some((d) => d.id === deckId)) setDeckId("");
  }, [form.formatId, form.ruleset, form.enforceBans, legalIds]);

  // Commander's ruleset is fixed; Standard picks from the ruleset dropdown.
  useEffect(() => {
    if (form.formatId === "commander" && form.ruleset !== "commander") setForm((f) => ({ ...f, ruleset: "commander" }));
    if (form.formatId === "standard" && form.ruleset === "commander") setForm((f) => ({ ...f, ruleset: "standard" }));
  }, [form.formatId]);

  // Auto-name the table (until the host types their own name).
  const gameTypeName = form.formatId === "commander" ? "Commander" : "Standard";
  const rulesetName = RULESETS.find((r) => r.id === form.ruleset)?.name ?? form.ruleset;
  useEffect(() => {
    if (!nameEdited.current) setForm((f) => ({ ...f, name: generatedTableName(gameTypeName, rulesetName, f.formatId, f.mode) }));
  }, [gameTypeName, rulesetName, form.mode]);

  async function create() {
    const r = await api.post<{ table: TableSummary }>("/api/tables", {
      ...form,
      name: form.name || `${form.formatId} table`,
    });
    // Seat the creator with their chosen (format-legal) deck straight away.
    nav(`/table/${r.table.id}`, { state: deckId ? { autoDeckId: deckId } : undefined });
  }

  async function removeTable(id: string) {
    if (!confirm("Are you sure you want to delete this table?")) return;
    await api.del(`/api/tables/${id}`);
    load();
  }

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="mb-4 font-display text-2xl text-table-accentSoft">Play</h1>

      <div className="panel mb-6 p-4">
        <h2 className="mb-3 font-display text-lg">New table</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col text-xs text-table-muted">
            Table type
            <div className="mt-1 flex overflow-hidden rounded-md border border-table-border">
              {(["guided", "freeform"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm({ ...form, mode: m })}
                  className={`px-3 py-2 text-sm ${form.mode === m ? "bg-table-accent font-semibold text-black" : "bg-table-panel2 text-table-ink hover:bg-table-border/50"}`}
                >
                  {m === "guided" ? "Guided" : "Manual"}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col text-xs text-table-muted">
            Name
            <input className="input mt-1 w-56" value={form.name} onChange={(e) => { nameEdited.current = true; setForm({ ...form, name: e.target.value }); }} placeholder="Friday night game" />
          </label>
          <label className="flex flex-col text-xs text-table-muted">
            Game type
            <select className="input mt-1" value={form.formatId} onChange={(e) => setForm({ ...form, formatId: e.target.value })}>
              <option value="standard">Standard</option>
              <option value="commander">Commander</option>
            </select>
          </label>
          {form.formatId === "standard" && (
            <label className="flex flex-col text-xs text-table-muted">
              Ruleset (card pool)
              <select className="input mt-1" value={form.ruleset} onChange={(e) => setForm({ ...form, ruleset: e.target.value })}>
                {RULESETS.filter((r) => ["all", "standard", "modern", "legacy"].includes(r.id)).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col text-xs text-table-muted">
            Your deck {checkingLegality && <span className="text-table-muted/70">· checking legality…</span>}
            <select className="input mt-1 min-w-[12rem]" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              <option value="">— pick in lobby / spectate —</option>
              {myDecks.length > 0 && (
                <optgroup label="My decks">
                  {myDecks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.cardCount})
                    </option>
                  ))}
                </optgroup>
              )}
              {preconDecks.length > 0 && (
                <optgroup label="Preconstructed">
                  {preconDecks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.cardCount})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="flex flex-col text-xs text-table-muted">
            Players
            <select className="input mt-1" value={form.maxPlayers} onChange={(e) => setForm({ ...form, maxPlayers: Number(e.target.value) })}>
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 self-center text-xs text-table-muted" title="Enforce this ruleset's banned/restricted list. Turn off for casual games where banned cards are OK.">
            <input type="checkbox" checked={form.enforceBans} onChange={(e) => setForm({ ...form, enforceBans: e.target.checked })} />
            Enforce bans
          </label>
          {form.mode === "guided" && (
            <div className="flex flex-col text-xs text-table-muted">
              Rules engine
              <div className="mt-1 flex overflow-hidden rounded-md border border-table-border" title="How strictly the rules engine enforces turns, timing, land drops, summoning sickness and combat. Relaxed nudges but lets you do anything; Strict enforces the framework.">
                {(["relaxed", "strict"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm({ ...form, enforcement: r })}
                    className={`px-3 py-2 text-sm ${form.enforcement === r ? "bg-table-accent font-semibold text-black" : "bg-table-panel2 text-table-ink hover:bg-table-border/50"}`}
                  >
                    {r === "relaxed" ? "Relaxed" : "Strict"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button className="btn-primary" onClick={create}>
            Create & sit down
          </button>
        </div>
        <p className="mt-2 text-xs text-table-muted">
          {form.mode === "freeform" ? (
            <>
              <b className="text-table-ink">Tabletop (manual):</b> a virtual playmat — no automation. Move cards anywhere, tap, add
              counters, track life, make tokens, take notes. Just like playing in person. Deck legality is still enforced.
            </>
          ) : (
            <>
              <b className="text-table-ink">Guided:</b> the rules engine runs turns, phases, priority and combat. Relaxed nudges but
              lets you do anything (great for little ones); Strict enforces the framework.
            </>
          )}
        </p>
      </div>

      <h2 className="mb-2 font-display text-lg">Open tables</h2>
      {tables.length === 0 ? (
        <div className="panel p-6 text-center text-table-muted">No tables yet — create one above.</div>
      ) : (
        <div className="space-y-2">
          {tables.map((t) => (
            <div key={t.id} className="panel flex items-center gap-3 p-3">
              <div>
                <div className="font-semibold">{t.name}</div>
                <div className="text-xs text-table-muted">
                  {t.mode === "freeform" ? "🃏 Tabletop" : "⚙ Guided"} · {t.formatId} · {t.playerCount}/{t.maxPlayers} seated · {t.status}
                </div>
              </div>
              {user?.isAdmin && (
                <button className="btn-danger ml-auto" onClick={() => removeTable(t.id)}>
                  Delete
                </button>
              )}
              <button className={`${user?.isAdmin ? "" : "ml-auto"} btn-primary`} onClick={() => nav(`/table/${t.id}`)}>
                {t.status === "lobby" ? "Join" : "Open"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

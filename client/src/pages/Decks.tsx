import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Deck, FormatDef } from "@mtg/shared";
import { api } from "@/api/client";
import { MANA_HEX as MANA_DOT } from "@/lib/mana";

export function Decks() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [precons, setPrecons] = useState<Deck[]>([]);
  const [preconQuery, setPreconQuery] = useState("");
  const [ownFormat, setOwnFormat] = useState("");
  const [preconFormat, setPreconFormat] = useState("");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const [formats, setFormats] = useState<FormatDef[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  async function load() {
    setLoading(true);
    const [d, p, f] = await Promise.all([
      api.get<{ decks: Deck[] }>("/api/decks"),
      api.get<{ decks: Deck[] }>("/api/decks/public"),
      api.get<{ formats: FormatDef[] }>("/api/formats"),
    ]);
    setDecks(d.decks);
    setPrecons(p.decks);
    setFormats(f.formats);
    setLoading(false);
  }
  const [legalityFormat, setLegalityFormat] = useState("");
  const [legalityMap, setLegalityMap] = useState<Record<string, { valid: boolean; issuesCount: number }>>({});

  useEffect(() => {
    if (!legalityFormat) {
      setLegalityMap({});
      return;
    }
    api.get<{ results: Record<string, { valid: boolean; issuesCount: number }> }>(
      `/api/decks/legality?formatId=${legalityFormat}&precon=true`
    ).then((r) => {
      setLegalityMap(r.results);
    });
  }, [legalityFormat, decks, precons]);

  useEffect(() => {
    load();
  }, []);

  const formatName = (id: string) => formats.find((f) => f.id === id)?.name ?? id;

  async function duplicate(id: string) {
    const r = await api.post<{ id: string }>(`/api/decks/${id}/duplicate`);
    nav(`/decks/${r.id}`);
  }
  async function toggleStar(id: string, starred: boolean) {
    await api.post(`/api/decks/${id}/star`, { starred });
    load();
  }
  const byName = (a: Deck, b: Deck) => a.name.localeCompare(b.name);
  const byUpdated = (a: Deck, b: Deck) => (a.updatedAt < b.updatedAt ? 1 : -1);
  const sorter = sort === "name" ? byName : byUpdated;
  const filteredDecks = decks.filter((d) => !ownFormat || d.formatId === ownFormat).sort(sorter);
  const usedFormats = [...new Set([...decks, ...precons].map((d) => d.formatId))];
  const filteredPrecons = precons
    .filter((p) => p.name.toLowerCase().includes(preconQuery.toLowerCase()))
    .filter((p) => !preconFormat || p.formatId === preconFormat)
    .sort(byName);
  async function remove(id: string) {
    if (!confirm("Delete this deck?")) return;
    await api.del(`/api/decks/${id}`);
    load();
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl text-table-accentSoft">Your Decks</h1>
        <select className="input !py-1" value={ownFormat} onChange={(e) => setOwnFormat(e.target.value)} title="Filter by format">
          <option value="">All formats</option>
          {formats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select className="input !py-1" value={sort} onChange={(e) => setSort(e.target.value as "updated" | "name")} title="Sort">
          <option value="updated">Recently updated</option>
          <option value="name">Name (A–Z)</option>
        </select>
        <select className="input !py-1 border-emerald-500/30 text-emerald-400 bg-emerald-500/5 focus:ring-emerald-500/55 font-semibold" value={legalityFormat} onChange={(e) => setLegalityFormat(e.target.value)} title="Check legality">
          <option value="" className="text-table-ink font-normal">— Check Legality —</option>
          {formats.map((f) => (
            <option key={f.id} value={f.id} className="text-table-ink font-normal">
              {f.name} Legality
            </option>
          ))}
        </select>
        <Link to="/decks/new" className="btn-primary ml-auto">
          + New deck
        </Link>
      </div>
      {loading ? (
        <div className="text-table-muted">Loading…</div>
      ) : decks.length === 0 ? (
        <div className="panel p-8 text-center text-table-muted">
          No decks yet. <Link to="/decks/new" className="text-table-accentSoft underline">Build your first one</Link> — try searching a
          tribe like <i>vampire</i> or <i>dragon</i>.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredDecks.map((d) => (
            <div key={d.id} className="panel flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleStar(d.id, !d.isStarred)}
                    className={`text-lg transition-all duration-150 hover:scale-110 active:scale-90 ${d.isStarred ? "text-amber-400" : "text-table-muted/30 hover:text-amber-300/80"}`}
                    title={d.isStarred ? "Remove Favorite" : "Add Favorite"}
                  >
                    ★
                  </button>
                  <Link to={`/decks/${d.id}`} className="font-display text-lg text-table-ink hover:text-table-accentSoft">
                    {d.name}
                  </Link>
                </div>
                <div className="flex gap-0.5">
                  {d.colors.map((c) => (
                    <span key={c} className="h-3.5 w-3.5 rounded-full border border-white/25" style={{ background: MANA_DOT[c] ?? "#c9c6be" }} />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs mt-1">
                  {legalityFormat && legalityMap[d.id] !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      legalityMap[d.id].valid 
                        ? "bg-green-950/70 border border-green-500/40 text-green-400" 
                        : "bg-red-950/70 border border-red-500/40 text-red-400"
                    }`}>
                      {legalityMap[d.id].valid ? "✓ Legal" : `✕ Illegal`}
                    </span>
                  )}
                  <span className="text-table-muted capitalize">{formatName(d.formatId)}</span>
                  <span className="text-table-muted">·</span>
                  <span className="text-table-muted">{d.cardCount} cards</span>
              </div>
              {d.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {d.tags.map((tg) => (
                    <span key={tg} className="chip text-xs">
                      {tg}
                    </span>
                  ))}
                </div>
              )}
              {d.description && <p className="mt-2 line-clamp-2 text-sm text-table-muted">{d.description}</p>}
              <div className="mt-auto flex gap-2 pt-3">
                <Link to={`/decks/${d.id}`} className="btn-ghost">
                  Edit
                </Link>
                <button className="btn-ghost" onClick={() => duplicate(d.id)}>
                  Duplicate
                </button>
                <button className="btn-danger ml-auto" onClick={() => remove(d.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preconstructed decks */}
      <div className="mt-10">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl text-table-accentSoft">Preconstructed Decks</h2>
          <span className="text-sm text-table-muted">{filteredPrecons.length} of {precons.length} decks</span>
          <select className="input ml-auto !py-1" value={preconFormat} onChange={(e) => setPreconFormat(e.target.value)} title="Filter by format">
            <option value="">All formats</option>
            {formats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <input
            className="input w-56"
            placeholder="Search precons…"
            value={preconQuery}
            onChange={(e) => setPreconQuery(e.target.value)}
          />
        </div>
        {precons.length === 0 ? (
          <div className="panel p-6 text-center text-sm text-table-muted">
            No precons imported yet. On the server run{" "}
            <code className="rounded bg-black/40 px-1">docker compose run --rm app npm run import:precons</code>.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPrecons.slice(0, 120).map((d) => (
              <div key={d.id} className="panel flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/decks/${d.id}`} className="font-display text-base text-table-ink hover:text-table-accentSoft">
                    {d.name}
                  </Link>
                  <div className="flex gap-0.5">
                    {d.colors.map((c) => (
                      <span key={c} className="h-3 w-3 rounded-full border border-white/25" style={{ background: MANA_DOT[c] ?? "#c9c6be" }} />
                    ))}
                  </div>
                </div>
                 <div className="mt-1 flex items-center gap-1.5 text-xs">
                  {legalityFormat && legalityMap[d.id] !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      legalityMap[d.id].valid 
                        ? "bg-green-950/70 border border-green-500/40 text-green-400" 
                        : "bg-red-950/70 border border-red-500/40 text-red-400"
                    }`}>
                      {legalityMap[d.id].valid ? "✓ Legal" : `✕ Illegal`}
                    </span>
                  )}
                  <span className="text-table-muted">{formatName(d.formatId)} · {d.cardCount} cards</span>
                </div>
                <div className="mt-auto flex gap-2 pt-3">
                  <Link to={`/decks/${d.id}`} className="btn-ghost">
                    View
                  </Link>
                  <button className="btn-primary ml-auto" onClick={() => duplicate(d.id)}>
                    Copy to my decks
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

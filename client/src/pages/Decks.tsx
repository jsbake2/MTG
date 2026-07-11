import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Deck, FormatDef } from "@mtg/shared";
import { api } from "@/api/client";

const MANA_DOT: Record<string, string> = { W: "#f8f6d8", U: "#3b7dd8", B: "#4b4b52", R: "#d3452b", G: "#2f9e58" };

export function Decks() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [formats, setFormats] = useState<FormatDef[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  async function load() {
    setLoading(true);
    const [d, f] = await Promise.all([
      api.get<{ decks: Deck[] }>("/api/decks"),
      api.get<{ formats: FormatDef[] }>("/api/formats"),
    ]);
    setDecks(d.decks);
    setFormats(f.formats);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const formatName = (id: string) => formats.find((f) => f.id === id)?.name ?? id;

  async function duplicate(id: string) {
    const r = await api.post<{ id: string }>(`/api/decks/${id}/duplicate`);
    nav(`/decks/${r.id}`);
  }
  async function remove(id: string) {
    if (!confirm("Delete this deck?")) return;
    await api.del(`/api/decks/${id}`);
    load();
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl text-table-accentSoft">Your Decks</h1>
        <Link to="/decks/new" className="btn-primary">
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
          {decks.map((d) => (
            <div key={d.id} className="panel flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/decks/${d.id}`} className="font-display text-lg text-table-ink hover:text-table-accentSoft">
                  {d.name}
                </Link>
                <div className="flex gap-0.5">
                  {d.colors.map((c) => (
                    <span key={c} className="h-3.5 w-3.5 rounded-full border border-black/30" style={{ background: MANA_DOT[c] ?? "#c9c6be" }} />
                  ))}
                </div>
              </div>
              <div className="mt-1 text-sm text-table-muted">
                {formatName(d.formatId)} · {d.cardCount} cards
              </div>
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
    </div>
  );
}

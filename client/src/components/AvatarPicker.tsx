import { useEffect, useState } from "react";
import { useAuth } from "@/store/auth";
import { useCardSearch } from "@/hooks/useCardSearch";

// Pick any card's art as your profile avatar. Uses the art-crop image.
export function AvatarPicker({ onClose }: { onClose: () => void }) {
  const { user, setAvatar } = useAuth();
  const { setQ, opts, setOpts, resp, loading } = useCardSearch("");
  const [busy, setBusy] = useState(false);

  // Show a flat, ungrouped grid for picking.
  useEffect(() => {
    if (opts.group) setOpts({ ...opts, group: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(cardId: string | null) {
    setBusy(true);
    try {
      await setAvatar(cardId);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="panel flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-table-border p-3">
          <h3 className="font-display text-lg text-table-accentSoft">Choose your avatar</h3>
          <input className="input ml-auto w-64" autoFocus placeholder="Search a card — planeswalker, dragon, your favorite…" onChange={(e) => setQ(e.target.value)} />
          {user?.avatarCardId && (
            <button className="btn-ghost" disabled={busy} onClick={() => choose(null)}>
              Clear
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && <div className="p-6 text-center text-table-muted">Searching…</div>}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
            {resp?.groups[0]?.cards.map((c) => (
              <button
                key={c.id}
                className="overflow-hidden rounded-lg border border-table-border transition hover:-translate-y-0.5 hover:ring-2 hover:ring-table-accent"
                onClick={() => choose(c.id)}
                title={c.name}
                disabled={busy}
              >
                <img src={`/api/cards/${c.id}/art`} alt={c.name} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                <div className="truncate px-1 py-0.5 text-[10px] text-table-muted">{c.name}</div>
              </button>
            ))}
          </div>
          {resp && resp.groups[0]?.cards.length === 0 && !loading && (
            <div className="p-6 text-center text-table-muted">Search for a card to use its art.</div>
          )}
        </div>
      </div>
    </div>
  );
}

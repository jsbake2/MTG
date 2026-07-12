import type { TableState } from "@mtg/shared";
import type { TableConn } from "@/game/useTable";

// Shows on both tabletops when an undo is pending: the requester waits, any other
// seated player approves or denies.
export function UndoPrompt({ state, you, t }: { state: TableState; you: number | null; t: TableConn }) {
  const pu = state.pendingUndo;
  if (!pu || you === null) return null;
  const requesterName = state.players.find((p) => p.seat === pu.requesterSeat)?.name ?? "A player";
  const mine = pu.requesterSeat === you;
  return (
    <div className="fixed left-1/2 top-3 z-[9995] -translate-x-1/2 rounded-lg border border-table-accent bg-table-panel/95 px-4 py-2 shadow-2xl backdrop-blur">
      {mine ? (
        <div className="text-sm text-table-muted">⏪ Waiting for an opponent to approve your undo…</div>
      ) : (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-table-ink">
            <b>{requesterName}</b> requests an undo.
          </span>
          <button className="btn-primary !py-1" onClick={() => t.respondUndo(true)}>
            Approve
          </button>
          <button className="btn-ghost !py-1" onClick={() => t.respondUndo(false)}>
            Deny
          </button>
        </div>
      )}
    </div>
  );
}

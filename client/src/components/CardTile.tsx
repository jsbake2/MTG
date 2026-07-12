import { useState } from "react";
import type { CardSummary } from "@mtg/shared";

// A card image tile with graceful fallback and an optional "+"/count overlay.
export function CardImage({
  id,
  name,
  className = "",
  face = 0,
}: {
  id: string | null;
  name: string;
  className?: string;
  face?: number;
}) {
  const [errored, setErrored] = useState(false);
  const src = id ? `/api/cards/${id}/image?face=${face}` : null;
  if (!src || errored) {
    return (
      <div
        className={`card-aspect flex items-center justify-center rounded-lg border border-table-border bg-gradient-to-br from-table-panel2 to-table-bg p-2 text-center text-[11px] leading-tight text-table-muted ${className}`}
      >
        {name}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      onError={() => setErrored(true)}
      className={`card-aspect w-full rounded-lg object-cover shadow-card ${className}`}
    />
  );
}

export function CardTile({
  card,
  onClick,
  overlay,
  zoomOnHover = true,
}: {
  card: CardSummary;
  onClick?: (c: CardSummary) => void;
  overlay?: React.ReactNode;
  zoomOnHover?: boolean;
}) {
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  return (
    <button
      type="button"
      onClick={() => onClick?.(card)}
      onMouseEnter={zoomOnHover ? (e) => setZoom({ x: e.clientX, y: e.clientY }) : undefined}
      onMouseMove={zoomOnHover ? (e) => setZoom({ x: e.clientX, y: e.clientY }) : undefined}
      onMouseLeave={() => setZoom(null)}
      className="group relative block w-full text-left transition hover:-translate-y-0.5 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-table-accent rounded-lg"
      title={`${card.name} · ${card.setCode.toUpperCase()} ${card.year || ""}`}
    >
      <CardImage id={card.id} name={card.name} />
      {overlay}
      {/* Personal hover-zoom so small grid cards are readable. */}
      {zoom && card.id && (
        <span
          className="pointer-events-none fixed z-[60] block"
          style={{ left: Math.min(zoom.x + 20, window.innerWidth - 260), top: Math.min(Math.max(8, zoom.y - 180), window.innerHeight - 380) }}
        >
          <img src={`/api/cards/${card.id}/image`} alt={card.name} className="w-60 rounded-xl shadow-2xl ring-1 ring-black/50 card-aspect" />
        </span>
      )}
    </button>
  );
}

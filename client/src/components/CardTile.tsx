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
}: {
  card: CardSummary;
  onClick?: (c: CardSummary) => void;
  overlay?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(card)}
      className="group relative block w-full text-left transition hover:-translate-y-0.5 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-table-accent rounded-lg"
      title={`${card.name} · ${card.setCode.toUpperCase()} ${card.year || ""}`}
    >
      <CardImage id={card.id} name={card.name} />
      {overlay}
    </button>
  );
}

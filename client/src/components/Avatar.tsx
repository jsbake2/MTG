// Round profile avatar built from a card's art crop, with an initials fallback.
export function Avatar({
  cardId,
  name,
  size = 32,
  ring,
}: {
  cardId: string | null | undefined;
  name: string;
  size?: number;
  ring?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const cls = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-table-panel2 ${ring ? "ring-2 ring-table-accent" : "border border-table-border"}`;
  if (!cardId) {
    return (
      <span className={cls} style={{ width: size, height: size, fontSize: size * 0.4 }} title={name}>
        <span className="font-semibold text-table-muted">{initials}</span>
      </span>
    );
  }
  return (
    <span className={cls} style={{ width: size, height: size }} title={name}>
      <img src={`/api/cards/${cardId}/art`} alt={name} className="h-full w-full object-cover" />
    </span>
  );
}

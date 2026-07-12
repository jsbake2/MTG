import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { GameObject, PlayerState, TableState, Card } from "@mtg/shared";
import type { TableConn } from "@/game/useTable";
import { CardImage } from "@/components/CardTile";
import { Avatar } from "@/components/Avatar";
import { useSettings } from "@/store/settings";
import { RollOverlay, ZoneBrowserModal } from "@/pages/Table";
import { api } from "@/api/client";
import { playRoll } from "@/lib/sound";
import type { TokenCard } from "@/pages/Table";

const GRID = 24; // standard MTG Arena snap size
const snap = (n: number) => Math.round(n / GRID) * GRID;

interface DragState {
  ids: string[];
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
}

interface Pile {
  key: string;
  seat: number;
  x: number;
  y: number;
  cards: GameObject[]; // bottom -> top
}

interface ActiveRollAnimation {
  id: string;
  sides: number;
  result: number;
  startX: number;
  startY: number;
  midX: number;
  midY: number;
  bounceX: number;
  bounceY: number;
  endX: number;
  endY: number;
}

interface FlyingCard {
  id: string;
  cardId: string | null;
  startX: number;
  startY: number;
}

export function FreeformBoard({ t, state }: { t: TableConn; state: TableState }) {
  const you = t.you;
  const me = state.players.find((p) => p.seat === you) ?? null;
  const opponents = state.players.filter((p) => p.seat !== you);
  const matRef = useRef<HTMLDivElement>(null);
  const { handCardWidth, setHandCardWidth } = useSettings();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [handDrag, setHandDrag] = useState<{ id: string; cardId: string | null; name: string; x: number; y: number; isToken?: boolean; power?: string | number; toughness?: string | number; typeLine?: string } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ id: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [browse, setBrowse] = useState<{ zoneId: string; title: string } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [chatText, setChatText] = useState("");

  // Tabletop canvas pan & zoom
  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Grid snap setting
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Toolbox panel
  const [toolboxOpen, setToolboxOpen] = useState(true);
  const [activeCounterTool, setActiveCounterTool] = useState<string | null>(null);
  const [draggingCounter, setDraggingCounter] = useState<string | null>(null);
  const [counterDragPos, setCounterDragPos] = useState({ x: 0, y: 0 });

  // Token spawning drawer
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");
  const [drawerTokens, setDrawerTokens] = useState<TokenCard[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);

  // Stacks Context Menus
  const [libraryMenu, setLibraryMenu] = useState<{ seat: number; x: number; y: number } | null>(null);

  // Collapsible Right Sidebar
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"chat" | "logs">("chat");

  // Hovered card details cache
  const [cardCache, setCardCache] = useState<Record<string, Card>>({});
  const [hoveredBoardCardId, setHoveredBoardCardId] = useState<string | null>(null);

  // Stacking direction configuration
  const [stackDirection, setStackDirection] = useState<"auto" | "horizontal" | "vertical">("auto");

  // Active rolls tray
  const [activeRolls, setActiveRolls] = useState<ActiveRollAnimation[]>([]);

  // Flying cards (draw animation)
  const [flyingCards, setFlyingCards] = useState<FlyingCard[]>([]);
  const prevLibraryCount = useRef<Record<number, number>>({});

  // Draggable zone positions (Library, Graveyard, Exile) saved to localStorage per table
  const [zonePositions, setZonePositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      const saved = localStorage.getItem(`mtg-zone-pos-${state.id}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem(`mtg-zone-pos-${state.id}`, JSON.stringify(zonePositions));
  }, [zonePositions, state.id]);

  const getZonePos = (seat: number, zoneName: string) => {
    const key = `${seat}:${zoneName}`;
    if (zonePositions[key]) return zonePositions[key];
    if (seat === 0) {
      if (zoneName === "library") return { x: 1060, y: 475 };
      if (zoneName === "graveyard") return { x: 1060, y: 640 };
      if (zoneName === "exile") return { x: 940, y: 640 };
    } else {
      if (zoneName === "library") return { x: 1060, y: 175 };
      if (zoneName === "graveyard") return { x: 1060, y: 10 };
      if (zoneName === "exile") return { x: 940, y: 10 };
    }
    return { x: 0, y: 0 };
  };

  const startZoneDrag = (seat: number, zoneName: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startPos = matPoint(e);
    const key = `${seat}:${zoneName}`;
    const initialPos = getZonePos(seat, zoneName);
    const offsetX = startPos.x - initialPos.x;
    const offsetY = startPos.y - initialPos.y;
    let hasMoved = false;

    const move = (ev: PointerEvent) => {
      const p = matPoint(ev);
      const dx = p.x - startPos.x;
      const dy = p.y - startPos.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true;
      }
      setZonePositions((prev) => ({
        ...prev,
        [key]: { x: p.x - offsetX, y: p.y - offsetY },
      }));
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!hasMoved) {
        if (zoneName === "library") {
          t.send({ type: "draw", seat, count: 1 });
        } else if (zoneName === "graveyard") {
          setBrowse({ zoneId: `graveyard:${seat}`, title: `${seat === you ? "Your" : "Opponent's"} Graveyard` });
        } else if (zoneName === "exile") {
          setBrowse({ zoneId: `exile:${seat}`, title: `${seat === you ? "Your" : "Opponent's"} Exile` });
        }
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const CARD_W = 108;
  const CARD_H = Math.round((CARD_W * 88) / 63);

  const objectsByZone = useMemo(() => {
    const map: Record<string, GameObject[]> = {};
    for (const o of Object.values(state.objects)) {
      const key = o.zone === "battlefield" ? `battlefield:${o.controllerSeat}` : `${o.zone}:${o.ownerSeat}`;
      (map[key] ??= []).push(o);
    }
    return map;
  }, [state.objects]);

  const myHand = you !== null ? ((t.hands[you] ?? []).map((id) => state.objects[id]).filter(Boolean) as GameObject[]) : [];

  // Smart stacking: permanents sharing a position (same seat + x + y) render as one pile
  const piles = useMemo<Pile[]>(() => {
    const map = new Map<string, Pile>();
    const order: string[] = [];
    for (const o of Object.values(state.objects)) {
      if (o.zone !== "battlefield") continue;
      const gx = o.x || 0;
      const gy = o.y || 0;
      const key = `${o.controllerSeat}:${gx}:${gy}`;
      let g = map.get(key);
      if (!g) {
        g = { key, seat: o.controllerSeat, x: gx, y: gy, cards: [] };
        map.set(key, g);
        order.push(key);
      }
      g.cards.push(o);
    }
    return order.map((k) => map.get(k)!);
  }, [state.objects]);

  // Latest values for the drag listeners (avoids stale closures).
  const env = useRef({ piles, CARD_W, CARD_H, you });
  env.current = { piles, CARD_W, CARD_H, you };

  // Fetch card details for caching
  useEffect(() => {
    const cardIds = Array.from(
      new Set(
        Object.values(state.objects)
          .map((o) => o.cardId)
          .filter((id) => id && !cardCache[id]) as string[]
      )
    );
    if (cardIds.length === 0) return;
    Promise.all(
      cardIds.map((id) =>
        api.get<{ card: Card }>(`/api/cards/${id}`).then((r) => r.card)
      )
    ).then((cards) => {
      setCardCache((prev) => {
        const next = { ...prev };
        for (const c of cards) {
          if (c) next[c.id] = c;
        }
        return next;
      });
    });
  }, [state.objects]);

  // Dynamically load tokens for drawer search
  useEffect(() => {
    if (!tokenDrawerOpen) return;
    setTokensLoading(true);
    const id = setTimeout(() => {
      api
        .get<{ tokens: TokenCard[] }>(`/api/cards/tokens?q=${encodeURIComponent(tokenSearchQuery)}`)
        .then((r) => setDrawerTokens(r.tokens))
        .finally(() => setTokensLoading(false));
    }, 250);
    return () => clearTimeout(id);
  }, [tokenSearchQuery, tokenDrawerOpen]);

  // Track library draw animation
  useEffect(() => {
    if (you === null) return;
    const count = (objectsByZone[`library:${you}`] ?? []).length;
    const prev = prevLibraryCount.current[you];
    if (prev !== undefined && count < prev) {
      // Card was drawn, trigger fly from current library position
      const cards = objectsByZone[`library:${you}`] ?? [];
      const topCard = cards[cards.length - 1];
      const libLoc = getZonePos(you, "library");
      const startX = libLoc.x;
      const startY = libLoc.y;
      
      const newFly: FlyingCard = {
        id: Math.random().toString(),
        cardId: topCard?.cardId ?? null,
        startX,
        startY,
      };
      setFlyingCards((f) => [...f, newFly]);
      setTimeout(() => {
        setFlyingCards((f) => f.filter((item) => item.id !== newFly.id));
      }, 480);
    }
    prevLibraryCount.current[you] = count;
  }, [state.objects, you, zonePositions]);

  // Find card at exact screen coordinates (used for dropping counters)
  const getCardAt = (clientX: number, clientY: number) => {
    const r = matRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = (clientX - r.left) / zoom;
    const y = (clientY - r.top) / zoom;
    
    const invert = you === 1;
    for (const pile of piles) {
      const rx = invert ? (1200 - pile.x - CARD_W) : pile.x;
      const ry = invert ? (800 - pile.y - CARD_H) : pile.y;
      
      const isOver = x >= rx && x <= rx + CARD_W && y >= ry && y <= ry + CARD_H;
      if (isOver && pile.cards.length > 0) {
        return pile.cards[pile.cards.length - 1]; // top card in stack
      }
    }
    return null;
  };

  // Dice roll tumble sequence
  const triggerTumbleRoll = (sides: number) => {
    playRoll();
    const result = Math.floor(Math.random() * sides) + 1;
    const startX = Math.random() * 80 - 40;
    const startY = Math.random() * 80 - 40;
    const midX = Math.random() * 260 - 130;
    const midY = -Math.random() * 150 - 80;
    const bounceX = Math.random() * 320 - 160;
    const bounceY = Math.random() * 80 + 60;
    const endX = Math.random() * 160 - 80;
    const endY = Math.random() * 160 - 80;

    const newRoll: ActiveRollAnimation = {
      id: Math.random().toString(),
      sides,
      result,
      startX,
      startY,
      midX,
      midY,
      bounceX,
      bounceY,
      endX,
      endY,
    };

    setActiveRolls((prev) => [...prev, newRoll]);

    t.send({
      type: "roll",
      seat: you ?? 0,
      sides,
      count: 1,
      label: `rolled a d${sides} (result: ${result})`,
    });

    setTimeout(() => {
      setActiveRolls((prev) => prev.filter((r) => r.id !== newRoll.id));
    }, 4500);
  };

  // Coordinates on mat corrected for zoom
  function matPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = matRef.current?.getBoundingClientRect();
    return {
      x: (e.clientX - (r?.left ?? 0)) / zoom,
      y: (e.clientY - (r?.top ?? 0)) / zoom,
    };
  }

  // Pan Backdrop Handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.06 : 0.94;
    setZoom((z) => Math.min(2.5, Math.max(0.4, z * factor)));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("freeform-felt")) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX, panY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggingCounter) {
      setCounterDragPos({ x: e.clientX, y: e.clientY });
    }
    if (!isPanning) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setPanX(panStart.current.panX + dx);
    setPanY(panStart.current.panY + dy);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingCounter) {
      const card = getCardAt(e.clientX, e.clientY);
      if (card) {
        t.send({ type: "add_counter", objectId: card.id, counterType: draggingCounter, delta: 1 });
      }
      setDraggingCounter(null);
    }
    setIsPanning(false);
  };

  // Dragging cards
  function startDrag(ids: string[], originX: number, originY: number, e: React.PointerEvent) {
    if (you === null) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    
    const invert = you === 1;
    const actualOriginX = invert ? (1200 - originX - CARD_W) : originX;
    const actualOriginY = invert ? (800 - originY - CARD_H) : originY;

    const p = matPoint(e);
    setExpanded(null);
    setDrag({ ids, offsetX: p.x - actualOriginX, offsetY: p.y - actualOriginY, x: actualOriginX, y: actualOriginY });
  }

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const p = matPoint(e);
      setDrag((d) => (d ? { ...d, x: p.x - d.offsetX, y: p.y - d.offsetY } : d));
    };
    const up = () => {
      setDrag((d) => {
        if (d) {
          const { piles: pl, CARD_W: cw, CARD_H: ch, you: me } = env.current;
          let tx = Math.max(0, snapEnabled ? snap(d.x) : Math.round(d.x));
          let ty = Math.max(0, snapEnabled ? snap(d.y) : Math.round(d.y));

          // Snap onto nearby pile
          for (const target of pl) {
            if (target.cards.some((c) => d.ids.includes(c.id))) continue;
            if (Math.abs(target.x - d.x) < cw * 0.6 && Math.abs(target.y - d.y) < ch * 0.5) {
              tx = target.x;
              ty = target.y;
              break;
            }
          }

          const invert = me === 1;
          const finalX = invert ? (1200 - tx - cw) : tx;
          const finalY = invert ? (800 - ty - ch) : ty;

          for (const id of d.ids) t.send({ type: "move_card", objectId: id, toZone: "battlefield", toSeat: me ?? undefined, x: finalX, y: finalY });
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, snapEnabled]);

  // Hand cascade
  function playFromHand(o: GameObject) {
    const mine = Object.values(state.objects).filter((b) => b.zone === "battlefield" && b.controllerSeat === you).length;
    const invert = you === 1;
    const baseCol = mine % 8;
    const baseRow = Math.floor(mine / 8);

    let x = 80 + baseCol * Math.round(CARD_W * 1.1);
    let y = 480 + baseRow * 44;

    if (invert) {
      x = 80 + baseCol * Math.round(CARD_W * 1.1);
      y = 120 + baseRow * 44;
    }

    t.send({ type: "move_card", objectId: o.id, toZone: "battlefield", toSeat: you ?? undefined, x, y });
  }

  // Hand drag
  function onHandPointerDown(o: GameObject, e: React.PointerEvent) {
    if (you === null) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setHandDrag({ id: o.id, cardId: o.cardId, name: o.name, x: e.clientX, y: e.clientY });
  }

  // Drag token from picker drawer
  const onTokenPointerDown = (tk: TokenCard, e: React.PointerEvent) => {
    if (you === null) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setHandDrag({
      id: "create-token-" + Math.random(),
      cardId: tk.id,
      name: tk.name,
      x: e.clientX,
      y: e.clientY,
      isToken: true,
      power: tk.power ?? undefined,
      toughness: tk.toughness ?? undefined,
      typeLine: tk.typeLine ?? undefined,
    });
  };

  useEffect(() => {
    if (!handDrag) return;
    const move = (e: PointerEvent) => setHandDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    const up = (e: PointerEvent) => {
      setHandDrag((d) => {
        if (d && you !== null) {
          const r = matRef.current?.getBoundingClientRect();
          const overMat = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (overMat && r) {
            const renderDropX = (e.clientX - r.left - (CARD_W * zoom) / 2) / zoom;
            const renderDropY = (e.clientY - r.top - (CARD_H * zoom) / 2) / zoom;

            const tx = Math.max(0, snapEnabled ? snap(renderDropX) : Math.round(renderDropX));
            const ty = Math.max(0, snapEnabled ? snap(renderDropY) : Math.round(renderDropY));

            const invert = you === 1;
            const finalX = invert ? (1200 - tx - CARD_W) : tx;
            const finalY = invert ? (800 - ty - CARD_H) : ty;

            if (d.id.startsWith("create-token-")) {
              const num = (v: string | number | null | undefined) => {
                if (v === undefined || v === null) return undefined;
                return typeof v === "number" ? v : parseInt(v.toString().replace(/[^0-9-]/g, ""), 10) || undefined;
              };
              t.send({
                type: "create_token",
                seat: you,
                name: d.name,
                cardId: d.cardId,
                oracleId: null,
                power: num(d.power),
                toughness: num(d.toughness),
                x: finalX,
                y: finalY,
              });
            } else {
              t.send({ type: "move_card", objectId: d.id, toZone: "battlefield", toSeat: you, x: finalX, y: finalY });
            }
          } else {
            if (!d.id.startsWith("create-token-")) {
              const o = state.objects[d.id];
              if (o) playFromHand(o);
            }
          }
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [handDrag, you, zoom, snapEnabled]);

  // Hand sort and filters
  const [handSort, setHandSort] = useState<"name" | "cmc" | "color" | "type">("name");
  const [handFilter, setHandFilter] = useState<"all" | "land" | "nonland">("all");
  const [handQuery, setHandQuery] = useState("");

  const sortedAndFilteredHand = useMemo(() => {
    let list = [...myHand];
    if (handQuery.trim()) {
      const q = handQuery.toLowerCase();
      list = list.filter((o) => o.name.toLowerCase().includes(q));
    }
    if (handFilter === "land") {
      list = list.filter((o) => o.cardTypes?.includes("Land"));
    } else if (handFilter === "nonland") {
      list = list.filter((o) => !o.cardTypes?.includes("Land"));
    }

    list.sort((a, b) => {
      if (handSort === "cmc") {
        const cmcA = a.cardId ? cardCache[a.cardId]?.cmc ?? 0 : 0;
        const cmcB = b.cardId ? cardCache[b.cardId]?.cmc ?? 0 : 0;
        return cmcA - cmcB;
      }
      if (handSort === "color") {
        const colA = a.cardId ? (cardCache[a.cardId]?.colors ?? []).join("") : "";
        const colB = b.cardId ? (cardCache[b.cardId]?.colors ?? []).join("") : "";
        return colA.localeCompare(colB);
      }
      if (handSort === "type") {
        const typeA = a.cardId ? (cardCache[a.cardId]?.typeLine ?? "") : "";
        const typeB = b.cardId ? (cardCache[b.cardId]?.typeLine ?? "") : "";
        return typeA.localeCompare(typeB);
      }
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [myHand, handQuery, handFilter, handSort, cardCache]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#07090c] text-white select-none">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-table-border bg-[#0b0f19] px-3 py-1.5 text-sm z-30">
        <Link to="/play" className="text-table-muted hover:text-table-ink font-semibold">← Leave</Link>
        <span className={`h-2.5 w-2.5 rounded-full ${t.connected ? "bg-green-400 shadow-pulse" : "bg-red-500"}`} />
        <span className="font-display text-table-accentSoft font-semibold">{state.name}</span>
        <span className="chip bg-table-accent/15 border-table-accent/30 text-table-accentSoft">🃏 Manual Sandbox</span>

        <button className={`btn-ghost !py-1 text-xs ml-4 ${toolboxOpen ? "text-table-accentSoft bg-table-accent/10 border-table-accent/30" : ""}`} onClick={() => setToolboxOpen(!toolboxOpen)}>🛠 Toolbox</button>
        <button className={`btn-ghost !py-1 text-xs ${tokenDrawerOpen ? "text-table-accentSoft bg-table-accent/10 border-table-accent/30" : ""}`} onClick={() => setTokenDrawerOpen(!tokenDrawerOpen)}>🃏 Tokens Drawer</button>
        <button className={`btn-ghost !py-1 text-xs ${!sidebarCollapsed ? "text-table-accentSoft bg-table-accent/10 border-table-accent/30" : ""}`} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>💬 Chat/Log</button>

        <label className="flex items-center gap-1.5 text-xs text-table-muted ml-4 cursor-pointer select-none">
          <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} className="rounded border-table-border accent-table-accent bg-table-panel" />
          Snap grid (24px)
        </label>

        {state.status === "finished" && (
          <span className="rounded bg-table-accent px-2 py-0.5 text-black font-semibold ml-2">{state.players.find((p) => p.seat === state.winnerSeat)?.name} wins!</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button className={`btn-ghost !py-1 ${notesOpen ? "text-table-accentSoft" : ""}`} onClick={() => setNotesOpen((v) => !v)}>📝 Notes</button>
          <button className="btn-ghost !py-1" onClick={() => t.undo()}>Undo</button>
          {you !== null && state.status !== "finished" && (
            <button className="btn-ghost !py-1 text-red-300 hover:border-red-400" onClick={() => { if (confirm("Resign this game?")) t.send({ type: "concede", seat: you }); }}>
              Resign
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 relative">
        {/* Left Toolbox */}
        <div className={`shrink-0 flex flex-col border-r border-table-border bg-[#0b0f19] transition-all duration-300 z-20 ${toolboxOpen ? "w-56" : "w-0 overflow-hidden"}`}>
          <div className="border-b border-table-border p-3 flex items-center justify-between">
            <span className="font-semibold text-table-accentSoft">🛠 Toolbox</span>
            <button className="text-table-muted hover:text-table-ink" onClick={() => setToolboxOpen(false)}>✕</button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
            {/* Dice Tray */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-table-muted mb-2">Dice Tray</div>
              <div className="grid grid-cols-3 gap-1.5">
                {[4, 6, 8, 10, 12, 20].map((sides) => (
                  <button
                    key={sides}
                    className="btn-ghost !p-1 text-xs font-semibold flex flex-col items-center justify-center border border-table-border/45 bg-table-panel2/30 hover:border-table-accent/40 rounded h-[72px]"
                    onClick={() => triggerTumbleRoll(sides)}
                    title={`Roll d${sides}`}
                  >
                    <div className="w-10 h-10 mb-0.5 pointer-events-none">
                      <DiceGraphic sides={sides} result={sides} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {/* Tokens Button Shortcut */}
            <div>
              <button className="btn-primary w-full text-xs" onClick={() => setTokenDrawerOpen(!tokenDrawerOpen)}>
                {tokenDrawerOpen ? "✕ Close Tokens Drawer" : "🃏 Open Tokens Drawer"}
              </button>
            </div>
            {/* Counters Box */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-table-muted mb-2">Counters Box</div>
              <div className="text-[9px] text-table-muted mb-2 leading-relaxed">
                <span className="text-table-accentSoft font-semibold">Click & Drag</span> counters directly onto cards, or click to use as a click-and-apply tool:
              </div>
              <div className="flex flex-col gap-1.5">
                {[
                  { type: "+1/+1", label: "+1/+1 Counter", color: "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/5" },
                  { type: "-1/-1", label: "-1/-1 Counter", color: "text-rose-400 border-rose-500/30 hover:bg-rose-500/5" },
                  { type: "charge", label: "Charge Counter", color: "text-amber-400 border-amber-500/30 hover:bg-amber-500/5" },
                  { type: "loyalty", label: "Loyalty Counter", color: "text-sky-400 border-sky-500/30 hover:bg-sky-500/5" },
                ].map((c) => (
                  <button
                    key={c.type}
                    className={`btn-ghost !py-1.5 text-xs text-left border rounded cursor-grab active:cursor-grabbing ${c.color} ${activeCounterTool === c.type ? "ring-2 ring-table-accent bg-table-accent/15" : ""}`}
                    onClick={() => setActiveCounterTool(activeCounterTool === c.type ? null : c.type)}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setDraggingCounter(c.type);
                      setCounterDragPos({ x: e.clientX, y: e.clientY });
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Tokens Drawer overlay (floating on the left, next to toolbox) */}
        <div className={`shrink-0 flex flex-col border-r border-table-border bg-[#090d14]/95 backdrop-blur-md transition-all duration-300 z-20 absolute left-0 inset-y-0 ${tokenDrawerOpen ? "w-[440px] translate-x-0" : "w-0 -translate-x-full overflow-hidden"}`} style={{ left: toolboxOpen ? 224 : 0 }}>
          <div className="border-b border-table-border p-3 flex items-center justify-between shrink-0">
            <span className="font-semibold text-table-accentSoft">🃏 Tokens Card Drawer</span>
            <input
              className="input !py-1 text-xs w-48 font-normal"
              placeholder="Search scryfall tokens..."
              value={tokenSearchQuery}
              onChange={(e) => setTokenSearchQuery(e.target.value)}
            />
            <button className="text-table-muted hover:text-table-ink text-sm px-1.5" onClick={() => setTokenDrawerOpen(false)}>✕</button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3.5">
            {tokensLoading && drawerTokens.length === 0 ? (
              <div className="py-12 text-center text-table-muted text-xs">Searching Scryfall database…</div>
            ) : drawerTokens.length === 0 ? (
              <div className="py-12 text-center text-table-muted text-xs">No tokens found. Type "Soldier", "Zombie", "Vampire", "Treasure"…</div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5">
                {drawerTokens.map((tk) => (
                  <div
                    key={tk.id}
                    className="cursor-grab active:cursor-grabbing hover:scale-105 transition-transform duration-100 relative group"
                    onPointerDown={(e) => onTokenPointerDown(tk, e)}
                    title="Drag and drop onto tabletop"
                  >
                    <CardImage id={tk.id} name={tk.name} />
                    <div className="absolute inset-x-0 bottom-0 bg-black/80 text-center py-0.5 text-[8px] font-semibold truncate rounded-b">
                      {tk.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* The mat viewport */}
        <div className="relative min-h-0 flex-1 overflow-hidden" onWheel={handleWheel}>
          {/* Zoom & Pan floating controls */}
          <div className="absolute left-4 top-4 z-20 flex flex-col gap-1 bg-black/60 p-1.5 rounded-lg border border-table-border/40 backdrop-blur-sm">
            <button className="btn-ghost !p-1.5 font-bold hover:text-table-accentSoft" onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))} title="Zoom In">＋</button>
            <button className="btn-ghost !p-1.5 font-bold hover:text-table-accentSoft" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))} title="Zoom Out">－</button>
            <button className="btn-ghost !p-1 text-[9px] hover:text-table-accentSoft uppercase tracking-wider font-semibold" onClick={() => { setZoom(1.0); setPanX(0); setPanY(0); }} title="Reset View">Reset</button>
          </div>

          {/* Opponents HUD (Top center) */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex gap-6 pointer-events-auto">
            {opponents.map((opp) => (
              <div key={opp.seat} className="flex items-center gap-2.5 bg-[#0b0f19]/90 border border-table-border/60 px-3 py-1.5 rounded-full shadow-2xl backdrop-blur-sm">
                <Avatar cardId={opp.avatarCardId} name={opp.name} size={36} ring={state.activeSeat === opp.seat} />
                <div className="flex flex-col">
                  <span className="text-[10px] text-table-muted font-bold truncate max-w-[80px]">{opp.name}</span>
                  <div className="flex items-center gap-1">
                    <button className="text-table-muted hover:text-white text-xs px-1 font-bold" onClick={() => t.send({ type: "adjust_life", seat: opp.seat, delta: -1 })}>−</button>
                    <span className={`text-sm font-display font-bold text-white px-1 ${opp.life <= 5 ? "text-red-400 animate-pulse" : "text-table-accentSoft"}`}>
                      {opp.life}
                    </span>
                    <button className="text-table-muted hover:text-white text-xs px-1 font-bold" onClick={() => t.send({ type: "adjust_life", seat: opp.seat, delta: 1 })}>+</button>
                  </div>
                </div>
                {opp.poison > 0 && <span className="text-[9px] font-bold text-green-300 border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 rounded-full">☠{opp.poison}</span>}
              </div>
            ))}
            {opponents.length === 0 && (
              <div className="text-[10px] text-table-muted bg-black/60 px-3 py-1 rounded-full border border-table-border/40">Spectating / waiting for players…</div>
            )}
          </div>

          {/* Bottom player HUD (You, Bottom left overlay) */}
          {me && (
            <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2.5 bg-[#0b0f19]/95 border border-table-border/60 px-3.5 py-2 rounded-full shadow-2xl backdrop-blur-sm">
              <Avatar cardId={me.avatarCardId} name={me.name} size={42} ring={state.activeSeat === me.seat} />
              <div className="flex flex-col">
                <span className="text-[10px] text-table-accentSoft font-bold truncate max-w-[100px]">{me.name} (You)</span>
                <div className="flex items-center gap-1.5">
                  <button className="text-table-muted hover:text-white text-xs px-1 font-bold" onClick={() => t.send({ type: "adjust_life", seat: me.seat, delta: -1 })}>−</button>
                  <span className={`text-base font-display font-bold text-white px-1 ${me.life <= 5 ? "text-red-400 animate-pulse" : "text-table-accent"}`}>
                    {me.life}
                  </span>
                  <button className="text-table-muted hover:text-white text-xs px-1 font-bold" onClick={() => t.send({ type: "adjust_life", seat: me.seat, delta: 1 })}>+</button>
                </div>
              </div>
              {me.poison > 0 && <span className="text-[9px] font-bold text-green-300 border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 rounded-full">☠{me.poison}</span>}
            </div>
          )}

          {/* Canvas container */}
          <div
            ref={matRef}
            className="freeform-felt relative tabletop-canvas"
            style={{
              minWidth: 1200,
              minHeight: 800,
              height: "100%",
              transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
              cursor: isPanning ? "grabbing" : "grab",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onClick={() => setExpanded(null)}
          >
            {/* midline separating zones */}
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-table-accent/15 border-b border-table-accent/5" />

            {/* Smart fanned out overlap stacks */}
            {piles.map((pile) => {
              const dragging = !!drag && pile.cards.some((c) => drag.ids.includes(c.id));
              
              const invert = you === 1;
              const x = dragging ? drag!.x : (invert ? (1200 - pile.x - CARD_W) : pile.x);
              const y = dragging ? drag!.y : (invert ? (800 - pile.y - CARD_H) : pile.y);
              
              const count = pile.cards.length;

              return (
                <div
                  key={pile.key}
                  className={`absolute ${dragging ? "z-30 pointer-events-none" : ""}`}
                  style={{
                    left: x,
                    top: y,
                    width: CARD_W,
                    height: CARD_H,
                    transition: dragging ? "none" : "left 0.08s, top 0.08s",
                  }}
                >
                  {pile.cards.map((c, idx) => {
                    const isHovered = hoveredBoardCardId === c.id;
                    const isLand = c.cardTypes?.includes("Land") ?? false;
                    
                    // Determine fanning offsets: Horizontal for lands, vertical for others
                    const useHorizontal = stackDirection === "horizontal" || (stackDirection === "auto" && isLand);
                    const offsetX = useHorizontal ? 20 : 0;
                    const offsetY = useHorizontal ? 0 : 24;
                    
                    const cardX = idx * offsetX;
                    const cardY = idx * offsetY;

                    const isMine = you !== null && c.controllerSeat === you;
                    
                    // Base rotations
                    let rotate = isMine ? "0deg" : "180deg";
                    if (c.tapped) {
                      rotate = isMine ? "90deg" : "270deg";
                    }

                    // Hover flips readability orientation to rightside up and zooms
                    if (isHovered) {
                      rotate = c.tapped ? "90deg" : "0deg";
                    }

                    return (
                      <div
                        key={c.id}
                        className={`absolute rounded-md transition-all duration-150 hover:scale-105 ${isMine ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${isHovered ? "z-50 scale-125 shadow-2xl ring-2 ring-table-accent/60" : "shadow-md"}`}
                        style={{
                          left: cardX,
                          top: cardY,
                          width: CARD_W,
                          height: CARD_H,
                          transform: `rotate(${rotate})`,
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (isMine) {
                            startDrag([c.id], pile.x + cardX, pile.y + cardY, e);
                          }
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          t.send({ type: "tap", objectId: c.id, tapped: !c.tapped });
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMenu({ id: c.id, x: e.clientX, y: e.clientY });
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeCounterTool) {
                            t.send({ type: "add_counter", objectId: c.id, counterType: activeCounterTool, delta: 1 });
                            setActiveCounterTool(null);
                          } else {
                            if (c.cardId && !c.faceDown) {
                              setHover({ id: c.cardId, name: c.name });
                            }
                          }
                        }}
                        onMouseEnter={() => {
                          setHoveredBoardCardId(c.id);
                        }}
                        onMouseLeave={() => {
                          setHoveredBoardCardId(null);
                        }}
                      >
                        <CardImage id={c.faceDown ? null : c.cardId} name={c.faceDown ? "Card" : c.name} className="rounded-md" />
                        
                        {/* Counters indicator overlay with +/- button manipulators */}
                        {c.counters.length > 0 && (
                          <div className="absolute -bottom-1 left-0 flex flex-col gap-0.5 z-20 pointer-events-auto">
                            {c.counters.map((cnt) => {
                              if (cnt.count === 0) return null;
                              return (
                                <div
                                  key={cnt.type}
                                  className="flex items-center gap-1 bg-black/95 border border-table-border/60 px-1 py-0.5 rounded text-[9px] font-bold text-white shadow-lg pointer-events-auto"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span>{cnt.type === "+1/+1" ? "+1/+1" : cnt.type === "-1/-1" ? "-1/-1" : cnt.type}: {cnt.count}</span>
                                  <button
                                    className="hover:text-red-400 font-bold px-0.5 text-xs text-table-muted"
                                    onClick={(e) => { e.stopPropagation(); t.send({ type: "add_counter", objectId: c.id, counterType: cnt.type, delta: -1 }); }}
                                  >
                                    −
                                  </button>
                                  <button
                                    className="hover:text-emerald-400 font-bold px-0.5 text-xs text-table-muted"
                                    onClick={(e) => { e.stopPropagation(); t.send({ type: "add_counter", objectId: c.id, counterType: cnt.type, delta: 1 }); }}
                                  >
                                    +
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        
                        {c.isCommander && <span className="absolute left-0 top-0 rounded bg-table-accent px-1 text-[9px] text-black font-semibold z-10 pointer-events-none">CMD</span>}
                      </div>
                    );
                  })}
                  {count > 1 && (
                    <span className="absolute -right-2.5 -top-2.5 z-20 flex h-5 min-w-5 items-center justify-center rounded-full border border-black/50 bg-table-accent px-1 text-[10px] font-bold text-black shadow-lg">
                      ×{count}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Visual Library, Graveyard, and Exile card stacks on the mat */}
            {state.players.map((p) => {
              const seat = p.seat;
              const libCards = objectsByZone[`library:${seat}`] ?? [];
              const graveCards = objectsByZone[`graveyard:${seat}`] ?? [];
              const exileCards = objectsByZone[`exile:${seat}`] ?? [];

              const invert = you === 1;

              // Absolute coordinates (draggable / persistent)
              const libLoc = getZonePos(seat, "library");
              const graveLoc = getZonePos(seat, "graveyard");
              const exileLoc = getZonePos(seat, "exile");

              // Local rendering coordinates corrected for perspective inversion
              const rxLib = invert ? (1200 - libLoc.x - CARD_W) : libLoc.x;
              const ryLib = invert ? (800 - libLoc.y - CARD_H) : libLoc.y;

              const rxGrave = invert ? (1200 - graveLoc.x - CARD_W) : graveLoc.x;
              const ryGrave = invert ? (800 - graveLoc.y - CARD_H) : graveLoc.y;

              const rxExile = invert ? (1200 - exileLoc.x - CARD_W) : exileLoc.x;
              const ryExile = invert ? (800 - exileLoc.y - CARD_H) : exileLoc.y;

              const topGraveCard = graveCards[graveCards.length - 1];
              const topExileCard = exileCards[exileCards.length - 1];

              return (
                <div key={seat} className="pointer-events-auto">
                  {/* Library stack */}
                  <div className="absolute" style={{ left: rxLib, top: ryLib }}>
                    <CardStackDeck
                      count={libCards.length}
                      label={`${p.name} (Lib)`}
                      onPointerDown={(e) => startZoneDrag(seat, "library", e)}
                      onRightClick={(e) => { e.preventDefault(); e.stopPropagation(); setLibraryMenu({ seat, x: e.clientX, y: e.clientY }); }}
                    />
                  </div>

                  {/* Graveyard stack */}
                  <div className="absolute" style={{ left: rxGrave, top: ryGrave }}>
                    <CardStackDeck
                      count={graveCards.length}
                      faceUpCardId={topGraveCard?.cardId}
                      label={`${p.name} (Grave)`}
                      onPointerDown={(e) => startZoneDrag(seat, "graveyard", e)}
                    />
                  </div>

                  {/* Exile stack */}
                  <div className="absolute" style={{ left: rxExile, top: ryExile }}>
                    <CardStackDeck
                      count={exileCards.length}
                      faceUpCardId={topExileCard?.cardId}
                      label={`${p.name} (Exile)`}
                      onPointerDown={(e) => startZoneDrag(seat, "exile", e)}
                    />
                  </div>
                </div>
              );
            })}

            {/* Smooth flying card animation projection */}
            {flyingCards.map((f) => (
              <div
                key={f.id}
                className="absolute z-50 pointer-events-none rounded-md animate-fly-draw"
                style={{
                  width: CARD_W,
                  height: CARD_H,
                  transformOrigin: "center",
                  "--fly-start-x": `${f.startX}px`,
                  "--fly-start-y": `${f.startY}px`,
                } as any}
              >
                <CardImage id={f.cardId} name="Card" className="rounded-md shadow-2xl ring-2 ring-table-accent/60 animate-spin-once" />
              </div>
            ))}
          </div>
        </div>

        {/* Collapsible right sidebar (chat + logs) */}
        <div className={`shrink-0 flex flex-col border-l border-table-border bg-[#0b0f19] transition-all duration-300 relative z-20 ${sidebarCollapsed ? "w-0 overflow-hidden" : "w-60"}`}>
          {/* Header tabs */}
          <div className="flex border-b border-table-border text-xs font-semibold bg-table-panel2/50 shrink-0">
            <button
              className={`flex-1 py-2 text-center border-b-2 transition-all ${sidebarTab === "chat" ? "border-table-accent text-table-accentSoft" : "border-transparent text-table-muted hover:text-table-ink"}`}
              onClick={() => setSidebarTab("chat")}
            >
              💬 Chat
            </button>
            <button
              className={`flex-1 py-2 text-center border-b-2 transition-all ${sidebarTab === "logs" ? "border-table-accent text-table-accentSoft" : "border-transparent text-table-muted hover:text-table-ink"}`}
              onClick={() => setSidebarTab("logs")}
            >
              📜 Log
            </button>
          </div>

          {/* Zones Quick Bar */}
          {you !== null && (
            <div className="grid grid-cols-2 gap-1 border-b border-table-border p-2 text-[10px] bg-table-panel2/20 shrink-0">
              <PileButton label="Library" count={(objectsByZone[`library:${you}`] ?? []).length} onClick={() => setBrowse({ zoneId: `library:${you}`, title: "Your Library" })} />
              <button className="chip" onClick={() => t.send({ type: "draw", seat: you, count: 1 })}>Draw</button>
              <PileButton label="Graveyard" count={(objectsByZone[`graveyard:${you}`] ?? []).length} onClick={() => setBrowse({ zoneId: `graveyard:${you}`, title: "Your Graveyard" })} />
              <PileButton label="Exile" count={(objectsByZone[`exile:${you}`] ?? []).length} onClick={() => setBrowse({ zoneId: `exile:${you}`, title: "Your Exile" })} />
              <button className="chip" onClick={() => t.send({ type: "shuffle", seat: you })}>Shuffle</button>
              <button className="chip" onClick={() => t.send({ type: "untap_all", seat: you })}>Untap all</button>
            </div>
          )}

          {/* Tab content */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5 text-xs">
            {sidebarTab === "logs" ? (
              // System Log
              <div className="space-y-1.5">
                {state.log.slice(-120).map((l) => (
                  <div key={l.id} className="leading-snug text-table-muted border-b border-table-border/10 pb-0.5">{l.text}</div>
                ))}
              </div>
            ) : (
              // Chat conversation
              <div className="space-y-1.5">
                {state.log.filter(l => l.text.includes(":") || l.text.includes("says") || l.text.toLowerCase().includes("chat") || l.text.toLowerCase().includes("rolled")).slice(-120).map((l) => (
                  <div key={l.id} className="leading-snug text-table-ink bg-black/20 p-1.5 rounded border border-table-border/30">{l.text}</div>
                ))}
                {state.log.filter(l => l.text.includes(":") || l.text.includes("says") || l.text.toLowerCase().includes("chat") || l.text.toLowerCase().includes("rolled")).length === 0 && (
                  <div className="text-center text-table-muted/60 mt-12 py-4">— No messages yet —</div>
                )}
              </div>
            )}
          </div>

          {/* Chat send footer */}
          {sidebarTab === "chat" && (
            <form
              className="flex gap-1 border-t border-table-border p-2 bg-[#0b0f19] shrink-0"
              onSubmit={(e) => { e.preventDefault(); if (chatText.trim()) t.chat(chatText.trim()); setChatText(""); }}
            >
              <input className="input flex-1 !py-1 text-xs" placeholder="Say something…" value={chatText} onChange={(e) => setChatText(e.target.value)} />
              <button className="btn-primary !px-2.5 !py-1 text-xs">Send</button>
            </form>
          )}
        </div>
      </div>

      {/* Your hand (centered in the hand pane) */}
      {you !== null && (
        <div className="shrink-0 border-t border-table-border bg-[#0b0f19] px-3 py-2 z-20">
          <div className="mb-1.5 flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-table-muted">
            <span>Your hand ({myHand.length})</span>
            
            <input
              className="input !py-0.5 text-xs w-32 lowercase font-normal"
              placeholder="filter hand…"
              value={handQuery}
              onChange={(e) => setHandQuery(e.target.value)}
            />
            
            <select className="input !py-0.5 text-xs capitalize font-normal" value={handFilter} onChange={(e) => setHandFilter(e.target.value as any)}>
              <option value="all">all cards</option>
              <option value="land">lands</option>
              <option value="nonland">spells</option>
            </select>

            <select className="input !py-0.5 text-xs capitalize font-normal" value={handSort} onChange={(e) => setHandSort(e.target.value as any)}>
              <option value="name">sort by name</option>
              <option value="cmc">sort by cost</option>
              <option value="color">sort by color</option>
              <option value="type">sort by type</option>
            </select>
            
            <button className="chip normal-case" onClick={() => you !== null && t.send({ type: "draw", seat: you, count: 1 })}>🃏 Draw</button>
            <label className="ml-auto flex items-center gap-1 normal-case font-semibold" title="Hand card size">
              🔍 Size
              <input type="range" min={80} max={240} step={6} value={handCardWidth} onChange={(e) => setHandCardWidth(Number(e.target.value))} className="w-24 accent-table-accent" />
            </label>
          </div>
          <div className="flex items-end justify-center gap-1.5 overflow-x-auto pb-1 min-h-[96px]">
            {sortedAndFilteredHand.map((o) => (
              <div
                key={o.id}
                className="shrink-0 cursor-grab touch-none transition-transform hover:-translate-y-2.5 active:cursor-grabbing"
                style={{ width: handCardWidth, opacity: handDrag?.id === o.id ? 0.4 : 1 }}
                onPointerDown={(e) => onHandPointerDown(o, e)}
                onMouseEnter={() => o.cardId && setHover({ id: o.cardId, name: o.name })}
                onMouseLeave={() => setHover(null)}
                title={`Drag to play ${o.name}`}
              >
                <CardImage id={o.cardId} name={o.name} />
              </div>
            ))}
            {myHand.length === 0 && <div className="py-4 text-xs text-table-muted">Empty — use Draw to pull from your library.</div>}
          </div>
        </div>
      )}

      {/* Floating active dice roll animations */}
      {activeRolls.map((roll) => (
        <div
          key={roll.id}
          className="pointer-events-none fixed left-1/2 top-1/3 z-50 dice-tumble flex h-16 w-16 items-center justify-center shadow-2xl"
          style={{
            ["--dx-start-x" as any]: `${roll.startX}px`,
            ["--dx-start-y" as any]: `${roll.startY}px`,
            ["--dx-mid-x" as any]: `${roll.midX}px`,
            ["--dx-mid-y" as any]: `${roll.midY}px`,
            ["--dx-bounce-x" as any]: `${roll.bounceX}px`,
            ["--dx-bounce-y" as any]: `${roll.bounceY}px`,
            ["--dx-end-x" as any]: `${roll.endX}px`,
            ["--dx-end-y" as any]: `${roll.endY}px`,
          }}
        >
          <DiceGraphic sides={roll.sides} result={roll.result} />
        </div>
      ))}

      {/* Floating draggable counter badge projection */}
      {draggingCounter && (
        <div
          className="pointer-events-none fixed z-50 flex items-center justify-center bg-black/90 border border-table-accent px-2 py-1 rounded text-xs font-bold text-white shadow-2xl"
          style={{ left: counterDragPos.x + 12, top: counterDragPos.y + 12 }}
        >
          ➕ {draggingCounter}
        </div>
      )}

      {/* Hand / Token drag floating projection */}
      {handDrag && (
        <div className="pointer-events-none fixed z-50" style={{ left: handDrag.x - (CARD_W * zoom) / 2, top: handDrag.y - (CARD_H * zoom) / 2, width: CARD_W * zoom }}>
          <CardImage id={handDrag.cardId} name={handDrag.name} className="rounded-md shadow-2xl ring-2 ring-table-accent/60" />
        </div>
      )}

      {menu && <FreeformCardMenu menu={menu} state={state} you={you} t={t} onClose={() => setMenu(null)} />}
      
      {/* Floating Library Stack context menu */}
      {libraryMenu && (
        <LibraryContextMenu
          menu={libraryMenu}
          t={t}
          onClose={() => setLibraryMenu(null)}
          onBrowse={() => {
            setBrowse({ zoneId: `library:${libraryMenu.seat}`, title: "Your Library" });
            setLibraryMenu(null);
          }}
        />
      )}

      {browse && (
        <ZoneBrowserModal
          title={browse.title}
          objects={objectsByZone[browse.zoneId] ?? []}
          onClose={() => setBrowse(null)}
          onSelect={(o) => { setBrowse(null); setMenu({ id: o.id, x: window.innerWidth / 2, y: window.innerHeight / 2 }); }}
        />
      )}
      
      {notesOpen && <Notepad tableId={state.id} onClose={() => setNotesOpen(false)} />}
      
      <RollOverlay roll={state.lastRoll} />
      
      {/* Selection detail overlay */}
      {hover && (
        <div className="pointer-events-none fixed bottom-28 left-4 z-40">
          <img src={`/api/cards/${hover.id}/image`} alt={hover.name} className="w-56 rounded-lg shadow-2xl card-aspect border-2 border-table-accent/40 bg-black" />
        </div>
      )}
    </div>
  );
}

// ---- Visual stack representing library / graveyard / exile ----
function CardStackDeck({
  count,
  faceUpCardId,
  label,
  onClick,
  onRightClick,
  onPointerDown,
}: {
  count: number;
  faceUpCardId?: string | null;
  label: string;
  onClick?: () => void;
  onRightClick?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const layers = Math.min(12, Math.ceil(count / 4));
  return (
    <div
      className="relative cursor-pointer select-none"
      style={{ width: 108, height: 150 }}
      onClick={onClick}
      onContextMenu={onRightClick}
      onPointerDown={onPointerDown}
      title={`${label} (${count} cards) - click to interact, right click library for options`}
    >
      {count === 0 ? (
        <div className="w-full h-full rounded-md border-2 border-dashed border-table-border/30 flex flex-col items-center justify-center text-center p-1 text-[10px] text-table-muted bg-black/10">
          <span className="font-semibold uppercase tracking-wider text-[8px] mb-1 leading-snug">{label}</span>
          <span className="text-[8px] opacity-60">empty</span>
        </div>
      ) : (
        <>
          {Array.from({ length: layers }).map((_, idx) => {
            const shift = idx * 0.9;
            return (
              <div
                key={idx}
                className="absolute rounded-md border border-black/50 bg-[#0f172a] shadow"
                style={{
                  left: -shift,
                  top: -shift,
                  width: 108,
                  height: 150,
                  zIndex: idx,
                }}
              />
            );
          })}
          <div
            className="absolute rounded-md"
            style={{
              left: -layers * 0.9,
              top: -layers * 0.9,
              width: 108,
              height: 150,
              zIndex: layers,
            }}
          >
            <CardImage id={faceUpCardId ?? null} name={faceUpCardId ? "Card" : "Back"} className="rounded-md shadow-card" />
            <span className="absolute -right-1.5 -top-1.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-black/50 bg-table-accent px-1 text-[9px] font-bold text-black shadow-lg">
              {count}
            </span>
            <div className="absolute inset-x-0 bottom-1 bg-black/75 py-0.5 text-center text-[9px] font-semibold text-table-muted uppercase tracking-wider rounded-b">
              {label}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PileButton({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button className="chip flex items-center justify-between hover:border-table-accent w-full" onClick={onClick}>
      <span>{label}</span>
      <span className="tabular-nums text-table-accentSoft font-semibold">{count}</span>
    </button>
  );
}

// ---- floating Library Context Menu ----
function LibraryContextMenu({ menu, t, onClose, onBrowse }: { menu: { seat: number; x: number; y: number }; t: TableConn; onClose: () => void; onBrowse: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [onClose]);
  const act = (fn: () => void) => () => { fn(); onClose(); };
  return (
    <div ref={ref} className="panel fixed z-50 w-48 overflow-hidden py-1" style={{ left: menu.x, top: menu.y }}>
      <div className="truncate border-b border-table-border px-3 py-1 text-xs text-table-muted font-bold">Library Options</div>
      <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2" onClick={act(() => t.send({ type: "draw", seat: menu.seat, count: 1 }))}>Draw 1 Card</button>
      <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2" onClick={act(() => t.send({ type: "draw", seat: menu.seat, count: 7 }))}>Draw 7 Cards</button>
      <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2" onClick={act(() => t.send({ type: "shuffle", seat: menu.seat }))}>Shuffle Library</button>
      <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2" onClick={act(onBrowse)}>Browse Library</button>
    </div>
  );
}

// ---- per-card manual menu -------------------------------------------------
function FreeformCardMenu({ menu, state, you, t, onClose }: { menu: { id: string; x: number; y: number }; state: TableState; you: number | null; t: TableConn; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [onClose]);
  const o = state.objects[menu.id];
  if (!o) return null;
  const mine = you !== null && o.controllerSeat === you;
  const act = (fn: () => void) => () => { fn(); onClose(); };
  const move = (zone: GameObject["zone"], toTop?: boolean) => t.send({ type: "move_card", objectId: o.id, toZone: zone, toSeat: o.ownerSeat, toTop });
  const Item = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
    <button className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2 ${danger ? "text-red-300 font-semibold" : ""}`} onClick={act(onClick)}>{label}</button>
  );
  const style: React.CSSProperties = { left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 340) };
  return (
    <div ref={ref} className="panel fixed z-50 w-52 overflow-hidden py-1" style={style}>
      <div className="truncate border-b border-table-border px-3 py-1 text-xs text-table-muted font-bold">{o.name}{!mine && <span className="ml-1 text-amber-300/80">· opponent's</span>}</div>
      <Item label={o.tapped ? "Untap" : "Tap"} onClick={() => t.send({ type: "tap", objectId: o.id, tapped: !o.tapped })} />
      <Item label="Flip face down/up" onClick={() => t.send({ type: "flip", objectId: o.id, faceDown: !o.faceDown })} />
      <div className="my-1 border-t border-table-border" />
      <Item label="＋ +1/+1 counter" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "+1/+1", delta: 1 })} />
      <Item label="－ +1/+1 counter" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "+1/+1", delta: -1 })} />
      <Item label="＋ -1/-1 counter" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "-1/-1", delta: 1 })} />
      <Item label="＋ loyalty" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "loyalty", delta: 1 })} />
      <div className="my-1 border-t border-table-border" />
      <Item label="→ Hand" onClick={() => move("hand")} />
      <Item label="→ Graveyard" onClick={() => move("graveyard")} danger />
      <Item label="→ Exile" onClick={() => move("exile")} />
      <Item label="→ Library (top)" onClick={() => move("library", true)} />
      <Item label="→ Library (bottom)" onClick={() => move("library", false)} />
    </div>
  );
}

// ---- notepad ------------------------
function Notepad({ tableId, onClose }: { tableId: string; onClose: () => void }) {
  const key = `mtg-notes-${tableId}`;
  const [text, setText] = useState(() => localStorage.getItem(key) ?? "");
  useEffect(() => {
    const id = setTimeout(() => localStorage.setItem(key, text), 300);
    return () => clearTimeout(id);
  }, [text, key]);
  return (
    <div className="fixed bottom-24 right-4 z-40 w-72 rounded-lg border border-table-border bg-table-panel shadow-panel">
      <div className="flex items-center gap-2 border-b border-table-border px-3 py-1.5 text-sm">
        <span className="font-semibold text-table-accentSoft">📝 Notes</span>
        <span className="text-[10px] text-table-muted">private · saved on this device</span>
        <button className="ml-auto text-table-muted hover:text-red-300" onClick={onClose}>✕</button>
      </div>
      <textarea
        className="input h-48 w-full resize-none rounded-t-none border-0 text-sm"
        placeholder="Life totals, triggers to remember, turn order, house rules…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}

// ---- Dice Graphic Polyhedral Shapes ----
function DiceGraphic({ sides, result }: { sides: number; result: number }) {
  if (sides === 4) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <polygon points="32,6 5,55 59,55" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="32" y1="36" x2="32" y2="6" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="36" x2="5" y2="55" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="36" x2="59" y2="55" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <text x="32" y="47" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  if (sides === 6) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <rect x="8" y="8" width="48" height="48" rx="6" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <text x="32" y="39" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  if (sides === 8) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <polygon points="32,4 60,32 32,60 4,32" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="4" y1="32" x2="60" y2="32" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
        <line x1="32" y1="4" x2="32" y2="60" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <text x="32" y="38" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  if (sides === 10) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <polygon points="32,4 58,26 48,56 32,60 16,56 6,26" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="32" y1="34" x2="32" y2="4" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="34" x2="58" y2="26" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="34" x2="48" y2="56" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="34" x2="16" y2="56" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="34" x2="6" y2="26" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <text x="32" y="44" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  if (sides === 12) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <polygon points="32,4 58,23 48,56 16,56 6,23" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon points="32,20 44,28 39,44 25,44 20,28" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.7" />
        <line x1="32" y1="4" x2="32" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="58" y1="23" x2="44" y2="28" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="48" y1="56" x2="39" y2="44" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="16" y1="56" x2="25" y2="44" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="6" y1="23" x2="20" y2="28" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <text x="32" y="38" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  if (sides === 20) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <polygon points="32,4 58,19 58,49 32,60 6,49 6,19" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon points="32,20 48,42 16,42" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
        <line x1="32" y1="4" x2="32" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="6" y1="19" x2="16" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="58" y1="19" x2="48" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="6" y1="49" x2="16" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="58" y1="49" x2="48" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="32" y1="60" x2="16" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="32" y1="60" x2="48" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <text x="32" y="38" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  return null;
}

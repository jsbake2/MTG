import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, GameAction, LobbySeat, ServerMessage, TableState } from "@mtg/shared";

export interface LobbyInfo {
  seats: LobbySeat[];
  maxPlayers: number;
  formatId: string;
  mode: import("@mtg/shared").TableMode;
  name: string;
  hostUserId: string;
  you: number | null;
}

export interface TableConn {
  state: TableState | null;
  lobby: LobbyInfo | null;
  you: number | null;
  hands: Record<number, string[]>;
  connected: boolean;
  error: string | null;
  send: (action: GameAction) => void;
  raw: (msg: ClientMessage) => void;
  takeSeat: (seat: number, deckId: string | null) => void;
  leaveSeat: () => void;
  start: () => void;
  undo: () => void;
  chat: (text: string) => void;
}

export function useTable(tableId: string): TableConn {
  const [state, setState] = useState<TableState | null>(null);
  const [lobby, setLobby] = useState<LobbyInfo | null>(null);
  const [you, setYou] = useState<number | null>(null);
  const [hands, setHands] = useState<Record<number, string[]>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);

  const raw = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    closedRef.current = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: "hello", tableId } satisfies ClientMessage));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.type === "state") {
          setState(msg.state);
          setLobby(null);
          setYou(msg.you);
          setHands(msg.hands);
        } else if (msg.type === "lobby") {
          setLobby({
            seats: msg.seats,
            maxPlayers: msg.maxPlayers,
            formatId: msg.formatId,
            mode: msg.mode,
            name: msg.name,
            hostUserId: msg.hostUserId,
            you: msg.you,
          });
          setYou(msg.you);
        } else if (msg.type === "error") {
          setError(msg.message);
          setTimeout(() => setError(null), 4000);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closedRef.current) retry = setTimeout(connect, 1200);
      };
      ws.onerror = () => ws.close();
    }
    connect();

    return () => {
      closedRef.current = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [tableId]);

  const send = useCallback((action: GameAction) => raw({ type: "action", action }), [raw]);

  return {
    state,
    lobby,
    you,
    hands,
    connected,
    error,
    send,
    raw,
    takeSeat: (seat, deckId) => raw({ type: "take_seat", seat, deckId }),
    leaveSeat: () => raw({ type: "leave_seat" }),
    start: () => raw({ type: "start_game" }),
    undo: () => raw({ type: "undo" }),
    chat: (text) => raw({ type: "chat", text }),
  };
}

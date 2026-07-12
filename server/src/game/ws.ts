// Real-time table server. One WebSocket per connected client. The server holds
// authoritative table state; clients send intents (ClientMessage) and receive
// redacted state snapshots + chat/log. Reconnect-safe: state is re-sent on hello.
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@mtg/shared";
import { readToken, userForToken } from "../auth/sessions.js";
import { log } from "./state.js";
import { Table, tables } from "./table.js";

interface Conn {
  ws: WebSocket;
  userId: string;
  name: string;
  isAdmin: boolean;
  avatarCardId: string | null;
  tableId: string | null;
  table: Table | null;
  unsub: (() => void) | null;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function pushState(conn: Conn): void {
  if (!conn.table) return;
  const seat = conn.table.seatForUser(conn.userId);
  if (conn.table.state) {
    const { state, hands } = conn.table.viewFor(seat);
    send(conn.ws, { type: "state", state, you: seat, hands });
  } else {
    // Lobby snapshot (game not started yet).
    send(conn.ws, {
      type: "lobby",
      seats: conn.table.seats.map((s) => ({ seat: s.seat, name: s.name, userId: s.userId, deckId: s.deckId, avatarCardId: s.avatarCardId })),
      maxPlayers: conn.table.maxPlayers,
      formatId: conn.table.formatId,
      ruleset: conn.table.ruleset,
      enforceBans: conn.table.enforceBans,
      mode: conn.table.mode,
      name: conn.table.name,
      hostUserId: conn.table.hostUserId,
      you: seat,
    });
  }
}

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (ws, req) => {
    const token = readToken(req as any);
    const user = token ? await userForToken(token) : null;
    if (!user) {
      send(ws, { type: "error", message: "Not authenticated", recoverable: false });
      ws.close();
      return;
    }
    const conn: Conn = {
      ws,
      userId: user.id,
      name: user.displayName,
      isAdmin: user.isAdmin,
      avatarCardId: user.avatarCardId,
      tableId: null,
      table: null,
      unsub: null,
    };

    ws.on("message", async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        await handle(conn, msg);
      } catch (e) {
        send(ws, { type: "error", message: e instanceof Error ? e.message : "Server error", recoverable: true });
      }
    });

    ws.on("close", () => {
      if (conn.unsub) conn.unsub();
      // Mark player disconnected (kept in seat so they can reconnect).
      if (conn.table?.state) {
        const seat = conn.table.seatForUser(conn.userId);
        const p = conn.table.state.players.find((pp) => pp.seat === seat);
        if (p) {
          p.connected = false;
          conn.table.notify();
        }
      }
    });
  });

  console.log("[ws] websocket server attached at /ws");
}

async function handle(conn: Conn, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case "hello": {
      const table = tables.get(msg.tableId);
      if (!table) {
        send(conn.ws, { type: "error", message: "Table not found", recoverable: false });
        return;
      }
      if (conn.unsub) conn.unsub();
      conn.tableId = table.id;
      conn.table = table;
      const listener = () => pushState(conn);
      table.listeners.add(listener);
      conn.unsub = () => table.listeners.delete(listener);
      // Mark reconnected.
      if (table.state) {
        const seat = table.seatForUser(conn.userId);
        const p = table.state.players.find((pp) => pp.seat === seat);
        if (p) p.connected = true;
      }
      pushState(conn);
      return;
    }
    case "take_seat": {
      if (!conn.table) return;
      const r = conn.table.takeSeat(conn.userId, conn.name, msg.seat, msg.deckId, conn.avatarCardId);
      if (!r.ok) send(conn.ws, { type: "error", message: r.error ?? "Cannot take seat", recoverable: true });
      return;
    }
    case "leave_seat": {
      conn.table?.leaveSeat(conn.userId);
      return;
    }
    case "start_game": {
      if (!conn.table) return;
      if (conn.table.hostUserId !== conn.userId && !conn.isAdmin) {
        send(conn.ws, { type: "error", message: "Only the host can start the game.", recoverable: true });
        return;
      }
      const r = await conn.table.start();
      if (!r.ok) send(conn.ws, { type: "error", message: r.error ?? "Cannot start", recoverable: true });
      return;
    }
    case "action": {
      if (!conn.table || !conn.table.state) return;
      const seat = conn.table.seatForUser(conn.userId);
      if (seat === null) {
        send(conn.ws, { type: "error", message: "You're spectating — take a seat to act.", recoverable: true });
        return;
      }
      const r = conn.table.apply(seat, msg.action);
      if (!r.ok) send(conn.ws, { type: "error", message: r.error ?? "Illegal action", recoverable: true });
      return;
    }
    case "undo": {
      if (!conn.table) return;
      const seat = conn.table.seatForUser(conn.userId);
      if (seat === null) return;
      conn.table.requestUndo(seat);
      return;
    }
    case "undo_response": {
      if (!conn.table) return;
      const seat = conn.table.seatForUser(conn.userId);
      if (seat === null) return;
      conn.table.respondUndo(seat, msg.approve);
      return;
    }
    case "chat": {
      if (!conn.table?.state) return;
      const seat = conn.table.seatForUser(conn.userId);
      const text = String(msg.text).slice(0, 500);
      // Chat rides in the shared log; notify() re-pushes state (incl. log) to all.
      log(conn.table.state, { seat: seat ?? null, kind: "chat", text: `${conn.name}: ${text}` });
      conn.table.notify();
      return;
    }
    case "ping": {
      send(conn.ws, { type: "pong" });
      return;
    }
  }
}

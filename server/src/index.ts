import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { FORMATS } from "@mtg/shared";
import { env } from "./env.js";
import { runMigrations } from "./db/migrate.js";
import { requireAuth, sessionMiddleware } from "./auth/sessions.js";
import { ensureAdmin } from "./auth/users.js";
import { authRouter } from "./auth/routes.js";
import { cardsRouter } from "./cards/routes.js";
import { decksRouter } from "./decks/routes.js";
import { tablesRouter } from "./game/routes.js";
import { adminRouter } from "./admin/routes.js";
import { getLeaderboard } from "./game/results.js";
import { attachWebSocket } from "./game/ws.js";
import { seedStarterDecks } from "./seed/starterDecks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function pickClientDist(): string {
  if (env.clientDist) return env.clientDist;
  const candidates = [
    resolve(__dirname, "..", "..", "client", "dist"),
    resolve(process.cwd(), "client", "dist"),
    resolve(process.cwd(), "..", "client", "dist"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

async function main() {
  await runMigrations();
  await ensureAdmin();
  await seedStarterDecks();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use(sessionMiddleware);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/formats", (_req, res) => res.json({ formats: FORMATS }));
  app.use("/api/auth", authRouter);
  app.use("/api/cards", cardsRouter);
  app.use("/api/decks", decksRouter);
  app.use("/api/tables", tablesRouter);
  app.use("/api/admin", adminRouter);
  app.get("/api/leaderboard", requireAuth, async (_req, res) => {
    res.json({ leaderboard: await getLeaderboard() });
  });

  // Serve the built client (SPA) with history fallback.
  const clientDist = pickClientDist();
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(resolve(clientDist, "index.html"));
    });
    console.log("[server] serving client from", clientDist);
  } else {
    console.warn("[server] client build not found at", clientDist, "(run `npm run build:client`)");
  }

  const server = createServer(app);
  attachWebSocket(server);

  server.listen(env.port, env.host, () => {
    console.log(`[server] MTG-PvP listening on http://${env.host}:${env.port}`);
  });
}

main().catch((e) => {
  console.error("[server] fatal:", e);
  process.exit(1);
});

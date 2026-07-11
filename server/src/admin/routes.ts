// Admin actions: refresh the card catalog from Scryfall when Wizards releases
// new cards. Runs in the background; status is pollable.
import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/sessions.js";
import { importCards } from "../import/scryfall.js";
import { getImportMeta } from "../cards/repo.js";

export const adminRouter = Router();

interface RefreshState {
  running: boolean;
  startedAt: number | null;
  lastCount: number;
  lastError: string | null;
  lastFinishedAt: number | null;
}
const refresh: RefreshState = {
  running: false,
  startedAt: null,
  lastCount: 0,
  lastError: null,
  lastFinishedAt: null,
};

adminRouter.use(requireAuth, requireAdmin);

adminRouter.post("/refresh-cards", (req, res) => {
  if (refresh.running) {
    res.json({ started: false, message: "A refresh is already running." });
    return;
  }
  const type = typeof req.body?.type === "string" ? req.body.type : "default_cards";
  refresh.running = true;
  refresh.startedAt = Date.now();
  refresh.lastError = null;
  console.log("[admin] card catalog refresh started");
  importCards({ type })
    .then((r) => {
      refresh.lastCount = r.count;
      refresh.lastFinishedAt = Date.now();
      console.log(`[admin] refresh done: ${r.count} cards`);
    })
    .catch((e) => {
      refresh.lastError = e instanceof Error ? e.message : String(e);
      console.error("[admin] refresh failed:", e);
    })
    .finally(() => {
      refresh.running = false;
    });
  res.json({ started: true });
});

adminRouter.get("/refresh-status", async (_req, res) => {
  res.json({ refresh, catalog: await getImportMeta() });
});

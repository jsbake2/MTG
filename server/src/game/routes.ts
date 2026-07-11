import { Router } from "express";
import { z } from "zod";
import { FORMATS } from "@mtg/shared";
import { requireAuth } from "../auth/sessions.js";
import { tables } from "./table.js";

export const tablesRouter = Router();

tablesRouter.use(requireAuth);

tablesRouter.get("/", (_req, res) => {
  res.json({ tables: tables.list() });
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  formatId: z.string().min(1).max(40),
  maxPlayers: z.number().int().min(1).max(4),
  enforcement: z.enum(["relaxed", "strict"]),
});

tablesRouter.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const format = FORMATS.find((f) => f.id === parsed.data.formatId);
  if (!format) {
    res.status(400).json({ error: "Unknown format" });
    return;
  }
  const table = tables.create({ ...parsed.data, hostUserId: req.user!.id });
  res.json({ table: table.summary() });
});

tablesRouter.get("/:id", (req, res) => {
  const t = tables.get(String(req.params.id));
  if (!t) {
    res.status(404).json({ error: "Table not found" });
    return;
  }
  res.json({ table: t.summary() });
});

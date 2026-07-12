// Card issue reports. Players flag cards during play; the owner reviews the
// queue over time and it feeds guided-rules authoring.
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/sessions.js";
import { query } from "../db/pool.js";

export const issuesRouter = Router();
issuesRouter.use(requireAuth);

const reportSchema = z.object({
  cardId: z.string().uuid().nullable().optional(),
  oracleId: z.string().uuid().nullable().optional(),
  cardName: z.string().min(1).max(200),
  tableId: z.string().max(64).nullable().optional(),
  description: z.string().min(1).max(4000),
});

// Report a new issue.
issuesRouter.post("/", async (req, res) => {
  const p = reportSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid issue report" });
  const { cardId = null, oracleId = null, cardName, tableId = null, description } = p.data;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO card_issues (card_id, oracle_id, card_name, table_id, description, reporter_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [cardId, oracleId, cardName, tableId, description, req.user!.id],
  );
  res.json({ ok: true, id: rows[0]?.id });
});

// List issues (with a card image when we can resolve one), newest first.
issuesRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const { rows } = await query(
    `SELECT i.*, u.display_name AS reporter_name,
            coalesce(c1.image_normal, c1.image_art_crop, c2.image_normal, c2.image_art_crop) AS image
     FROM card_issues i
     LEFT JOIN users u ON u.id = i.reporter_id
     LEFT JOIN LATERAL (SELECT image_normal, image_art_crop FROM cards WHERE id = i.card_id LIMIT 1) c1 ON true
     LEFT JOIN LATERAL (
       SELECT image_normal, image_art_crop FROM cards
       WHERE lower(name) = lower(i.card_name) AND coalesce(image_normal, image_art_crop) IS NOT NULL
       ORDER BY released_at DESC NULLS LAST LIMIT 1
     ) c2 ON true
     ${status ? "WHERE i.status = $1" : ""}
     ORDER BY i.created_at DESC`,
    status ? [status] : [],
  );
  res.json({ issues: rows });
});

const updateSchema = z.object({
  status: z.enum(["open", "reviewing", "resolved", "wontfix"]).optional(),
  resolution: z.string().max(4000).nullable().optional(),
});

// Update an issue's status / resolution (admin review).
issuesRouter.post("/:id", async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "Admins only" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const p = updateSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid update" });
  await query(
    `UPDATE card_issues SET
       status = coalesce($2, status),
       resolution = coalesce($3, resolution),
       updated_at = now()
     WHERE id = $1`,
    [id, p.data.status ?? null, p.data.resolution ?? null],
  );
  res.json({ ok: true });
});

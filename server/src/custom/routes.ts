import { Router } from "express";
import { requireAuth, requireAdmin } from "../auth/sessions.js";
import { query } from "../db/pool.js";
import { ART_STYLES } from "@mtg/shared";
import {
  cardNameTaken, copyCard, createCard, createSet, deleteCard, getCard,
  listCards, listSets, setArtPath, setNameOrCodeTaken, updateCard, type CardInput,
} from "./repo.js";
import { buildForgeBundle } from "./sync.js";
import { buildArtPrompt, cooldownRemaining, generateArt, getGeminiKey, markGenerated, setGeminiKey } from "./art.js";
import { renderCard, type ArtTransform } from "./frame.js";
import { mirrorCard, unmirrorCard } from "./pool.js";
import {
  addReprint, customSetStats, listRealSets, listReprints, realSetCards, realSetStats,
  removeReprint, updateReprint,
} from "./setbuilder.js";

function readTx(body: unknown): ArtTransform {
  const b = (body ?? {}) as Record<string, unknown>;
  const t = (b.tx ?? {}) as Record<string, unknown>;
  return {
    scale: Math.max(1, Math.min(6, Number(t.scale) || 1)),
    dx: Math.max(-1, Math.min(1, Number(t.dx) || 0)),
    dy: Math.max(-1, Math.min(1, Number(t.dy) || 0)),
  };
}

export const customRouter = Router();
customRouter.use(requireAuth);

const NAME_OK = /^[\w '’,.:!?&()-]{1,60}$/; // no path/script specials

// Derive a Forge edition code from a set name (initials, then uniquify).
async function deriveCode(name: string): Promise<string> {
  const words = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  let base = (words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "SET")).toUpperCase().slice(0, 6) || "SET";
  let code = base;
  for (let i = 2; (await query<{ id: string }>(`SELECT id FROM custom_sets WHERE code = $1`, [code])).rows.length; i++) code = `${base}${i}`.slice(0, 8);
  return code;
}

// ---- sets --------------------------------------------------------------
customRouter.get("/sets", async (_req, res) => res.json({ sets: await listSets() }));

customRouter.post("/sets", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!NAME_OK.test(name)) return res.status(400).json({ error: "Set name has invalid characters." });
  const code = await deriveCode(name);
  if (await setNameOrCodeTaken(name, code)) return res.status(409).json({ error: "A set with that name already exists." });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date)) ? String(req.body.date) : new Date().toISOString().slice(0, 10);
  res.json({ set: await createSet(name, code, date, req.user!.id) });
});

customRouter.get("/sets/:id/cards", async (req, res) => res.json({ cards: await listCards(String(req.params.id)) }));

// ---- set builder: reprints (real cards as filler) + stats ---------------
customRouter.get("/sets/:id/contents", async (req, res) => {
  const id = String(req.params.id);
  res.json({ native: await listCards(id), reprints: await listReprints(id) });
});
customRouter.get("/sets/:id/stats", async (req, res) => res.json({ stats: await customSetStats(String(req.params.id)) }));

customRouter.post("/sets/:id/reprints", async (req, res) => {
  const cardId = String(req.body?.cardId ?? "");
  if (!cardId) return res.status(400).json({ error: "cardId required" });
  try { await addReprint(String(req.params.id), cardId, req.body?.rarity ? String(req.body.rarity) : undefined); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: (e as Error).message }); }
});
customRouter.delete("/sets/:id/reprints/:cardId", async (req, res) => {
  await removeReprint(String(req.params.id), String(req.params.cardId));
  res.json({ ok: true });
});
customRouter.patch("/sets/:id/reprints/:cardId", async (req, res) => {
  await updateReprint(String(req.params.id), String(req.params.cardId), {
    rarity: req.body?.rarity ? String(req.body.rarity) : undefined,
    collectorNumber: req.body?.collectorNumber != null ? Number(req.body.collectorNumber) : undefined,
  });
  res.json({ ok: true });
});

// ---- read-only study of real official sets ------------------------------
customRouter.get("/real-sets", async (_req, res) => res.json({ sets: await listRealSets() }));
customRouter.get("/real-sets/:code/stats", async (req, res) => res.json({ stats: await realSetStats(String(req.params.code)) }));
customRouter.get("/real-sets/:code/cards", async (req, res) => res.json({ cards: await realSetCards(String(req.params.code)) }));

// ---- cards -------------------------------------------------------------
function readCardInput(body: unknown): CardInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    setId: String(b.setId ?? ""),
    name: String(b.name ?? "").trim(),
    manaCost: (b.manaCost as string) || null,
    types: String(b.types ?? "Creature").trim(),
    power: (b.power as string) ?? null,
    toughness: (b.toughness as string) ?? null,
    loyalty: (b.loyalty as string) ?? null,
    keywords: Array.isArray(b.keywords) ? (b.keywords as string[]) : [],
    oracle: String(b.oracle ?? ""),
    flavor: (b.flavor as string) ?? null,
    rarity: String(b.rarity ?? "C"),
    artist: (b.artist as string) ?? null,
    artPath: null,
    advanced: !!b.advanced,
    forgeScript: (b.forgeScript as string) ?? "",
    collectorNumber: (b.collectorNumber as number | null) ?? undefined,
    frameTheme: (b.frameTheme as string) || "classic",
    isToken: !!b.isToken,
  };
}

customRouter.post("/cards", async (req, res) => {
  const input = readCardInput(req.body);
  if (!NAME_OK.test(input.name)) return res.status(400).json({ error: "Card name has invalid characters." });
  if (!input.setId) return res.status(400).json({ error: "Pick a set." });
  if (input.advanced && !req.user!.isAdmin) return res.status(403).json({ error: "Advanced (raw script) editing is host-only." });
  if (await cardNameTaken(input.setId, input.name)) return res.status(409).json({ error: "A card with that name already exists in this set." });
  const card = await createCard(input, req.user!.id);
  if (!card.isToken) await mirrorCard(card); // tokens aren't deck cards
  res.json({ card });
});

customRouter.put("/cards/:id", async (req, res) => {
  const input = readCardInput(req.body);
  const existing = await getCard(String(req.params.id));
  if (!existing) return res.status(404).json({ error: "Card not found" });
  if (input.advanced && !req.user!.isAdmin) return res.status(403).json({ error: "Advanced (raw script) editing is host-only." });
  if (input.name !== existing.name && (await cardNameTaken(existing.setId, input.name))) return res.status(409).json({ error: "That name is taken in this set." });
  const card = await updateCard(String(req.params.id), { ...input, setId: existing.setId });
  if (card && !card.isToken) await mirrorCard(card);
  res.json({ card });
});

customRouter.post("/cards/:id/copy", async (req, res) => {
  const c = await copyCard(String(req.params.id), req.user!.id);
  if (!c) return res.status(404).json({ error: "Card not found" });
  await mirrorCard(c);
  res.json({ card: c });
});

customRouter.delete("/cards/:id", async (req, res) => {
  await unmirrorCard(String(req.params.id));
  await deleteCard(String(req.params.id));
  res.json({ ok: true });
});

// ---- art ---------------------------------------------------------------
customRouter.get("/art-styles", (_req, res) => res.json({ styles: ART_STYLES }));

customRouter.post("/cards/:id/art", async (req, res) => {
  const card = await getCard(String(req.params.id));
  if (!card) return res.status(404).json({ error: "Card not found" });
  const remaining = cooldownRemaining(req.user!.id);
  if (remaining > 0) return res.status(429).json({ error: `Please wait ${Math.ceil(remaining / 1000)}s before generating again.`, cooldownMs: remaining });
  let prompt = buildArtPrompt({ styleId: String(req.body?.styleId ?? ""), color: String(req.body?.color ?? ""), details: String(req.body?.details ?? ""), cardName: card.name, types: card.types });
  const rawRef = String(req.body?.refImageBase64 ?? "").replace(/^data:[^,]+,/, "");
  const ref = rawRef ? { mime: String(req.body?.refMime ?? "image/png"), dataBase64: rawRef } : undefined;
  if (ref) prompt = `Using the attached reference image as strong visual context and inspiration, create: ${prompt}`;
  try {
    const { mime, data } = await generateArt(prompt, ref);
    markGenerated(req.user!.id); // only a successful generation starts the cooldown
    await query(
      `INSERT INTO custom_art (card_id, mime, data, prompt) VALUES ($1,$2,$3,$4)
       ON CONFLICT (card_id) DO UPDATE SET mime=EXCLUDED.mime, data=EXCLUDED.data, prompt=EXCLUDED.prompt, updated_at=now()`,
      [card.id, mime, data, prompt],
    );
    await setArtPath(card.id, "db");
    res.json({ ok: true, prompt });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message, prompt });
  }
});

// Generate art WITHOUT a saved card — returns the image to the client, which
// holds it until the card is saved. Lets users build art before/while filling in
// the card (no "save first" gate).
customRouter.post("/art/generate", async (req, res) => {
  const remaining = cooldownRemaining(req.user!.id);
  if (remaining > 0) return res.status(429).json({ error: `Please wait ${Math.ceil(remaining / 1000)}s before generating again.`, cooldownMs: remaining });
  let prompt = buildArtPrompt({ styleId: String(req.body?.styleId ?? ""), color: String(req.body?.color ?? ""), details: String(req.body?.details ?? ""), cardName: String(req.body?.cardName ?? ""), types: String(req.body?.types ?? "") });
  const rawRef = String(req.body?.refImageBase64 ?? "").replace(/^data:[^,]+,/, "");
  const ref = rawRef ? { mime: String(req.body?.refMime ?? "image/png"), dataBase64: rawRef } : undefined;
  if (ref) prompt = `Using the attached reference image as strong visual context and inspiration, create: ${prompt}`;
  try {
    const { mime, data } = await generateArt(prompt, ref);
    markGenerated(req.user!.id);
    res.json({ ok: true, prompt, mime, dataBase64: data.toString("base64") });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message, prompt });
  }
});

// Upload your own image as the card art, with an optional positioning transform.
customRouter.post("/cards/:id/art/upload", async (req, res) => {
  const card = await getCard(String(req.params.id));
  if (!card) return res.status(404).json({ error: "Card not found" });
  const b64 = String(req.body?.dataBase64 ?? "").replace(/^data:[^,]+,/, "");
  if (!b64) return res.status(400).json({ error: "No image data." });
  const data = Buffer.from(b64, "base64");
  if (data.length > 8_000_000) return res.status(400).json({ error: "Image too large (max ~8MB)." });
  const mime = String(req.body?.mime ?? "image/jpeg");
  const prompt = String(req.body?.prompt ?? "(uploaded)").slice(0, 500);
  const tx = readTx(req.body);
  await query(
    `INSERT INTO custom_art (card_id, mime, data, prompt, tx_scale, tx_dx, tx_dy) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (card_id) DO UPDATE SET mime=EXCLUDED.mime, data=EXCLUDED.data, prompt=EXCLUDED.prompt,
       tx_scale=EXCLUDED.tx_scale, tx_dx=EXCLUDED.tx_dx, tx_dy=EXCLUDED.tx_dy, updated_at=now()`,
    [card.id, mime, data, prompt, tx.scale, tx.dx, tx.dy],
  );
  await setArtPath(card.id, "db");
  res.json({ ok: true });
});

// Adjust just the positioning (pan/zoom) of the existing art — cheap, no re-upload.
customRouter.post("/cards/:id/art/transform", async (req, res) => {
  const tx = readTx(req.body);
  const r = await query(`UPDATE custom_art SET tx_scale=$2, tx_dx=$3, tx_dy=$4, updated_at=now() WHERE card_id=$1`, [String(req.params.id), tx.scale, tx.dx, tx.dy]);
  if (!r.rowCount) return res.status(404).json({ error: "No art to adjust." });
  res.json({ ok: true });
});

customRouter.get("/cards/:id/art", async (req, res) => {
  const row = (await query<{ mime: string; data: Buffer }>(`SELECT mime, data FROM custom_art WHERE card_id = $1`, [String(req.params.id)])).rows[0];
  if (!row) return res.status(404).end();
  res.setHeader("Content-Type", row.mime);
  res.setHeader("Cache-Control", "no-cache");
  res.send(Buffer.from(row.data));
});

// The original art + its transform, for re-editing/adjusting in the tool.
customRouter.get("/cards/:id/art.json", async (req, res) => {
  const row = (await query<{ mime: string; data: Buffer; tx_scale: number; tx_dx: number; tx_dy: number }>(
    `SELECT mime, data, tx_scale, tx_dx, tx_dy FROM custom_art WHERE card_id = $1`, [String(req.params.id)],
  )).rows[0];
  if (!row) return res.json({ hasArt: false });
  res.json({ hasArt: true, mime: row.mime, dataBase64: Buffer.from(row.data).toString("base64"), tx: { scale: row.tx_scale, dx: row.tx_dx, dy: row.tx_dy } });
});

// The composited full card face (frame + name + mana + rules + P/T) — the exact
// image Forge shows as `<Card Name>.full.jpg`. Art (if any) fills the art box.
customRouter.get("/cards/:id/render", async (req, res) => {
  const card = await getCard(String(req.params.id));
  if (!card) return res.status(404).end();
  // Optional ?theme= override lets the editor preview a theme before saving.
  const themeOverride = req.query.theme ? String(req.query.theme) : null;
  const row = (await query<{ data: Buffer; tx_scale: number; tx_dx: number; tx_dy: number }>(`SELECT data, tx_scale, tx_dx, tx_dy FROM custom_art WHERE card_id = $1`, [card.id])).rows[0];
  const tx = row ? { scale: row.tx_scale, dx: row.tx_dx, dy: row.tx_dy } : undefined;
  const jpeg = await renderCard(themeOverride ? { ...card, frameTheme: themeOverride } : card, row ? Buffer.from(row.data) : null, tx);
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-cache");
  res.send(jpeg);
});

// ---- sync bundle (pulled by tools/forge-sync.sh on each machine) --------
customRouter.get("/bundle", async (_req, res) => res.json(await buildForgeBundle()));

// ---- admin: Gemini key -------------------------------------------------
customRouter.get("/settings", requireAdmin, async (_req, res) => res.json({ hasGeminiKey: !!(await getGeminiKey()) }));
customRouter.post("/settings/gemini-key", requireAdmin, async (req, res) => {
  const key = String(req.body?.key ?? "").trim();
  if (!key) return res.status(400).json({ error: "Empty key" });
  await setGeminiKey(key);
  res.json({ ok: true });
});

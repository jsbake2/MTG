import { Router } from "express";
import type { CardDetailResponse, SearchRequest } from "@mtg/shared";
import { getCardById, getImportMeta, getPrintings, searchCards, searchTokens } from "./repo.js";
import { getCardArt, getCardImage } from "./images.js";

export const cardsRouter = Router();

cardsRouter.get("/tokens", async (req, res) => {
  res.json({ tokens: await searchTokens(String(req.query.q ?? "")) });
});

cardsRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "");
  const request: SearchRequest = {
    q,
    page: req.query.page ? Number(req.query.page) : 1,
    pageSize: req.query.pageSize ? Number(req.query.pageSize) : 60,
    sort: (req.query.sort as SearchRequest["sort"]) ?? "name",
    dir: (req.query.dir as SearchRequest["dir"]) ?? "asc",
    group: req.query.group === "1" || req.query.group === "true",
  };
  const result = await searchCards(request);
  res.json(result);
});

cardsRouter.get("/import-status", async (_req, res) => {
  res.json(await getImportMeta());
});

cardsRouter.get("/:id/image", async (req, res) => {
  const face = req.query.face ? Number(req.query.face) : 0;
  const img = await getCardImage(String(req.params.id), Number.isFinite(face) ? face : 0);
  if (!img) {
    res.status(404).json({ error: "Image not available" });
    return;
  }
  res.setHeader("Content-Type", img.contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(img.data);
});

cardsRouter.get("/:id/art", async (req, res) => {
  const img = await getCardArt(String(req.params.id));
  if (!img) {
    res.status(404).json({ error: "Art not available" });
    return;
  }
  res.setHeader("Content-Type", img.contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(img.data);
});

cardsRouter.get("/:id", async (req, res) => {
  const card = await getCardById(String(req.params.id));
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  const printings = await getPrintings(card.oracleId);
  const response: CardDetailResponse = { card, printings };
  res.json(response);
});

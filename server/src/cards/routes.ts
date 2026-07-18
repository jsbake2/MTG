import { Router } from "express";
import type { CardDetailResponse, SearchRequest } from "@mtg/shared";
import { getCardById, getCardRules, getImportMeta, getPrintings, listSets, searchCards, searchTokens, tokenArts } from "./repo.js";
import { getCardArt, getCardImage, getCardBack } from "./images.js";
import { getDecksContainingCard } from "../decks/repo.js";
import { renderCustomCardImage } from "../custom/pool.js";

export const cardsRouter = Router();

cardsRouter.get("/tokens", async (req, res) => {
  res.json({ tokens: await searchTokens(String(req.query.q ?? "")) });
});

// Alternate art printings of a token (by oracle_id) so the player can choose one.
cardsRouter.get("/tokens/arts", async (req, res) => {
  const oracleId = String(req.query.oracleId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(oracleId)) return res.status(400).json({ error: "valid oracleId required" });
  res.json({ arts: await tokenArts(oracleId) });
});

cardsRouter.get("/sets", async (_req, res) => {
  res.json({ sets: await listSets() });
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
    nameOnly: req.query.nameOnly === "1" || req.query.nameOnly === "true",
  };
  const result = await searchCards(request);
  res.json(result);
});

cardsRouter.get("/import-status", async (_req, res) => {
  res.json(await getImportMeta());
});

cardsRouter.get("/card-back", async (_req, res) => {
  const img = await getCardBack();
  if (!img) {
    res.status(404).json({ error: "Card back image not available" });
    return;
  }
  res.setHeader("Content-Type", img.contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(img.data);
});

cardsRouter.get("/:id/image", async (req, res) => {
  const id = String(req.params.id);
  // Custom cards: serve the composited full-card render (frame + text + art).
  const customFace = await renderCustomCardImage(id);
  if (customFace) {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-cache");
    res.send(customFace);
    return;
  }
  const card = await getCardById(id);
  if (card && card.setCode === "wot") {
    let artDataUri = "";
    const img = await getCardArt(card.id);
    if (img) {
      const base64 = img.data.toString("base64");
      artDataUri = `data:${img.contentType};base64,${base64}`;
    }
    const svg = generateCardSvg(card, artDataUri);
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.send(Buffer.from(svg));
    return;
  }

  const face = req.query.face ? Number(req.query.face) : 0;
  const img = await getCardImage(id, Number.isFinite(face) ? face : 0);
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
  const decks = await getDecksContainingCard(card.oracleId, req.user ? req.user.id : null);
  const rules = await getCardRules(card.oracleId);
  const response: CardDetailResponse = { card, printings, decks, rules };
  res.json(response);
});

function generateCardSvg(card: any, artDataUri: string): string {
  // Determine card border/frame gradient colors based on card colors
  let frameColor = "#2c2a29"; // Colorless dark grey
  let borderGrad = ["#a09f9c", "#5f5e5b"]; // Silver/grey border
  
  if (card.colors && card.colors.length === 1) {
    const c = card.colors[0];
    if (c === "W") {
      frameColor = "#f8f6f0"; // Cream White
      borderGrad = ["#dfdcd3", "#b0ad9f"];
    } else if (c === "U") {
      frameColor = "#d1e4f6"; // Blue
      borderGrad = ["#9bbbd6", "#5a88ad"];
    } else if (c === "B") {
      frameColor = "#262529"; // Black
      borderGrad = ["#504e54", "#2c2a2f"];
    } else if (c === "R") {
      frameColor = "#f5d3cf"; // Red
      borderGrad = ["#d69f96", "#ad5a4e"];
    } else if (c === "G") {
      frameColor = "#cce2d1"; // Green
      borderGrad = ["#96c5a0", "#4ebd65"];
    }
  } else if (card.colors && card.colors.length > 1) {
    frameColor = "#ebd99f"; // Gold multicolor
    borderGrad = ["#cfa75e", "#946f34"];
  } else if (card.typeLine && card.typeLine.toLowerCase().includes("land")) {
    frameColor = "#caaf99"; // Land brown
    borderGrad = ["#947a65", "#5c4634"];
  }

  // Draw SVG
  const width = 375;
  const height = 523;

  // Format rules text (fallback basic lands text)
  let rawText = card.oracleText || "";
  if (!rawText && card.typeLine && card.typeLine.toLowerCase().includes("land")) {
    if (card.name.toLowerCase().includes("forest")) rawText = "{T}: Add {G}.";
    else if (card.name.toLowerCase().includes("plains")) rawText = "{T}: Add {W}.";
    else if (card.name.toLowerCase().includes("island") || card.name.toLowerCase().includes("isle")) rawText = "{T}: Add {U}.";
    else if (card.name.toLowerCase().includes("swamp") || card.name.toLowerCase().includes("ruins")) rawText = "{T}: Add {B}.";
    else if (card.name.toLowerCase().includes("mountain") || card.name.toLowerCase().includes("mist")) rawText = "{T}: Add {R}.";
  }

  const formattedText = formatOracleText(rawText);
  const oracleLines = formattedText.split("\n");
  let textY = 352;
  const textLineHeight = 14;
  let textElements = "";

  for (const line of oracleLines) {
    const words = line.split(" ");
    let currentLine = "";
    for (const word of words) {
      if ((currentLine + " " + word).length > 46) {
        textElements += `<text x="32" y="${textY}" font-family="sans-serif" font-size="10.5" fill="#1c1c1c">${escapeXml(currentLine.trim())}</text>\n`;
        textY += textLineHeight;
        currentLine = word;
      } else {
        currentLine += " " + word;
      }
    }
    if (currentLine) {
      textElements += `<text x="32" y="${textY}" font-family="sans-serif" font-size="10.5" fill="#1c1c1c">${escapeXml(currentLine.trim())}</text>\n`;
      textY += textLineHeight;
    }
    textY += 4; // paragraph spacing
  }

  // Add flavor text
  if (card.flavorText) {
    textY += 4;
    const flavorLines = card.flavorText.split("\n");
    for (const fline of flavorLines) {
      const words = fline.split(" ");
      let currentLine = "";
      for (const word of words) {
        if ((currentLine + " " + word).length > 46) {
          textElements += `<text x="32" y="${textY}" font-family="sans-serif" font-size="9.5" font-style="italic" fill="#555">${escapeXml(currentLine.trim())}</text>\n`;
          textY += textLineHeight;
          currentLine = word;
        } else {
          currentLine += " " + word;
        }
      }
      if (currentLine) {
        textElements += `<text x="32" y="${textY}" font-family="sans-serif" font-size="9.5" font-style="italic" fill="#555">${escapeXml(currentLine.trim())}</text>\n`;
        textY += textLineHeight;
      }
    }
  }

  // Check if creature for power/toughness
  const ptBox = (card.power !== null || card.toughness !== null)
    ? `<g transform="translate(305, 483)">
         <rect width="46" height="24" rx="4" fill="#f8f6f0" stroke="#1c1c1c" stroke-width="1.5" />
         <text x="23" y="16" font-family="sans-serif" font-size="12" font-weight="bold" fill="#1c1c1c" text-anchor="middle">${card.power ?? "0"}/${card.toughness ?? "0"}</text>
       </g>`
    : "";

  // Render mana cost circles at the top-right
  const symbols = card.manaCost ? [...card.manaCost.matchAll(/\{([A-Z0-9/]+)\}/g)].map(m => m[1]) : [];
  let symbolsSvg = "";
  let startX = 315;
  for (let i = symbols.length - 1; i >= 0; i--) {
    const sym = symbols[i];
    let bgColor = "#ccc";
    let textColor = "#1c1c1c";
    let border = "none";
    let displayText = sym;

    if (sym === "W") {
      bgColor = "#f8f6f0";
      border = "1.5px solid #b0ad9f";
      displayText = "W";
    } else if (sym === "U") {
      bgColor = "#b3d6f7";
      displayText = "U";
    } else if (sym === "B") {
      bgColor = "#1c1c1c";
      textColor = "#fff";
      displayText = "B";
    } else if (sym === "R") {
      bgColor = "#f7a399";
      displayText = "R";
    } else if (sym === "G") {
      bgColor = "#96c5a0";
      displayText = "G";
    } else if (sym === "C") {
      bgColor = "#ccc";
      displayText = "◇";
    }

    symbolsSvg += `<g transform="translate(${startX}, 4)">
      <circle cx="10" cy="10" r="10" fill="${bgColor}" stroke="${border === "none" ? "#1c1c1c" : "#b0ad9f"}" stroke-width="1" />
      <text x="10" y="14" font-family="sans-serif" font-weight="bold" font-size="11" fill="${textColor}" text-anchor="middle">${displayText}</text>
    </g>\n`;
    startX -= 22;
  }

  const artUrl = artDataUri || "";

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${borderGrad[0]}" />
        <stop offset="100%" stop-color="${borderGrad[1]}" />
      </linearGradient>
    </defs>

    <!-- Card Outer Border -->
    <rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="url(#borderGrad)" />
    
    <!-- Card Frame Inner -->
    <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="12" fill="${frameColor}" stroke="#1c1c1c" stroke-width="2" />

    <!-- Name & Mana Cost Bar -->
    <g transform="translate(22, 22)">
      <rect width="331" height="28" rx="6" fill="#f8f6f0" stroke="#1c1c1c" stroke-width="1.5" opacity="0.9" />
      <text x="12" y="19" font-family="sans-serif" font-weight="bold" font-size="13" fill="#1c1c1c">${escapeXml(card.name)}</text>
      ${symbolsSvg}
    </g>

    <!-- Art Frame -->
    <g transform="translate(22, 56)">
      <rect width="331" height="236" rx="4" fill="#000" stroke="#1c1c1c" stroke-width="1.5" />
      <image xlink:href="${artUrl}" width="331" height="236" preserveAspectRatio="xMidYMid slice" clip-path="inset(0px round 4px)" />
    </g>

    <!-- Type Line Bar -->
    <g transform="translate(22, 298)">
      <rect width="331" height="24" rx="4" fill="#f8f6f0" stroke="#1c1c1c" stroke-width="1.5" opacity="0.9" />
      <text x="12" y="16" font-family="sans-serif" font-weight="bold" font-size="11.5" fill="#1c1c1c">${escapeXml(card.typeLine)}</text>
      <text x="319" y="16" font-family="sans-serif" font-size="10.5" fill="#555" text-anchor="end">${escapeXml(card.setCode.toUpperCase())}</text>
    </g>

    <!-- Rules Text Box -->
    <g transform="translate(22, 328)">
      <rect width="331" height="173" rx="8" fill="#fcfbf7" stroke="#1c1c1c" stroke-width="1.5" opacity="0.95" />
    </g>

    <!-- Rules Text Elements -->
    ${textElements}

    <!-- P/T Box -->
    ${ptBox}
  </svg>`;
}

function formatOracleText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\{T\}/g, "↷")
    .replace(/\{C\}/g, "◇")
    .replace(/\{W\}/g, "☼")
    .replace(/\{U\}/g, "💧")
    .replace(/\{B\}/g, "💀")
    .replace(/\{R\}/g, "🔥")
    .replace(/\{G\}/g, "🌳")
    .replace(/\{(\d+)\}/g, "$1"); // {1} -> 1, {2} -> 2
}

function escapeXml(str: string): string {
  if (!str) return "";
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case "\"": return "&quot;";
      default: return c;
    }
  });
}

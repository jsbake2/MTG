// Deterministic card-frame compositor. Given a custom card's data (+ optional art
// image), it renders a clean, full "Magic-style" card face as a JPEG — the same
// image Forge shows as `<Card Name>.full.jpg`. No AI, no cost: the AI (or an
// uploaded photo) only supplies the *art*; the frame, name, mana, type line, rules
// text and P/T are drawn here so the text is always crisp and correct.
//
// A dozen FRAME_THEMES (shared/custom.ts) each map to a look here, modeled on a
// real Magic set/treatment. Two layout engines cover them all: `standard` (a
// framed card) and `fullart` (art edge-to-edge with translucent text panels).
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image } from "@napi-rs/canvas";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CustomCard } from "@mtg/shared";

// Bundle the fonts with the app so rendering is identical on every machine and in
// the slim Docker image (which ships no system fonts). Registered once at import.
const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(HERE, "../../assets/fonts"); // server/assets/fonts (dist is server/dist)
try {
  GlobalFonts.registerFromPath(join(FONT_DIR, "DejaVuSans.ttf"), "CardSans");
  GlobalFonts.registerFromPath(join(FONT_DIR, "DejaVuSans-Bold.ttf"), "CardSansBold");
} catch {
  // If the bundled fonts are missing we fall back to whatever the platform has;
  // text still renders, just not pixel-identical.
}

const W = 600, H = 836; // ~5:7, standard card proportions

// ---- palette -----------------------------------------------------------
interface Palette { a: string; b: string; ink: string }

interface ThemeStyle {
  layout: "standard" | "fullart";
  tintByMana: boolean;        // frame panel + badge take the card's mana color
  cardBg: string;             // outer margin base
  margin: number;
  radius: number;
  panel?: Palette;            // frame panel when !tintByMana
  bar: string; barInk: string;        // title + type bars
  textBox: string; textInk: string; flavorInk: string;
  accent: string;             // stroke lines / borders
  neonAccent?: boolean;       // derive accent (glow) from mana color
  decor?: "none" | "stars" | "snow";
  // fullart layout only:
  panelRGBA?: string;         // translucent text panel over the art
  panelInk?: string;
}

const CREAM = { textBox: "#f6f1e6", textInk: "#1c1712", flavorInk: "#5b5348" };

const THEMES: Record<string, ThemeStyle> = {
  classic: { layout: "standard", tintByMana: true, cardBg: "#0a0a0a", margin: 22, radius: 16,
    bar: "#f4efe4", barInk: "#17130d", ...CREAM, accent: "#00000055", decor: "none" },
  retro: { layout: "standard", tintByMana: false, cardBg: "#161009", margin: 26, radius: 22,
    panel: { a: "#d8c9a0", b: "#b09a68", ink: "#2a2013" }, bar: "#e3d6b2", barInk: "#241a0c",
    textBox: "#e9ddbe", textInk: "#251b0d", flavorInk: "#6a5a38", accent: "#00000044", decor: "none" },
  zendikar: { layout: "fullart", tintByMana: true, cardBg: "#0a0a0a", margin: 14, radius: 16,
    bar: "#00000000", barInk: "#ffffff", ...CREAM, accent: "#ffffff44", decor: "none",
    panelRGBA: "rgba(12,14,20,0.62)", panelInk: "#f2ede1" },
  borderless: { layout: "fullart", tintByMana: true, cardBg: "#0a0a0a", margin: 8, radius: 14,
    bar: "#00000000", barInk: "#ffffff", ...CREAM, accent: "#ffffff33", decor: "none",
    panelRGBA: "rgba(8,9,12,0.82)", panelInk: "#f4efe6" },
  innistrad: { layout: "standard", tintByMana: false, cardBg: "#0c0a09", margin: 24, radius: 14,
    panel: { a: "#3a3630", b: "#1c1813", ink: "#e8dcc2" }, bar: "#1a1611", barInk: "#c9b48a",
    textBox: "#ddd0b6", textInk: "#241b10", flavorInk: "#6a5a3e", accent: "#000000aa", decor: "none" },
  theros: { layout: "standard", tintByMana: false, cardBg: "#070b14", margin: 24, radius: 14,
    panel: { a: "#1b2a4a", b: "#0c1526", ink: "#f0e2b0" }, bar: "#12203c", barInk: "#e9d27f",
    textBox: "#e9e4d4", textInk: "#1a2338", flavorInk: "#5a5a72", accent: "#b79338", decor: "stars" },
  kaldheim: { layout: "standard", tintByMana: false, cardBg: "#0d1620", margin: 24, radius: 16,
    panel: { a: "#cfe2ee", b: "#8fb3c8", ink: "#123047" }, bar: "#e6f1f8", barInk: "#123047",
    textBox: "#eef5f9", textInk: "#12222f", flavorInk: "#4a6678", accent: "#5b8ba8", decor: "snow" },
  amonkhet: { layout: "standard", tintByMana: false, cardBg: "#171006", margin: 24, radius: 12,
    panel: { a: "#d8c088", b: "#a9863f", ink: "#2a1d08" }, bar: "#e5d3a0", barInk: "#2a1d08",
    textBox: "#efe4c4", textInk: "#271c0a", flavorInk: "#6e5a30", accent: "#7a5a1e", decor: "none" },
  neon: { layout: "standard", tintByMana: false, cardBg: "#050507", margin: 22, radius: 16,
    panel: { a: "#16161c", b: "#0a0a0e", ink: "#e8e8f0" }, bar: "#101018", barInk: "#e8e8f2",
    textBox: "#14141c", textInk: "#e6e6ee", flavorInk: "#9aa0b4", accent: "#000000", neonAccent: true, decor: "none" },
  dominaria: { layout: "standard", tintByMana: false, cardBg: "#120d05", margin: 24, radius: 14,
    panel: { a: "#c9b78a", b: "#9d8556", ink: "#2a2110" }, bar: "#ddcea4", barInk: "#2a2110",
    textBox: "#efe6cd", textInk: "#281f0e", flavorInk: "#6a5836", accent: "#6e5a2c", decor: "none" },
  phyrexian: { layout: "standard", tintByMana: false, cardBg: "#04060a", margin: 24, radius: 14,
    panel: { a: "#20241f", b: "#0a0d0a", ink: "#cfe0c0" }, bar: "#0f130d", barInk: "#9fd08a",
    textBox: "#151810", textInk: "#d3e0c8", flavorInk: "#7fa06a", accent: "#3a5a2a", decor: "none" },
  storybook: { layout: "standard", tintByMana: false, cardBg: "#3a2b3f", margin: 24, radius: 28,
    panel: { a: "#ffd9a8", b: "#f4a9c0", ink: "#5a3a2a" }, bar: "#fff3e0", barInk: "#6a4230",
    textBox: "#fffaf2", textInk: "#4a3226", flavorInk: "#9a7a6a", accent: "#e79ab0", decor: "none" },
};

function theme(id: string | undefined): ThemeStyle { return THEMES[id ?? "classic"] ?? THEMES.classic!; }

// ---- mana / color identity ---------------------------------------------
type Pip = { sym: string; kind: "W" | "U" | "B" | "R" | "G" | "C" | "N" };
const PIP_FILL: Record<Pip["kind"], string> = {
  W: "#f8f4dc", U: "#a9d3f0", B: "#b0a7a0", R: "#f0a68a", G: "#a8d1a4", C: "#cfcabf", N: "#cfcabf",
};
const PIP_INK: Record<Pip["kind"], string> = {
  W: "#2b2a24", U: "#123249", B: "#211d1a", R: "#4a140a", G: "#123a17", C: "#2c2a25", N: "#2c2a25",
};

function parseMana(cost: string | null): Pip[] {
  if (!cost) return [];
  return cost.trim().split(/\s+/).filter(Boolean).map((t) => {
    if (/^\d+$/.test(t)) return { sym: t, kind: "N" as const };
    const c = t.toUpperCase();
    if (c === "W" || c === "U" || c === "B" || c === "R" || c === "G" || c === "C") return { sym: c, kind: c as Pip["kind"] };
    return { sym: c, kind: "C" as const };
  });
}

function colorsOf(pips: Pip[]): Array<"W" | "U" | "B" | "R" | "G"> {
  const set = new Set<"W" | "U" | "B" | "R" | "G">();
  for (const p of pips) if (p.kind === "W" || p.kind === "U" || p.kind === "B" || p.kind === "R" || p.kind === "G") set.add(p.kind);
  return [...set];
}

// The mana-tinted frame palette (used by tintByMana themes), the classic way.
function manaPalette(card: CustomCard): Palette {
  const t = card.types.toLowerCase();
  const cols = colorsOf(parseMana(card.manaCost));
  if (t.includes("land")) return { a: "#c8b48a", b: "#8a7550", ink: "#241d10" };
  if (cols.length === 0) return t.includes("artifact")
    ? { a: "#b9c2cc", b: "#7d8894", ink: "#1a1f24" }
    : { a: "#cfcabf", b: "#9a948a", ink: "#211f1a" };
  if (cols.length >= 2) return { a: "#e9d27f", b: "#b79338", ink: "#2a2007" };
  const map: Record<string, Palette> = {
    W: { a: "#f7f3df", b: "#ccc39c", ink: "#2b2a20" },
    U: { a: "#b9ddf3", b: "#5b9bc9", ink: "#0e2c42" },
    B: { a: "#b7ada6", b: "#5f574f", ink: "#171310" },
    R: { a: "#f3b49c", b: "#c85a3a", ink: "#3d1108" },
    G: { a: "#b7dcae", b: "#5c9a55", ink: "#123115" },
  };
  return map[cols[0]!]!;
}

// A bright accent for neon themes, from the dominant color.
function neonColor(card: CustomCard): string {
  const cols = colorsOf(parseMana(card.manaCost));
  if (cols.length >= 2) return "#ffcf40";
  const map: Record<string, string> = { W: "#f5e6a0", U: "#3fa9ff", B: "#a06cff", R: "#ff5a3c", G: "#4cd964" };
  return map[cols[0] ?? ""] ?? "#7fe3ff";
}

// Deep, saturated mana palette for the full-art showcase nameplate/frame (the
// pastel manaPalette is for the classic frame). `ink` is a legible text color.
function deepMana(card: CustomCard): Palette {
  const t = card.types.toLowerCase();
  const cols = colorsOf(parseMana(card.manaCost));
  if (t.includes("land")) return { a: "#9a7f52", b: "#5f4a2c", ink: "#f5ecd8" };
  if (cols.length === 0) return t.includes("artifact")
    ? { a: "#8b95a0", b: "#414a54", ink: "#eef2f6" }
    : { a: "#9a938a", b: "#4c463f", ink: "#f0ece4" };
  if (cols.length >= 2) return { a: "#c9a233", b: "#7f6212", ink: "#fff5da" };
  const map: Record<string, Palette> = {
    W: { a: "#e7dcae", b: "#b8a86a", ink: "#2a2410" },
    U: { a: "#2f7fc0", b: "#123a66", ink: "#eaf3ff" },
    B: { a: "#4a4038", b: "#181310", ink: "#e8e0d4" },
    R: { a: "#c0341e", b: "#7a1608", ink: "#ffe8e0" },
    G: { a: "#3f8f43", b: "#1c5222", ink: "#eafbe8" },
  };
  return map[cols[0]!]!;
}

// "#rrggbb" + alpha → "rgba(...)"; luminance for auto text contrast.
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
function lum(hex: string): number {
  const h = hex.replace("#", "");
  return (0.2126 * parseInt(h.slice(0, 2), 16) + 0.7152 * parseInt(h.slice(2, 4), 16) + 0.0722 * parseInt(h.slice(4, 6), 16)) / 255;
}

// ---- drawing helpers ---------------------------------------------------
function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPips(ctx: SKRSContext2D, pips: Pip[], rightX: number, cy: number, r: number): number {
  let x = rightX - r;
  for (let i = pips.length - 1; i >= 0; i--) {
    const p = pips[i]!;
    ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fillStyle = "#0000002e"; ctx.fill();
    ctx.beginPath(); ctx.arc(x, cy, r - 1.5, 0, Math.PI * 2); ctx.fillStyle = PIP_FILL[p.kind]; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#00000055"; ctx.stroke();
    ctx.fillStyle = PIP_INK[p.kind];
    ctx.font = `${Math.round(r * 1.15)}px CardSansBold`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(p.sym, x, cy + 0.5);
    x -= r * 2 + 4;
  }
  return x + r;
}

function wrap(ctx: SKRSContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width > maxW && line) { out.push(line); line = word; }
      else line = trial;
    }
    if (line) out.push(line);
  }
  return out;
}

// Deterministic pseudo-random points (seeded by card name length) for decor.
function decorPoints(seed: number, n: number, w: number, h: number): Array<{ x: number; y: number; r: number }> {
  const pts: Array<{ x: number; y: number; r: number }> = [];
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < n; i++) pts.push({ x: rnd() * w, y: rnd() * h, r: 0.6 + rnd() * 1.8 });
  return pts;
}

function drawDecor(ctx: SKRSContext2D, kind: "stars" | "snow", seed: number, x: number, y: number, w: number, h: number): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, 8); ctx.clip();
  const pts = decorPoints(seed, kind === "stars" ? 90 : 70, w, h);
  ctx.fillStyle = kind === "stars" ? "#f3e6a8" : "#ffffff";
  ctx.globalAlpha = kind === "stars" ? 0.55 : 0.7;
  for (const p of pts) { ctx.beginPath(); ctx.arc(x + p.x, y + p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// How the art is positioned inside its box: cover-fit baseline, `scale` zooms in
// (>=1), `dx`/`dy` shift by a fraction of the box. Identity = centered cover-fit.
export interface ArtTransform { scale: number; dx: number; dy: number }
const IDENTITY: ArtTransform = { scale: 1, dx: 0, dy: 0 };

function drawArt(ctx: SKRSContext2D, img: Image | null, x: number, y: number, w: number, h: number, radius: number, tx: ArtTransform = IDENTITY): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, radius); ctx.clip();
  ctx.fillStyle = "#11131a"; ctx.fillRect(x, y, w, h);
  if (img) {
    const s = Math.max(w / img.width, h / img.height) * Math.max(1, tx.scale);
    const dw = img.width * s, dh = img.height * s;
    // centered, then user offset, then clamp so the box stays fully covered
    let px = x + (w - dw) / 2 + tx.dx * w;
    let py = y + (h - dh) / 2 + tx.dy * h;
    px = Math.min(x, Math.max(x + w - dw, px));
    py = Math.min(y, Math.max(y + h - dh, py));
    ctx.drawImage(img, px, py, dw, dh);
  } else {
    ctx.fillStyle = "#3a3f4d"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "18px CardSans"; ctx.fillText("no art yet", x + w / 2, y + h / 2);
  }
  ctx.restore();
}

function drawBadge(ctx: SKRSContext2D, text: string, rx: number, by: number, pal: Palette, round = false): void {
  ctx.font = "24px CardSansBold";
  const w = Math.max(64, ctx.measureText(text).width + 34), h = 40;
  const x = rx - w, y = by - h;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, pal.a); g.addColorStop(1, pal.b);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, round ? h / 2 : 8); ctx.fill();
  ctx.strokeStyle = "#000000aa"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = pal.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
}

const RARITY_INK: Record<string, string> = { C: "#20201c", U: "#5a6570", R: "#9a7b28", M: "#b5502a", S: "#7a5aa0", L: "#20201c" };

// ---- main render -------------------------------------------------------
export async function renderCard(card: CustomCard, art?: Buffer | null, tx?: ArtTransform): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const th = theme(card.frameTheme);
  const pal = th.tintByMana ? manaPalette(card) : (th.panel ?? manaPalette(card));
  const accent = th.neonAccent ? neonColor(card) : th.accent;
  let img: Image | null = null;
  if (art) { try { img = await loadImage(art); } catch { img = null; } }

  if (th.layout === "fullart") drawFullArt(ctx, card, img, th, pal, accent, tx ?? IDENTITY);
  else drawStandard(ctx, card, img, th, pal, accent, tx ?? IDENTITY);

  return await canvas.encode("jpeg", 92);
}

// Art-box geometry per layout — the client adjuster mirrors these so pan/zoom is
// WYSIWYG. Standard = the framed art window; fullart = the whole inner card.
export function artBoxAspect(themeId: string | undefined): number {
  const t = theme(themeId);
  if (t.layout === "fullart") return (W - t.margin * 2) / (H - t.margin * 2);
  return (W - t.margin * 2 - 32) / 372; // innerW-32 : artH
}

function drawStandard(ctx: SKRSContext2D, card: CustomCard, img: Image | null, th: ThemeStyle, pal: Palette, accent: string, tx: ArtTransform): void {
  const M = th.margin, innerX = M, innerW = W - M * 2;
  // base + colored panel
  ctx.fillStyle = th.cardBg; roundRect(ctx, 6, 6, W - 12, H - 12, th.radius + 10); ctx.fill();
  const grad = ctx.createLinearGradient(0, M, 0, H - M);
  grad.addColorStop(0, pal.a); grad.addColorStop(1, pal.b);
  ctx.fillStyle = grad; roundRect(ctx, innerX, M, innerW, H - M * 2, th.radius); ctx.fill();
  if (th.neonAccent) { ctx.strokeStyle = accent; ctx.lineWidth = 3; roundRect(ctx, innerX + 2, M + 2, innerW - 4, H - M * 2 - 4, th.radius - 2); ctx.stroke(); }

  // title bar
  const titleY = M + 12, titleH = 46;
  ctx.fillStyle = th.bar; roundRect(ctx, innerX + 12, titleY, innerW - 24, titleH, 10); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.stroke();
  const pips = parseMana(card.manaCost); const pipR = 13;
  const pipLeft = pips.length ? drawPips(ctx, pips, innerX + innerW - 24, titleY + titleH / 2, pipR) : innerX + innerW - 24;
  ctx.fillStyle = th.barInk; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  let nameSize = 26; const nameMaxW = pipLeft - (innerX + 28) - 8;
  do { ctx.font = `${nameSize}px CardSansBold`; nameSize -= 1; } while (ctx.measureText(card.name).width > nameMaxW && nameSize > 13);
  ctx.fillText(card.name, innerX + 28, titleY + titleH / 2 + 1);

  // art
  const artX = innerX + 16, artY = titleY + titleH + 10, artW = innerW - 32, artH = 372;
  drawArt(ctx, img, artX, artY, artW, artH, 6, tx);
  if (th.decor && th.decor !== "none") drawDecor(ctx, th.decor, card.name.length + 3, artX, artY, artW, artH);
  ctx.strokeStyle = th.neonAccent ? accent : "#00000055"; ctx.lineWidth = 2; roundRect(ctx, artX, artY, artW, artH, 6); ctx.stroke();

  // type line
  const typeY = artY + artH + 8, typeH = 34;
  ctx.fillStyle = th.bar; roundRect(ctx, innerX + 12, typeY, innerW - 24, typeH, 8); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = th.barInk; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = "19px CardSansBold"; ctx.fillText(card.types, innerX + 26, typeY + typeH / 2 + 1);
  ctx.textAlign = "right"; ctx.font = "18px CardSansBold";
  ctx.fillStyle = RARITY_INK[card.rarity] ?? th.barInk;
  ctx.fillText(card.rarity || "C", innerX + innerW - 26, typeY + typeH / 2 + 1);

  // text box
  const boxY = typeY + typeH + 8, boxH = H - M - 14 - boxY;
  ctx.fillStyle = th.textBox; roundRect(ctx, innerX + 12, boxY, innerW - 24, boxH, 8); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.stroke();
  drawRulesText(ctx, card, innerX + 26, boxY, innerW - 52, boxH, th);

  // P/T or loyalty
  drawStats(ctx, card, innerX + innerW - 30, boxY + boxH - 18, pal);

  // footer credit — sits on the dark outer margin, so always light.
  if (card.artist?.trim()) {
    ctx.fillStyle = "#d9d3c6cc";
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.font = "12px CardSans";
    ctx.fillText(`illus. ${card.artist.trim()}`, innerX + 20, H - M + 3);
  }
}

// Full-art "showcase" (borderless) — the art fills the whole card; a colored
// nameplate rides the top, and a colored-framed, downward-darkening translucent
// panel holds the type line + rules so the art still shows through behind them.
function drawFullArt(ctx: SKRSContext2D, card: CustomCard, img: Image | null, th: ThemeStyle, _pal: Palette, _accent: string, tx: ArtTransform): void {
  const M = th.margin;
  const pal = deepMana(card);               // rich, saturated frame color from mana
  const nameInk = lum(pal.a) > 0.62 ? "#241d10" : "#f6f1e6";

  ctx.fillStyle = th.cardBg; roundRect(ctx, 4, 4, W - 8, H - 8, th.radius + 6); ctx.fill();
  drawArt(ctx, img, M, M, W - M * 2, H - M * 2, th.radius, tx);
  if (th.decor && th.decor !== "none") drawDecor(ctx, th.decor, card.name.length + 3, M, M, W - M * 2, H - M * 2);
  const innerX = M, innerW = W - M * 2;

  // ---- name plate (colored banner) ----
  const npY = M + 12, npH = 52;
  const ng = ctx.createLinearGradient(0, npY, 0, npY + npH);
  ng.addColorStop(0, rgba(pal.a, 0.94)); ng.addColorStop(1, rgba(pal.b, 0.94));
  ctx.fillStyle = ng; roundRect(ctx, innerX + 8, npY, innerW - 16, npH, 12); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = rgba("#ffffff", 0.18); ctx.lineWidth = 1; roundRect(ctx, innerX + 11, npY + 3, innerW - 22, npH - 6, 10); ctx.stroke();
  const pips = parseMana(card.manaCost); const pipR = 13;
  const pipLeft = pips.length ? drawPips(ctx, pips, innerX + innerW - 22, npY + npH / 2, pipR) : innerX + innerW - 22;
  ctx.fillStyle = nameInk; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  let nameSize = 27; const nameMaxW = pipLeft - (innerX + 26) - 8;
  do { ctx.font = `${nameSize}px CardSansBold`; nameSize -= 1; } while (ctx.measureText(card.name).width > nameMaxW && nameSize > 13);
  ctx.fillText(card.name, innerX + 26, npY + npH / 2 + 1);

  // ---- lower framed text region (type bar + rules), translucent over the art ----
  const panelH = 300, panelY = H - M - 14 - panelH;
  const px = innerX + 8, pw = innerW - 16;
  const tg = ctx.createLinearGradient(0, panelY, 0, panelY + panelH);
  tg.addColorStop(0, "rgba(10,10,14,0.40)"); tg.addColorStop(0.45, "rgba(8,8,12,0.74)"); tg.addColorStop(1, "rgba(5,5,9,0.92)");
  ctx.fillStyle = tg; roundRect(ctx, px, panelY, pw, panelH, 12); ctx.fill();
  ctx.strokeStyle = rgba(pal.b, 0.95); ctx.lineWidth = 3; ctx.stroke();

  // type bar (colored) across the top of the panel
  const tbH = 34;
  const tgb = ctx.createLinearGradient(0, panelY, 0, panelY + tbH);
  tgb.addColorStop(0, rgba(pal.a, 0.96)); tgb.addColorStop(1, rgba(pal.b, 0.96));
  ctx.fillStyle = tgb; roundRect(ctx, px + 4, panelY + 4, pw - 8, tbH, 8); ctx.fill();
  ctx.fillStyle = nameInk; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = "18px CardSansBold"; ctx.fillText(card.types, px + 16, panelY + 4 + tbH / 2 + 1);
  ctx.textAlign = "right"; ctx.font = "17px CardSansBold"; ctx.fillText(card.rarity || "C", px + pw - 14, panelY + 4 + tbH / 2 + 1);

  // rules + flavor (light text on the dark translucent panel)
  drawRulesText(ctx, card, px + 16, panelY + tbH + 12, pw - 32, panelH - tbH - 20, { ...th, textInk: "#f4efe6", flavorInk: "#d6d0c4" });

  // P/T (or loyalty) badge tucked into the bottom-right corner of the frame
  drawStats(ctx, card, innerX + innerW - 18, panelY + panelH + 6, pal);

  if (card.artist?.trim()) {
    ctx.fillStyle = "#efe9dccc"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.font = "12px CardSans";
    ctx.fillText(`illus. ${card.artist.trim()}`, innerX + 20, H - M - 2);
  }
}

// ---- inline card symbols in rules text: {T} {W} {2} {X} {W/U} … ----------
function symStyle(tokRaw: string): { fill: string; ink: string; label: string } {
  const tok = tokRaw.toUpperCase();
  if (/^\d+$/.test(tok)) return { fill: "#cfcabf", ink: "#2c2a25", label: tok };
  if (tok === "T") return { fill: "#e0dacb", ink: "#171310", label: "T" };
  if (tok === "Q") return { fill: "#e0dacb", ink: "#171310", label: "Q" };
  if (tok === "X") return { fill: "#cfcabf", ink: "#2c2a25", label: "X" };
  if (tok === "C" || tok === "S" || tok === "E") return { fill: PIP_FILL.C, ink: PIP_INK.C, label: tok };
  if (tok === "W" || tok === "U" || tok === "B" || tok === "R" || tok === "G")
    return { fill: PIP_FILL[tok as Pip["kind"]], ink: PIP_INK[tok as Pip["kind"]], label: tok };
  return { fill: "#c9b98f", ink: "#2a2110", label: tok.replace(/[^A-Z0-9]/g, "").slice(0, 2) }; // hybrid/phyrexian/other
}
function drawSym(ctx: SKRSContext2D, tokRaw: string, x: number, midY: number, r: number): void {
  const s = symStyle(tokRaw);
  ctx.beginPath(); ctx.arc(x + r, midY, r, 0, Math.PI * 2); ctx.fillStyle = "#00000030"; ctx.fill();
  ctx.beginPath(); ctx.arc(x + r, midY, r - 1, 0, Math.PI * 2); ctx.fillStyle = s.fill; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = "#00000055"; ctx.stroke();
  ctx.fillStyle = s.ink; ctx.font = `${Math.round(r * (s.label.length > 1 ? 1.0 : 1.32))}px CardSansBold`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(s.label, x + r, midY + 0.5);
}
function atomize(word: string): Array<{ t: "text" | "sym"; v: string }> {
  const out: Array<{ t: "text" | "sym"; v: string }> = [];
  const re = /\{([^}]{1,5})\}/g; let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(word))) { if (m.index > last) out.push({ t: "text", v: word.slice(last, m.index) }); out.push({ t: "sym", v: m[1]! }); last = re.lastIndex; }
  if (last < word.length) out.push({ t: "text", v: word.slice(last) });
  return out;
}
const symR = (size: number) => size * 0.44;
function measureRich(ctx: SKRSContext2D, word: string, size: number): number {
  ctx.font = `${size}px CardSans`;
  let w = 0; for (const a of atomize(word)) w += a.t === "text" ? ctx.measureText(a.v).width : symR(size) * 2 + 2;
  return w;
}
function drawRich(ctx: SKRSContext2D, word: string, x: number, topY: number, size: number, ink: string): number {
  const r = symR(size), mid = topY + size * 0.54;
  for (const a of atomize(word)) {
    if (a.t === "text") { ctx.fillStyle = ink; ctx.font = `${size}px CardSans`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(a.v, x, topY); x += ctx.measureText(a.v).width; }
    else { drawSym(ctx, a.v, x, mid, r); x += r * 2 + 2; }
  }
  return x;
}
function wrapRich(ctx: SKRSContext2D, text: string, maxW: number, size: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (measureRich(ctx, trial, size) > maxW && line) { out.push(line); line = word; } else line = trial;
    }
    if (line) out.push(line);
  }
  return out;
}

function drawRulesText(ctx: SKRSContext2D, card: CustomCard, padX: number, boxY: number, textW: number, boxH: number, th: ThemeStyle): void {
  let ty = boxY + 16; const bodySize = 18, lineH = 23;
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  const kw = (card.keywords ?? []).filter(Boolean).join(", ");
  const rules = [kw, (card.oracle ?? "").trim()].filter(Boolean).join("\n");
  if (rules) {
    for (const line of wrapRich(ctx, rules, textW, bodySize)) {
      if (ty > boxY + boxH - (card.flavor ? 48 : 20)) break;
      if (line) drawRich(ctx, line, padX, ty, bodySize, th.textInk);
      ty += line ? lineH : lineH * 0.5;
    }
  }
  if (card.flavor?.trim()) {
    ty += 6; ctx.fillStyle = th.flavorInk; ctx.font = `italic ${bodySize - 2}px CardSans`;
    for (const line of wrap(ctx, card.flavor.trim(), textW)) {
      if (ty > boxY + boxH - 16) break;
      ctx.fillText(line, padX, ty); ty += lineH - 2;
    }
  }
}

function drawStats(ctx: SKRSContext2D, card: CustomCard, rx: number, by: number, pal: Palette): void {
  const isCreature = /creature|vehicle/i.test(card.types);
  const isPW = /planeswalker/i.test(card.types);
  if (isCreature && (card.power != null || card.toughness != null)) {
    drawBadge(ctx, `${card.power ?? "0"}/${card.toughness ?? "0"}`, rx, by, pal);
  } else if (isPW && card.loyalty != null) {
    drawBadge(ctx, String(card.loyalty), rx, by, pal, true);
  }
}

// Card-art generation via Google's Gemini image API (AI Studio key). The key is
// read from app_settings (set via admin UI) or the GEMINI_API_KEY env, so it can
// be added without a redeploy. Includes the prompt builder and a per-user 30s
// throttle.
import { query } from "../db/pool.js";
import { ART_STYLES } from "@mtg/shared";

// Gemini 2.5 Flash Image ("Nano Banana") — text→image via generateContent, ~$0.04
// /image. The Imagen models (imagen-4.0-*) are gated to pre-existing users and 404
// for newer projects, so we use the Gemini image model for both plain generation
// and reference-image conditioning. Override with GEMINI_IMAGE_MODEL if desired.
const MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
const MULTIMODAL = process.env.GEMINI_MULTIMODAL_MODEL ?? "gemini-2.5-flash-image";
const ASPECT = process.env.GEMINI_IMAGE_ASPECT ?? "3:4"; // portrait, card-like

export interface RefImage { mime: string; dataBase64: string }

export async function getGeminiKey(): Promise<string | null> {
  const row = (await query<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'gemini_api_key'`)).rows[0];
  return row?.value || process.env.GEMINI_API_KEY || null;
}

export async function setGeminiKey(key: string): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('gemini_api_key', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key],
  );
}

// Compose a clean image prompt from the art-step form.
export function buildArtPrompt(opts: { styleId?: string; color?: string; details: string; cardName?: string; types?: string }): string {
  const style = ART_STYLES.find((s) => s.id === opts.styleId);
  const parts: string[] = [];
  parts.push(opts.details.trim());
  if (opts.color) parts.push(`${opts.color} color theme`);
  if (opts.types) parts.push(`depicting a ${opts.types.toLowerCase()}`);
  if (style) parts.push(style.promptStyle);
  parts.push("fantasy trading-card illustration, highly detailed, no text, no card frame, no borders, no watermark, portrait orientation");
  return parts.filter(Boolean).join(". ");
}

// ---- per-user rate limit (30s) -----------------------------------------
const lastGen = new Map<string, number>();
const COOLDOWN_MS = 30_000;
export function cooldownRemaining(userId: string): number {
  const last = lastGen.get(userId) ?? 0;
  return Math.max(0, COOLDOWN_MS - (nowMs() - last));
}
function nowMs(): number {
  // Date.now is unavailable in some sandboxes; hrtime is always safe.
  return Number(process.hrtime.bigint() / 1_000_000n);
}
export function markGenerated(userId: string): void {
  lastGen.set(userId, nowMs());
}

async function imagenGenerate(key: string, prompt: string): Promise<{ mime: string; data: Buffer }> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predict?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: ASPECT } }),
  });
  if (!res.ok) throw new Error(`Imagen API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const json = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string; image?: { imageBytes?: string } }> };
  const p = json.predictions?.[0];
  const b64 = p?.bytesBase64Encoded ?? p?.image?.imageBytes;
  if (!b64) throw new Error("Imagen returned no image (check billing is enabled and the model name).");
  return { mime: p?.mimeType || "image/png", data: Buffer.from(b64, "base64") };
}

// Multimodal image model via generateContent. `parts` may include a reference
// image (inlineData) for image-conditioned generation.
async function geminiGenerate(key: string, model: string, parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>): Promise<{ mime: string; data: Buffer }> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
  });
  if (!res.ok) throw new Error(`Gemini image API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> } }> };
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData) throw new Error("No image returned (check the model / that the key has image generation).");
  return { mime: part.inlineData.mimeType || "image/png", data: Buffer.from(part.inlineData.data, "base64") };
}

// Generate an image. With a reference image → multimodal Gemini (image+text).
// Otherwise Imagen (text-to-image, cheaper) or a gemini-*-image model.
export async function generateArt(prompt: string, ref?: RefImage): Promise<{ mime: string; data: Buffer }> {
  const key = await getGeminiKey();
  if (!key) throw new Error("No Google AI key set. Add it in Admin → Settings (or GEMINI_API_KEY).");
  if (ref) {
    return geminiGenerate(key, MULTIMODAL, [{ text: prompt }, { inlineData: { mimeType: ref.mime, data: ref.dataBase64 } }]);
  }
  if (/imagen/i.test(MODEL)) return imagenGenerate(key, prompt);
  return geminiGenerate(key, MODEL, [{ text: prompt }]);
}

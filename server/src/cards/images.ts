// Lazy image cache: the first time a card image is requested we download it from
// Scryfall and store it on disk; afterwards it is served locally forever. This
// keeps everything self-hosted without a multi-gigabyte upfront download and
// respects Scryfall's rate-limit guidance (throttled, with retries/backoff).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env } from "../env.js";
import { getArtCropUrl, getFaceImageUrl } from "./repo.js";

const USER_AGENT = "MtgPvP-selfhosted/0.1 (private family game)";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function cacheFileFor(remoteUrl: string): string {
  const hash = createHash("sha1").update(remoteUrl).digest("hex");
  return join(env.imageCacheDir, hash.slice(0, 2), `${hash}.jpg`);
}

// Scryfall serves the same art at several sizes under a size path segment, e.g.
//   https://cards.scryfall.io/normal/front/0/0/<id>.jpg?123
// Swapping the segment gives higher/lower resolutions (all JPEG). We prefer
// "large" (672x936) for crisp display and fall back down if a size 404s.
const SIZE_ORDER = ["large", "normal", "small"];
function sizeVariants(url: string): string[] {
  const m = url.match(/\/(small|normal|large|png|art_crop|border_crop)\//);
  if (!m) return [url];
  const variants = SIZE_ORDER.map((s) => url.replace(/\/(small|normal|large|png|art_crop|border_crop)\//, `/${s}/`));
  // De-dup while preserving order.
  return [...new Set(variants)];
}

export interface CachedImage {
  data: Buffer;
  contentType: string;
}

// --- simple global throttle so a fast scroll doesn't hammer Scryfall (429) ---
let active = 0;
const queue: Array<() => void> = [];
const MAX_CONCURRENT = 6;
function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}
function release(): void {
  active--;
  const next = queue.shift();
  if (next) {
    active++;
    next();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url: string, attempts = 3): Promise<Buffer | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      // 429 / 5xx: back off and retry. 404: give up on this URL.
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        await sleep(300 * (i + 1) + Math.floor(Math.random() * 200));
        continue;
      }
      return null;
    } catch {
      await sleep(250 * (i + 1));
    }
  }
  return null;
}

export async function getCardImage(id: string, face: number): Promise<CachedImage | null> {
  const base = await getFaceImageUrl(id, face);
  if (!base) return null;
  const candidates = sizeVariants(base);

  // Serve any already-cached size (prefer the best we have).
  for (const url of candidates) {
    const file = cacheFileFor(url);
    if (await exists(file)) return { data: await readFile(file), contentType: "image/jpeg" };
  }

  // Otherwise download the best available size, with throttle + retries.
  await acquire();
  try {
    for (const url of candidates) {
      const buf = await fetchWithRetry(url);
      if (buf) {
        const file = cacheFileFor(url);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, buf);
        return { data: buf, contentType: "image/jpeg" };
      }
    }
  } catch (e) {
    console.error("[images] fetch failed for", id, e);
  } finally {
    release();
  }
  return null;
}

// The art-crop image (used for profile avatars).
export async function getCardArt(id: string): Promise<CachedImage | null> {
  const url = await getArtCropUrl(id);
  if (!url) return null;
  const file = cacheFileFor(url);
  if (await exists(file)) return { data: await readFile(file), contentType: "image/jpeg" };
  await acquire();
  try {
    const buf = await fetchWithRetry(url);
    if (buf) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, buf);
      return { data: buf, contentType: "image/jpeg" };
    }
  } finally {
    release();
  }
  return null;
}

export async function getCardBack(): Promise<CachedImage | null> {
  const url = "https://raw.githubusercontent.com/mingomongo/DarkMingo-Theme-for-Cockatrice/master/cardback.png";
  const file = cacheFileFor(url);
  if (await exists(file)) return { data: await readFile(file), contentType: "image/png" };
  await acquire();
  try {
    const buf = await fetchWithRetry(url);
    if (buf) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, buf);
      return { data: buf, contentType: "image/png" };
    }
  } catch (e) {
    console.error("[images] fetch card back failed", e);
  } finally {
    release();
  }
  return null;
}

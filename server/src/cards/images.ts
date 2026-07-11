// Lazy image cache: the first time a card image is requested we download it from
// Scryfall and store it on disk; afterwards it is served locally forever. This
// keeps everything self-hosted without a multi-gigabyte upfront download and
// respects Scryfall's rate-limit guidance (one small fetch, on demand).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../env.js";
import { getFaceImageUrl } from "./repo.js";

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
  // Shard into subdirs to avoid one huge directory.
  return join(env.imageCacheDir, hash.slice(0, 2), `${hash}.jpg`);
}

export interface CachedImage {
  data: Buffer;
  contentType: string;
}

export async function getCardImage(id: string, face: number): Promise<CachedImage | null> {
  const remote = await getFaceImageUrl(id, face);
  if (!remote) return null;
  const file = cacheFileFor(remote);
  if (await exists(file)) {
    return { data: await readFile(file), contentType: "image/jpeg" };
  }
  try {
    const res = await fetch(remote, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(join(env.imageCacheDir, createHash("sha1").update(remote).digest("hex").slice(0, 2)), {
      recursive: true,
    });
    await writeFile(file, buf);
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    return { data: buf, contentType: ct };
  } catch (e) {
    console.error("[images] fetch failed for", id, e);
    return null;
  }
}

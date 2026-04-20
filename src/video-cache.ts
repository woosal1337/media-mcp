import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, copyFileSync, unlinkSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname } from "node:path";

const CACHE_DIR = join(homedir(), ".media-mcp", "cache", "videos");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function keyForUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}

export function getCachedVideoPath(url: string, extHint: string = ".mp4"): string | null {
  ensureCacheDir();
  const key = keyForUrl(url);
  const candidate = join(CACHE_DIR, `${key}${extHint}`);
  if (!existsSync(candidate)) return null;
  const age = Date.now() - statSync(candidate).mtimeMs;
  if (age > DEFAULT_TTL_MS) {
    try { unlinkSync(candidate); } catch { /* ignore */ }
    return null;
  }
  return candidate;
}

export function cacheVideo(url: string, srcPath: string): string {
  ensureCacheDir();
  const key = keyForUrl(url);
  const ext = extname(srcPath) || ".mp4";
  const dest = join(CACHE_DIR, `${key}${ext}`);
  if (srcPath === dest) return dest;
  copyFileSync(srcPath, dest);
  return dest;
}

export function cachePathFor(url: string, ext: string = ".mp4"): string {
  ensureCacheDir();
  const key = keyForUrl(url);
  return join(CACHE_DIR, `${key}${ext}`);
}

export function pruneCache(): void {
  if (!existsSync(CACHE_DIR)) return;
  const now = Date.now();
  for (const name of readdirSync(CACHE_DIR)) {
    const path = join(CACHE_DIR, name);
    try {
      const age = now - statSync(path).mtimeMs;
      if (age > DEFAULT_TTL_MS) unlinkSync(path);
    } catch { /* ignore */ }
  }
}

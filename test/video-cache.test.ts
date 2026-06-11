import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "media-mcp-cache-"));
  vi.stubEnv("MEDIA_MCP_CACHE_DIR", dir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("video cache", () => {
  it("derives a deterministic path per URL under MEDIA_MCP_CACHE_DIR", async () => {
    const { cachePathFor } = await import("../src/video-cache.js");
    const a1 = cachePathFor("https://example.com/video.mp4");
    const a2 = cachePathFor("https://example.com/video.mp4");
    const b = cachePathFor("https://example.com/other.mp4");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1.startsWith(join(dir, "videos"))).toBe(true);
    expect(a1.endsWith(".mp4")).toBe(true);
  });

  it("returns null for URLs that were never cached", async () => {
    const { getCachedVideoPath } = await import("../src/video-cache.js");
    expect(getCachedVideoPath("https://example.com/never-seen.mp4")).toBeNull();
  });
});

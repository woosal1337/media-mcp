import { describe, it, expect } from "vitest";
import { extractTweetId } from "../src/twitter.js";
import { extractVideoId } from "../src/youtube.js";
import { isInstagramUrl, normalizeUrl } from "../src/instagram.js";

describe("extractTweetId", () => {
  it("extracts the ID from x.com and twitter.com status URLs", () => {
    expect(extractTweetId("https://x.com/woosal1337/status/1234567890")).toBe("1234567890");
    expect(extractTweetId("https://twitter.com/user/status/987?s=20")).toBe("987");
  });

  it("accepts a bare numeric ID", () => {
    expect(extractTweetId("1234567890")).toBe("1234567890");
  });

  it("throws on URLs without a status ID", () => {
    expect(() => extractTweetId("https://x.com/woosal1337")).toThrow();
    expect(() => extractTweetId("not a url")).toThrow();
  });
});

describe("extractVideoId", () => {
  it("extracts from watch, short, and embed URLs", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("accepts a bare 11-character video ID", () => {
    expect(extractVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("throws when no video ID is present", () => {
    expect(() => extractVideoId("https://www.youtube.com/")).toThrow();
    expect(() => extractVideoId("short")).toThrow();
  });
});

describe("isInstagramUrl", () => {
  it("matches posts, reels, and tv across domains", () => {
    expect(isInstagramUrl("https://www.instagram.com/p/Cabc123/")).toBe(true);
    expect(isInstagramUrl("https://instagram.com/reel/Xyz-_789")).toBe(true);
    expect(isInstagramUrl("https://instagr.am/tv/Abc123")).toBe(true);
  });

  it("rejects non-Instagram URLs", () => {
    expect(isInstagramUrl("https://x.com/user/status/123")).toBe(false);
    expect(isInstagramUrl("https://www.instagram.com/woosal1337/")).toBe(false);
  });
});

describe("normalizeUrl", () => {
  it("normalizes to the canonical https://www.instagram.com form", () => {
    expect(normalizeUrl("instagram.com/reel/ABC123")).toBe("https://www.instagram.com/reel/ABC123/");
    expect(normalizeUrl("https://instagr.am/p/Xy_z-9")).toBe("https://www.instagram.com/p/Xy_z-9/");
  });

  it("throws on unparseable input", () => {
    expect(() => normalizeUrl("https://example.com/p/abc")).toThrow();
  });
});

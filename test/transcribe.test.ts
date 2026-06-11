import { describe, it, expect } from "vitest";
import {
  parseWhisperJson,
  findUncertaintySpans,
  findDemonstratives,
  formatTranscript,
  renderTranscript,
  type WhisperSegment,
  type TranscriptResult,
} from "../src/transcribe.js";

function segment(
  text: string,
  tokens: Array<{ text: string; t0: number; t1: number; p: number }>
): WhisperSegment {
  return {
    t0: tokens[0]?.t0 ?? 0,
    t1: tokens[tokens.length - 1]?.t1 ?? 0,
    text,
    tokens,
  };
}

describe("parseWhisperJson", () => {
  it("maps segments and tokens from whisper-cli -ojf output", () => {
    const raw = {
      transcription: [
        {
          offsets: { from: 0, to: 1000 },
          text: " hello world",
          tokens: [
            { text: " hello", offsets: { from: 0, to: 500 }, p: 0.9 },
            { text: " world", offsets: { from: 500, to: 1000 }, p: 0.3 },
          ],
        },
      ],
    };
    const segments = parseWhisperJson(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("hello world");
    expect(segments[0].t0).toBe(0);
    expect(segments[0].t1).toBe(1000);
    expect(segments[0].tokens).toHaveLength(2);
    expect(segments[0].tokens[1].p).toBe(0.3);
  });

  it("filters out special tokens and defaults missing probabilities to 1", () => {
    const raw = {
      transcription: [
        {
          offsets: { from: 0, to: 1000 },
          text: " hi",
          tokens: [
            { text: "[_BEG_]", offsets: { from: 0, to: 0 } },
            { text: " hi", offsets: { from: 0, to: 1000 } },
          ],
        },
      ],
    };
    const segments = parseWhisperJson(raw);
    expect(segments[0].tokens).toHaveLength(1);
    expect(segments[0].tokens[0].text).toBe(" hi");
    expect(segments[0].tokens[0].p).toBe(1);
  });

  it("returns empty array for empty or malformed input", () => {
    expect(parseWhisperJson({})).toEqual([]);
    expect(parseWhisperJson(null)).toEqual([]);
    expect(parseWhisperJson({ transcription: [] })).toEqual([]);
  });
});

describe("findUncertaintySpans", () => {
  it("merges adjacent low-confidence tokens into one span", () => {
    const seg = segment("foo bar baz", [
      { text: " foo", t0: 0, t1: 200, p: 0.2 },
      { text: " bar", t0: 250, t1: 400, p: 0.3 },
      { text: " baz", t0: 450, t1: 600, p: 0.9 },
    ]);
    const spans = findUncertaintySpans([seg], 0.5);
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("foo bar");
    expect(spans[0].t0).toBe(0);
    expect(spans[0].t1).toBe(400);
    expect(spans[0].avg_p).toBeCloseTo(0.25);
    expect(spans[0].midpoint_s).toBeCloseTo(0.2);
  });

  it("splits spans when the gap between low-confidence tokens exceeds 150ms", () => {
    const seg = segment("foo bar", [
      { text: " foo", t0: 0, t1: 200, p: 0.2 },
      { text: " bar", t0: 500, t1: 700, p: 0.2 },
    ]);
    const spans = findUncertaintySpans([seg], 0.5);
    expect(spans).toHaveLength(2);
    expect(spans[0].text).toBe("foo");
    expect(spans[1].text).toBe("bar");
  });

  it("ignores punctuation-only and confident tokens", () => {
    const seg = segment("ok.", [
      { text: " ok", t0: 0, t1: 200, p: 0.95 },
      { text: ".", t0: 200, t1: 210, p: 0.1 },
    ]);
    expect(findUncertaintySpans([seg], 0.5)).toHaveLength(0);
  });
});

describe("findDemonstratives", () => {
  it("flags phrases that reference on-screen content with midpoint timestamps", () => {
    const seg = segment(
      "visit our site and check this out, link in the bio",
      [{ text: "visit our site and check this out, link in the bio", t0: 0, t1: 5000, p: 0.9 }]
    );
    const hits = findDemonstratives([seg]);
    const phrases = hits.map((h) => h.phrase.toLowerCase());
    expect(phrases).toContain("visit our");
    expect(phrases).toContain("check this");
    expect(phrases).toContain("in the bio");
    for (const hit of hits) {
      expect(hit.midpoint_s).toBeGreaterThanOrEqual(0);
      expect(hit.midpoint_s).toBeLessThanOrEqual(5);
    }
  });

  it("returns nothing for plain narration", () => {
    const seg = segment("the weather is nice today", [
      { text: "the weather is nice today", t0: 0, t1: 2000, p: 0.9 },
    ]);
    expect(findDemonstratives([seg])).toHaveLength(0);
  });
});

describe("formatTranscript", () => {
  it("wraps low-confidence tokens in confidence markers", () => {
    const seg = segment("hello world", [
      { text: " hello", t0: 0, t1: 500, p: 0.9 },
      { text: " world", t0: 500, t1: 1000, p: 0.3 },
    ]);
    const formatted = formatTranscript([seg], 0.5);
    expect(formatted).toContain("[00:00:00.000 --> 00:00:01.000]");
    expect(formatted).toContain("hello");
    expect(formatted).toContain("⟨world p=0.30⟩");
  });
});

describe("renderTranscript", () => {
  it("appends uncertainty and demonstrative sections when present", () => {
    const result: TranscriptResult = {
      segments: [],
      uncertainty_spans: [
        { t0: 1000, t1: 2000, text: "emil koval", avg_p: 0.31, midpoint_s: 1.5 },
      ],
      demonstratives: [{ t0: 3000, t1: 4000, phrase: "in the bio", midpoint_s: 3.5 }],
      formatted: "[00:00:00.000 --> 00:00:05.000] something",
    };
    const rendered = renderTranscript(result);
    expect(rendered).toContain("Uncertainty zones");
    expect(rendered).toContain("emil koval");
    expect(rendered).toContain("get_video_frames_at");
    expect(rendered).toContain("Demonstrative phrases");
    expect(rendered).toContain("in the bio");
  });

  it("omits the sections when there is nothing to flag", () => {
    const result: TranscriptResult = {
      segments: [],
      uncertainty_spans: [],
      demonstratives: [],
      formatted: "clean transcript",
    };
    const rendered = renderTranscript(result);
    expect(rendered).toBe("clean transcript");
    expect(rendered).not.toContain("Uncertainty zones");
  });
});

import { execFile } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";

export interface WhisperToken {
  text: string;
  t0: number;
  t1: number;
  p: number;
}

export interface WhisperSegment {
  t0: number;
  t1: number;
  text: string;
  tokens: WhisperToken[];
}

export interface UncertaintySpan {
  t0: number;
  t1: number;
  text: string;
  avg_p: number;
  midpoint_s: number;
}

export interface DemonstrativeHit {
  t0: number;
  t1: number;
  phrase: string;
  midpoint_s: number;
}

export interface TranscriptResult {
  segments: WhisperSegment[];
  uncertainty_spans: UncertaintySpan[];
  demonstratives: DemonstrativeHit[];
  formatted: string;
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;
const DEMONSTRATIVE_REGEX = /\b(this|that|these|those|the|our|my) (link|url|site|site's|command|prompt|script|code|tool|app|handle|skill|name|product|page|video|demo|example|price|cost|number|date|time|address)s?\b|\bvisit\s+(our|the|this)\b|\bcheck\s+(it|this|that|out)\b|\bgo\s+to\s+(this|that|the|our)\b|\bscan\s+this\b|\bdescription\s+below\b|\bin\s+the\s+(bio|description|comments)\b/gi;

function msToSeconds(ms: number): number {
  return ms / 1000;
}

function msToTimestamp(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRest = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(msRest).padStart(3, "0")}`;
}

export async function transcribe(
  audioPath: string,
  modelPath: string,
  opts: { language?: string; confidenceThreshold?: number } = {}
): Promise<TranscriptResult> {
  const language = opts.language ?? "en";
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const jsonPath = `${audioPath}.json`;

  await new Promise<void>((resolve, reject) => {
    execFile(
      "whisper-cli",
      [
        "-m", modelPath,
        "-f", audioPath,
        "-l", language,
        "-ojf",
      ],
      { timeout: 3600000, maxBuffer: 64 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) reject(new Error(`whisper-cli failed: ${error.message}\n${stderr}`));
        else resolve();
      }
    );
  });

  if (!existsSync(jsonPath)) {
    throw new Error(`whisper-cli did not produce JSON output at ${jsonPath}`);
  }

  const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
  try { unlinkSync(jsonPath); } catch { /* ignore */ }

  const segments: WhisperSegment[] = (raw.transcription ?? []).map((s: any) => {
    const tokens: WhisperToken[] = (s.tokens ?? [])
      .filter((t: any) => !(t.text as string).startsWith("[_"))
      .map((t: any) => ({
        text: t.text,
        t0: t.offsets?.from ?? 0,
        t1: t.offsets?.to ?? 0,
        p: typeof t.p === "number" ? t.p : 1,
      }));
    return {
      t0: s.offsets?.from ?? 0,
      t1: s.offsets?.to ?? 0,
      text: (s.text ?? "").trim(),
      tokens,
    };
  });

  const uncertainty_spans = findUncertaintySpans(segments, threshold);
  const demonstratives = findDemonstratives(segments);
  const formatted = formatTranscript(segments, threshold);

  return { segments, uncertainty_spans, demonstratives, formatted };
}

function findUncertaintySpans(
  segments: WhisperSegment[],
  threshold: number
): UncertaintySpan[] {
  const spans: UncertaintySpan[] = [];
  const MERGE_GAP_MS = 150;

  let current: { tokens: WhisperToken[] } | null = null;

  const flush = () => {
    if (!current || current.tokens.length === 0) { current = null; return; }
    const tokens = current.tokens;
    const t0 = tokens[0].t0;
    const t1 = tokens[tokens.length - 1].t1;
    const avg_p = tokens.reduce((a, t) => a + t.p, 0) / tokens.length;
    const text = tokens.map(t => t.text).join("").trim();
    if (text.length > 0) {
      spans.push({
        t0, t1, text, avg_p,
        midpoint_s: msToSeconds((t0 + t1) / 2),
      });
    }
    current = null;
  };

  for (const seg of segments) {
    for (const tok of seg.tokens) {
      if (!tok.text.trim() || /^[\s.,!?;:"'()\-]+$/.test(tok.text)) continue;

      if (tok.p < threshold) {
        if (current && current.tokens.length > 0) {
          const last = current.tokens[current.tokens.length - 1];
          const gap = tok.t0 - last.t1;
          if (gap > MERGE_GAP_MS) {
            flush();
            current = { tokens: [tok] };
          } else {
            current.tokens.push(tok);
          }
        } else {
          current = { tokens: [tok] };
        }
      } else {
        flush();
      }
    }
  }
  flush();

  return spans;
}

function findDemonstratives(segments: WhisperSegment[]): DemonstrativeHit[] {
  const hits: DemonstrativeHit[] = [];
  for (const seg of segments) {
    const matches = seg.text.matchAll(DEMONSTRATIVE_REGEX);
    for (const m of matches) {
      const idx = m.index ?? 0;
      const frac = seg.text.length > 0 ? idx / seg.text.length : 0;
      const span = seg.t1 - seg.t0;
      const t0 = seg.t0 + Math.round(frac * span);
      const t1 = Math.min(seg.t1, t0 + 1000);
      hits.push({
        t0, t1,
        phrase: m[0],
        midpoint_s: msToSeconds((t0 + t1) / 2),
      });
    }
  }
  return hits;
}

function formatTranscript(segments: WhisperSegment[], threshold: number): string {
  const lines: string[] = [];
  for (const seg of segments) {
    const ts = `[${msToTimestamp(seg.t0)} --> ${msToTimestamp(seg.t1)}]`;
    const rendered: string[] = [];
    for (const tok of seg.tokens) {
      if (tok.p < threshold && tok.text.trim() && !/^[\s.,!?;:"'()\-]+$/.test(tok.text)) {
        rendered.push(`⟨${tok.text.trim()} p=${tok.p.toFixed(2)}⟩`);
      } else {
        rendered.push(tok.text);
      }
    }
    lines.push(`${ts} ${rendered.join("").trimStart()}`);
  }
  return lines.join("\n");
}

export function renderTranscript(result: TranscriptResult): string {
  const parts: string[] = [];
  parts.push(result.formatted);

  if (result.uncertainty_spans.length > 0) {
    parts.push("\n**Uncertainty zones (Whisper's own low-confidence spans):**");
    for (const span of result.uncertainty_spans) {
      parts.push(
        `  [${msToTimestamp(span.t0)}]  "${span.text}"  (avg p=${span.avg_p.toFixed(2)}, midpoint=${span.midpoint_s.toFixed(2)}s)`
      );
    }
    parts.push("\n→ If any of these matter to the user's question, call `get_video_frames_at` with the `midpoint_s` values to verify visually.");
  }

  if (result.demonstratives.length > 0) {
    parts.push("\n**Demonstrative phrases (likely reference on-screen content):**");
    for (const d of result.demonstratives) {
      parts.push(
        `  [${msToTimestamp(d.t0)}]  "${d.phrase}"  (midpoint=${d.midpoint_s.toFixed(2)}s)`
      );
    }
  }

  return parts.join("\n");
}

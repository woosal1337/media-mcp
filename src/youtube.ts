import { execFile } from "node:child_process";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { transcribe, renderTranscript } from "./transcribe.js";

const { fetchTranscript } = await import(
  "youtube-transcript/dist/youtube-transcript.esm.js"
) as {
  fetchTranscript: (
    videoId: string,
    config?: { lang?: string }
  ) => Promise<Array<{ text: string; offset: number; duration: number }>>;
};

export interface YouTubeTranscript {
  videoId: string;
  text: string;
  segments: Array<{
    text: string;
    offset: number;
    duration: number;
  }>;
  source: "captions" | "whisper";
}

function extractVideoId(input: string): string {
  const watchMatch = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const embedMatch = input.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  throw new Error(`Cannot extract YouTube video ID from: ${input}`);
}

function downloadAudioWithYtDlp(videoId: string): Promise<string> {
  const audioPath = join(tmpdir(), `media-mcp-yt-${randomUUID()}.wav`);
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      [
        "-x",
        "--audio-format", "wav",
        "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1",
        "-o", audioPath,
        "--no-playlist",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 300000 },
      (error) => {
        if (error) reject(new Error(`yt-dlp failed: ${error.message}`));
        else resolve(audioPath);
      }
    );
  });
}

function cleanup(...paths: string[]) {
  for (const p of paths) {
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }
}

async function transcribeYouTubeVideo(
  videoId: string,
  modelPath: string
): Promise<string> {
  let audioPath = "";
  try {
    audioPath = await downloadAudioWithYtDlp(videoId);
    const result = await transcribe(audioPath, modelPath);
    return renderTranscript(result);
  } finally {
    cleanup(audioPath);
  }
}

export async function fetchYouTubeTranscript(
  url: string,
  modelPath?: string
): Promise<YouTubeTranscript> {
  const videoId = extractVideoId(url);

  try {
    const segments = await fetchTranscript(videoId);
    if (segments.length > 0) {
      return {
        videoId,
        text: segments.map((s) => s.text).join(" "),
        segments: segments.map((s) => ({
          text: s.text,
          offset: s.offset,
          duration: s.duration,
        })),
        source: "captions",
      };
    }
  } catch {}

  if (!modelPath) {
    throw new Error(
      "No captions available for this video and no Whisper model path provided for audio transcription."
    );
  }

  const transcription = await transcribeYouTubeVideo(videoId, modelPath);
  return {
    videoId,
    text: transcription,
    segments: [],
    source: "whisper",
  };
}
